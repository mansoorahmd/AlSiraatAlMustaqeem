// Invite-only registration. Deliberately NOT a Better Auth hook: redemption is our own
// explicit step, so the rule is plain, testable SQL and Better Auth stays a hard gate
// (`disableSignUp: true` — it will never create a user we didn't invite).
//
// Flow:
//   1. a maintainer issues an invite (a code carrying the role to grant)
//   2. the invitee redeems it with their email → we create the `users` row with that role,
//      optionally binding their local_id, and mark the invite redeemed (single use)
//   3. they then sign in by magic link — the user already exists, so no signup is needed
//
// Roles and local_id are ours, never Better Auth's (SHARED_RESEARCH.md §4).

import { randomBytes } from "node:crypto";
import type { SqlRunner } from "./migrate.js";
import type { Role } from "./roles.js";
import { roleExists } from "./role-ladder.js";
import { FREE, loadTiers, TierError } from "./plans.js";

export interface Invite {
  code: string;
  role: Role;
  expires_at: string | null;
  redeemed_by: string | null;
}

export const newInviteCode = (): string => randomBytes(16).toString("base64url");

/**
 * A duration in whole days, 1–36500, or null for "no expiry". Anything else is refused (422)
 * rather than reaching Postgres as `interval 'NaN days'` — and it goes in as a parameter.
 */
export function expiryDays(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 36500) {
    throw new InviteError("expiresInDays must be a whole number of days from 1 to 36500 (or omitted)", 422);
  }
  return n;
}

/** Issue an invite. Caller must already be authorized as a maintainer (route guard). */
export async function createInvite(
  r: SqlRunner,
  opts: { issuedBy: string; role?: Role; expiresInDays?: number; code?: string },
): Promise<Invite> {
  const role: Role = opts.role ?? "researcher";
  if (!(await roleExists(r, role))) throw new InviteError(`unknown role: ${role}`, 422);
  const code = opts.code ?? newInviteCode();
  const days = expiryDays(opts.expiresInDays);
  const rows = await r.query(
    `INSERT INTO invites (code, issued_by, role, expires_at)
     VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END)
     RETURNING code, role, expires_at, redeemed_by`,
    [code, opts.issuedBy, role, days],
  );
  return rows[0] as unknown as Invite;
}

export class InviteError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Check a code is real, unused and unexpired. Throws InviteError otherwise. */
export async function validateInvite(r: SqlRunner, code: string): Promise<Invite> {
  const found = (await r.query(
    "SELECT code, role, expires_at, redeemed_by FROM invites WHERE code = $1", [code],
  )) as unknown as Invite[];
  const invite = found[0];
  if (!invite) throw new InviteError("invite not found", 404);
  if (invite.redeemed_by) throw new InviteError("invite already redeemed", 409);
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw new InviteError("invite expired", 410);
  }
  return invite;
}

export async function emailTaken(r: SqlRunner, email: string): Promise<boolean> {
  const rows = await r.query("SELECT 1 FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  return rows.length > 0;
}

/**
 * Finish a redemption for a user Better Auth has just created: grant the invite's role, bind
 * the device, and burn the code. The WHERE guard makes a concurrent double-redeem impossible.
 */
export async function finishRedeem(
  r: SqlRunner,
  opts: { code: string; userId: string; role: Role; localId?: string },
): Promise<void> {
  const burned = await r.query(
    "UPDATE invites SET redeemed_by = $1 WHERE code = $2 AND redeemed_by IS NULL RETURNING code",
    [opts.userId, opts.code],
  );
  if (!burned[0]) throw new InviteError("invite already redeemed", 409);
  await r.query(
    "UPDATE users SET role = $1, local_id = COALESCE($2, local_id), updated_at = now() WHERE id = $3",
    [opts.role, opts.localId ?? null, opts.userId],
  );
}

/** Bind (or re-bind) a signed-in account to a device's local_id — Phase 1 attribution. */
export async function bindLocalId(r: SqlRunner, userId: string, localId: string): Promise<void> {
  await r.query("UPDATE users SET local_id = $1, updated_at = now() WHERE id = $2", [localId, userId]);
}

/** The authorization facts for a user, plus who they are (for the account panel). */
export async function loadPrincipal(
  r: SqlRunner,
  userId: string,
): Promise<{
  id: string; role: Role; roleRank: number; localId: string | null; email: string; displayName: string;
  plan: string; planExpiresAt: string | null;
} | null> {
  // the role's rank comes with it, so every guard afterwards is a comparison (roles.ts)
  const rows = await r.query(
    `SELECT u.id, u.role, rl.rank AS role_rank, u.local_id, u.email, u.display_name, u.plan, u.plan_expires_at
       FROM users u JOIN role_levels rl ON rl.name = u.role WHERE u.id = $1`,
    [userId]);
  const u = rows[0] as {
    id: string; role: string; role_rank: number; local_id: string | null; email: string; display_name: string | null;
    plan: string; plan_expires_at: string | Date | null;
  } | undefined;
  if (!u) return null;
  return {
    id: u.id, role: u.role, roleRank: Number(u.role_rank), localId: u.local_id,
    email: u.email, displayName: u.display_name ?? "",
    // users.plan is a foreign key into plan_tiers, so it is always a real tier
    plan: u.plan || FREE,
    planExpiresAt: u.plan_expires_at == null ? null : new Date(u.plan_expires_at).toISOString(),
  };
}

/**
 * Grant or revoke a plan. A maintainer act (route guard / CLI), never self-service — mirrors how
 * a role is only ever set by an invite, not by the request. `expiresInDays` null = no expiry
 * (a manual grant that never lapses); setting plan 'free' clears any expiry.
 */
export async function setPlan(
  r: SqlRunner,
  opts: { userId: string; plan: string; expiresInDays?: number | null },
): Promise<void> {
  const tiers = await loadTiers(r);
  if (!tiers.has(opts.plan)) {
    throw new TierError(`unknown plan tier: ${opts.plan} (tiers: ${[...tiers.keys()].join(", ")})`, 422);
  }
  let days: number | null;
  try { days = opts.plan === FREE ? null : expiryDays(opts.expiresInDays); }
  catch (e) { throw new TierError((e as Error).message, 422); }
  await r.query(
    `UPDATE users SET plan = $1, updated_at = now(),
            plan_expires_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END
      WHERE id = $2`,
    [opts.plan, opts.userId, days],
  );
}

/** Resolve a user id from an email (for CLI / admin routes that take an email). */
export async function userIdByEmail(r: SqlRunner, email: string): Promise<string | null> {
  const rows = await r.query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

/** Let a signed-in reader set their own display name. */
export async function setDisplayName(r: SqlRunner, userId: string, name: string): Promise<void> {
  await r.query("UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2",
    [name.trim().slice(0, 120), userId]);
}
