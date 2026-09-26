// Who may read the Qur'an corpus from the cloud, and each translation in it — runtime switches a
// maintainer controls. The third gate, beside roles (roles.ts) and plan tiers (plans.ts): not
// "who are you" or "what have you paid for", but "what does THIS resource require right now".
//
// The corpus as a whole has one LEVEL (table corpus_policy):
//   public     anyone, no sign-in
//   signed_in  any signed-in account (free is enough)
//   plan       an active plan at or above `minPlan` (e.g. pro, scholar)
//
// Individual translations may additionally require a tier (table translation_access). A locked
// translation is simply LEFT OUT of results for a caller below its tier — the endpoints still
// answer; they just don't include what the caller hasn't paid for. GET /corpus-access says which
// translations are locked at which tier, so the app can offer the upgrade.
//
// Everything fails CLOSED: a missing policy row reads as plan ≥ pro; an unknown tier never passes.
// Settings are cached briefly per runner; a change made here applies at once in this process, and
// within CACHE_MS on any other instance.

import type { MiddlewareHandler } from "hono";
import type { SqlRunner } from "./migrate.js";
import type { Env, Principal } from "./roles.js";
import { COMMUNITY_PLAN, loadTiers, meetsPlan, TierError } from "./plans.js";

export const CORPUS_ACCESS = ["public", "signed_in", "plan"] as const;
export type CorpusAccess = (typeof CORPUS_ACCESS)[number];

export const isCorpusAccess = (v: unknown): v is CorpusAccess =>
  typeof v === "string" && (CORPUS_ACCESS as readonly string[]).includes(v);

export interface CorpusPolicy { access: CorpusAccess; minPlan: string }

const FALLBACK: CorpusPolicy = { access: "plan", minPlan: COMMUNITY_PLAN };
const CACHE_MS = 10_000;
const policyCache = new WeakMap<SqlRunner, { v: CorpusPolicy; at: number }>();
const translationCache = new WeakMap<SqlRunner, { v: Map<number, string>; at: number }>();

export async function getCorpusPolicy(r: SqlRunner): Promise<CorpusPolicy> {
  const hit = policyCache.get(r);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const row = (await r.query("SELECT access, min_plan FROM corpus_policy WHERE id = true"))[0];
  const v: CorpusPolicy = row && isCorpusAccess(row.access)
    ? { access: row.access, minPlan: String(row.min_plan) }
    : FALLBACK;
  policyCache.set(r, { v, at: Date.now() });
  return v;
}

/** Translation resource id → the tier it requires. Absent = open to any corpus reader. */
export async function getTranslationAccess(r: SqlRunner): Promise<Map<number, string>> {
  const hit = translationCache.get(r);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const v = new Map((await r.query("SELECT resource_id, min_plan FROM translation_access"))
    .map((x) => [Number(x.resource_id), String(x.min_plan)]));
  translationCache.set(r, { v, at: Date.now() });
  return v;
}

export const clearCorpusAccessCache = (r: SqlRunner): void => {
  policyCache.delete(r);
  translationCache.delete(r);
};

async function assertTier(r: SqlRunner, name: string): Promise<void> {
  const tiers = await loadTiers(r);
  if (!tiers.has(name)) {
    throw new TierError(`unknown plan tier: ${name} (tiers: ${[...tiers.keys()].join(", ")})`, 422);
  }
}

/** A maintainer act. `minPlan` is kept as it was when omitted. */
export async function setCorpusPolicy(
  r: SqlRunner, opts: { access: CorpusAccess; minPlan?: string }, byUserId: string | null = null,
): Promise<CorpusPolicy> {
  if (!isCorpusAccess(opts.access)) {
    throw new TierError(`access must be one of ${CORPUS_ACCESS.join(", ")}`, 422);
  }
  const minPlan = opts.minPlan ?? (await getCorpusPolicy(r)).minPlan;
  await assertTier(r, minPlan);
  await r.query(
    `INSERT INTO corpus_policy (id, access, min_plan, updated_at, updated_by)
     VALUES (true, $1, $2, now(), $3)
     ON CONFLICT (id) DO UPDATE SET access = excluded.access, min_plan = excluded.min_plan,
       updated_at = now(), updated_by = excluded.updated_by`,
    [opts.access, minPlan, byUserId]);
  policyCache.delete(r);
  return { access: opts.access, minPlan };
}

/** Lock a translation to a tier, or unlock it (minPlan null). A maintainer act. */
export async function setTranslationAccess(
  r: SqlRunner, resourceId: number, minPlan: string | null, byUserId: string | null = null,
): Promise<void> {
  if (!Number.isInteger(resourceId) || resourceId < 0) throw new TierError("resourceId must be a whole number", 422);
  if (minPlan === null) {
    await r.query("DELETE FROM translation_access WHERE resource_id = $1", [resourceId]);
  } else {
    await assertTier(r, minPlan);
    await r.query(
      `INSERT INTO translation_access (resource_id, min_plan, updated_at, updated_by)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (resource_id) DO UPDATE SET min_plan = excluded.min_plan,
         updated_at = now(), updated_by = excluded.updated_by`,
      [resourceId, minPlan, byUserId]);
  }
  translationCache.delete(r);
}

/**
 * Which translations this caller may see. Returned as a predicate so the content layer can
 * filter without knowing anything about plans. Anonymous callers see only unlocked ones.
 */
export async function translationFilter(
  r: SqlRunner, user: Principal | undefined,
): Promise<(resourceId: number) => boolean> {
  const locked = await getTranslationAccess(r);
  if (locked.size === 0) return () => true;
  const tiers = await loadTiers(r);
  return (id) => {
    const min = locked.get(id);
    return min === undefined || (!!user && meetsPlan(user, min, tiers));
  };
}

/**
 * Guard the corpus routes by the current policy. 401 when it needs a signed-in account and there
 * isn't one; 402 when it needs a tier the account doesn't reach. The body names what's required,
 * so the app can say exactly that.
 */
export function requireCorpusAccess(r: SqlRunner): MiddlewareHandler<Env> {
  return async (c, next) => {
    const policy = await getCorpusPolicy(r);
    if (policy.access === "public") return next();
    const user = c.get("user");
    if (!user) return c.json({ detail: "sign in to read the corpus", access: policy.access }, 401);
    if (policy.access === "plan" && !meetsPlan(user, policy.minPlan, await loadTiers(r))) {
      return c.json({
        detail: `reading the corpus needs an active ${policy.minPlan} plan`,
        access: policy.access, plan: policy.minPlan,
      }, 402);
    }
    await next();
  };
}
