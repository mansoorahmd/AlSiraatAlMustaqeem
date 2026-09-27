// What the in-app Admin screen needs beyond the public endpoints — maintainer-only (app.ts).
//
//   • every user with their role and plan, to change either
//   • every translation and dictionary WITH its current rule — unfiltered. The public lists are
//     filtered by the caller's own plan, so a maintainer below a translation's tier couldn't
//     otherwise see it to unlock it.
//
// Roles are a feature permission; changing one is guarded so the last maintainer can't be
// demoted (that would lock everyone out of administering the community).

import type { SqlRunner } from "./migrate.js";
import type { Role } from "./roles.js";
import { roleExists } from "./role-ladder.js";
import { listRules } from "./resource-access.js";

export class AdminError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface AdminUser {
  id: string; email: string; displayName: string; role: Role;
  plan: string; planExpiresAt: string | null; createdAt: string;
}

export async function listUsers(r: SqlRunner): Promise<AdminUser[]> {
  const rows = await r.query(
    `SELECT id, email, display_name, role, plan, plan_expires_at, created_at
       FROM users ORDER BY created_at, email`);
  return rows.map((u) => ({
    id: String(u.id), email: String(u.email), displayName: String(u.display_name ?? ""),
    role: u.role as Role, plan: String(u.plan ?? "free"),
    planExpiresAt: u.plan_expires_at == null ? null : new Date(u.plan_expires_at as string).toISOString(),
    createdAt: new Date(u.created_at as string).toISOString(),
  }));
}

/** A users.id (uuid) — checked before it reaches Postgres, which would reject it as a 500. */
export const isUserId = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Change a user's role. Refuses to leave the community without a maintainer. */
export async function setRole(r: SqlRunner, userId: string, role: string): Promise<void> {
  if (!(await roleExists(r, role))) throw new AdminError(`no such role: ${role} — add it to the ladder first`, 422);
  if (!isUserId(userId)) throw new AdminError("no such user", 404);
  // One statement that first LOCKS every maintainer row: two maintainers demoting each other at
  // the same moment would otherwise both count "2 maintainers" and leave none. With the lock the
  // second waits, re-reads the rows once the first commits, counts 1, and is refused.
  const done = await r.query(
    `WITH m AS (SELECT id FROM users WHERE role = 'maintainer' FOR UPDATE)
     UPDATE users SET role = $1, updated_at = now()
      WHERE id = $2
        AND (role <> 'maintainer' OR $1 = 'maintainer' OR (SELECT COUNT(*) FROM m) > 1)
      RETURNING id`, [role, userId]);
  if (done.length) return;
  const exists = await r.query("SELECT 1 FROM users WHERE id = $1", [userId]);
  if (!exists.length) throw new AdminError("no such user", 404);
  throw new AdminError("this is the only maintainer — make someone else a maintainer first", 409);
}

export interface AdminResources {
  translations: { id: number; name: string; language: string; author: string; minPlan: string | null; ruled: boolean }[];
  lexicons: { source: string; entries: number; minPlan: string | null; ruled: boolean }[];
}

/**
 * Every translation and dictionary in the corpus, each with its rule (or none). `corpus` resolves
 * the corpus schema; `access` holds the rules. `ruled` false = no per-item rule (it needs only
 * what the corpus needs).
 */
export async function listResources(corpus: SqlRunner, access: SqlRunner): Promise<AdminResources> {
  const rules = new Map((await listRules(access)).map((x) => [`${x.kind}:${x.key}`, x.minPlan]));
  const translations = (await corpus.query(
    `SELECT tr.id, tr.name, tr.language_name, tr.author_name FROM translation_resources tr
      WHERE tr.id IN (SELECT DISTINCT resource_id FROM verse_translations) ORDER BY tr.id`))
    .map((t) => {
      const k = `translation:${t.id}`;
      return {
        id: Number(t.id), name: String(t.name ?? ""), language: String(t.language_name ?? ""),
        author: String(t.author_name ?? ""), minPlan: rules.get(k) ?? null, ruled: rules.has(k),
      };
    });
  const lexicons = (await corpus.query(
    `SELECT source, COUNT(*)::int AS n FROM root_meanings GROUP BY source ORDER BY source`))
    .map((l) => {
      const k = `lexicon:${l.source}`;
      return { source: String(l.source), entries: Number(l.n), minPlan: rules.get(k) ?? null, ruled: rules.has(k) };
    });
  return { translations, lexicons };
}
