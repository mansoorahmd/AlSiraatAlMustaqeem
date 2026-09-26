// Plan tiers — the billing ladder, and its guard. Twin of roles.ts, but the ladder is DATA.
//
// `role` says what you may do in the research process; `plan` says what you have paid for. They
// are orthogonal. The plan ladder lives in the `plan_tiers` table (name, rank, label), so a
// maintainer can define free < student < pro < scholar without a deploy. A gate names a minimum
// tier and asks whether the caller's RANK reaches it.
//
// Rules the whole gate turns on (all fail CLOSED):
//   • `free` is rank 0 and always exists — every signed-in account meets a `free` gate
//   • a LAPSED plan (plan_expires_at in the past) counts as `free`
//   • an unknown tier — on the account or in the gate — never passes
//
// Enforcement is here, on the server, because the gated data lives on the remote; a client-side
// lock ships on the user's disk. Billing isn't wired: a maintainer grants a tier with set-plan /
// POST /plan, and edits the ladder with plan-tiers / PUT /plan-tiers/:name.

import type { MiddlewareHandler } from "hono";
import type { SqlRunner } from "./migrate.js";
import type { Env } from "./roles.js";

export const FREE = "free";
/** The tier the community gates (reads + publishing) require. It can't be removed. */
export const COMMUNITY_PLAN = "pro";

export interface Tier { name: string; rank: number; label: string }
export type Tiers = Map<string, Tier>;

const TIER_NAME = /^[a-z][a-z0-9_]{0,31}$/;
export const isTierName = (v: unknown): v is string => typeof v === "string" && TIER_NAME.test(v);

const CACHE_MS = 10_000;
const cache = new WeakMap<SqlRunner, { tiers: Tiers; at: number }>();

/** The ladder, lowest first. Cached briefly per runner; a change made here clears it. */
export async function loadTiers(r: SqlRunner): Promise<Tiers> {
  const hit = cache.get(r);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tiers;
  const rows = await r.query("SELECT name, rank, label FROM plan_tiers ORDER BY rank");
  const tiers: Tiers = new Map(rows.map((x) =>
    [String(x.name), { name: String(x.name), rank: Number(x.rank), label: String(x.label ?? "") }]));
  cache.set(r, { tiers, at: Date.now() });
  return tiers;
}

export const clearTierCache = (r: SqlRunner): void => { cache.delete(r); };

export class TierError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Add or change a tier. `free` stays at rank 0; ranks are unique. */
export async function setTier(r: SqlRunner, t: { name: string; rank: number; label?: string }): Promise<Tier> {
  if (!isTierName(t.name)) throw new TierError("a tier name is lower-case letters, digits or _ (e.g. scholar)", 422);
  if (!Number.isInteger(t.rank) || t.rank < 0) throw new TierError("rank must be a whole number ≥ 0", 422);
  if (t.name === FREE && t.rank !== 0) throw new TierError("free is always rank 0", 422);
  if (t.name !== FREE && t.rank === 0) throw new TierError("rank 0 is reserved for free", 422);
  const clash = (await r.query("SELECT name FROM plan_tiers WHERE rank = $1 AND name <> $2", [t.rank, t.name]))[0];
  if (clash) throw new TierError(`rank ${t.rank} is already used by ${String(clash.name)}`, 409);
  await r.query(
    `INSERT INTO plan_tiers (name, rank, label) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET rank = excluded.rank, label = excluded.label`,
    [t.name, t.rank, t.label ?? ""]);
  clearTierCache(r);
  return { name: t.name, rank: t.rank, label: t.label ?? "" };
}

/** Remove a tier nobody holds and nothing requires. */
export async function removeTier(r: SqlRunner, name: string): Promise<void> {
  if (name === FREE) throw new TierError("free can't be removed", 409);
  if (name === COMMUNITY_PLAN) throw new TierError(`${COMMUNITY_PLAN} gates the community and can't be removed`, 409);
  const used = (await r.query(
    `SELECT (SELECT COUNT(*)::int FROM users WHERE plan = $1)
          + (SELECT COUNT(*)::int FROM corpus_policy WHERE min_plan = $1)
          + (SELECT COUNT(*)::int FROM translation_access WHERE min_plan = $1) AS n`, [name]))[0];
  if (Number(used?.n ?? 0) > 0) {
    throw new TierError(`${name} is still held by an account or required by a policy — move them first`, 409);
  }
  await r.query("DELETE FROM plan_tiers WHERE name = $1", [name]);
  clearTierCache(r);
}

/** A tier's rank, or -1 when it doesn't exist. */
export const rankOf = (tiers: Tiers, name: string | null | undefined): number =>
  name == null ? -1 : (tiers.get(name)?.rank ?? -1);

/** Has this plan lapsed? A NULL expiry never lapses (a manual grant with no end date). */
export const planExpired = (expiresAt: string | null | undefined): boolean =>
  expiresAt != null && new Date(expiresAt).getTime() < Date.now();

/** The rank this account actually has right now: its tier, or free once it has lapsed. */
export function effectiveRank(p: { plan?: string; planExpiresAt?: string | null }, tiers: Tiers): number {
  const rank = rankOf(tiers, p.plan);
  if (rank < 0) return -1;
  return planExpired(p.planExpiresAt) ? 0 : rank;
}

/** The one predicate every plan gate turns on. */
export function meetsPlan(
  p: { plan?: string; planExpiresAt?: string | null }, min: string, tiers: Tiers,
): boolean {
  const need = rankOf(tiers, min);
  const have = effectiveRank(p, tiers);
  return need >= 0 && have >= need;
}

/**
 * Guard a route behind a minimum tier. 401 if unauthenticated, 402 (Payment Required) below
 * the tier. Sits AFTER requireRole where a route needs both: role = "are you allowed to",
 * plan = "have you paid for it".
 */
export function requirePlan(min: string, r: SqlRunner): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "authentication required" }, 401);
    if (!meetsPlan(user, min, await loadTiers(r))) {
      return c.json({ detail: `requires an active ${min} plan`, plan: min }, 402);
    }
    await next();
  };
}
