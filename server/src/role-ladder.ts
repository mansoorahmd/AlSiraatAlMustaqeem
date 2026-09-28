// The role ladder as data (role_levels), the features whose minimum role is the maintainer's
// choice (feature_access — publishing), and audiences: who may see a published result.
//
// Cached for 10 s per process, like plan tiers and resource rules; a change applies at once on
// the instance that made it. Everything fails closed: an unknown role ranks below everyone.

import type { MiddlewareHandler } from "hono";
import type { SqlRunner } from "./migrate.js";
import { FIXED_ROLES, LEARNER_RANKS, rankOf, isStaff, type Env, type Principal } from "./roles.js";
import { loadTiers, meetsPlan, TierError } from "./plans.js";

export interface RoleLevel { name: string; rank: number; label: string; fixed: boolean }
export const FEATURES = ["publish"] as const;
export type Feature = (typeof FEATURES)[number];

const TTL = 10_000;
const cache = new WeakMap<SqlRunner, { at: number; roles: Map<string, RoleLevel>; features: Map<string, string> }>();

async function load(r: SqlRunner) {
  const hit = cache.get(r);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const roles = new Map((await r.query("SELECT name, rank, label, fixed FROM role_levels ORDER BY rank"))
    .map((x) => [String(x.name), { name: String(x.name), rank: Number(x.rank), label: String(x.label ?? ""), fixed: !!x.fixed }]));
  const features = new Map((await r.query("SELECT feature, min_role FROM feature_access"))
    .map((x) => [String(x.feature), String(x.min_role)]));
  const fresh = { at: Date.now(), roles, features };
  cache.set(r, fresh);
  return fresh;
}
export const clearRoleCache = (r: SqlRunner) => cache.delete(r);

/** The ladder, lowest first. */
export async function listRoles(r: SqlRunner): Promise<RoleLevel[]> {
  return [...(await load(r)).roles.values()];
}
export async function roleExists(r: SqlRunner, name: string): Promise<boolean> {
  return (await load(r)).roles.has(name);
}
/** A role's rank; unknown = below everyone. */
export async function roleRank(r: SqlRunner, name: string | null | undefined): Promise<number> {
  if (!name) return -1;
  return (await load(r)).roles.get(name)?.rank ?? -1;
}

const NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** Add or change a LEARNER rung (fixed rungs can be relabelled only). */
export async function setRoleLevel(r: SqlRunner, opts: { name: string; rank?: number; label?: string }): Promise<RoleLevel> {
  const name = (opts.name ?? "").trim().toLowerCase();
  if (!NAME.test(name)) throw new TierError("a role name is lowercase letters, digits, - or _", 422);
  const current = (await load(r)).roles.get(name);
  if (current?.fixed) {
    if (opts.rank !== undefined && opts.rank !== current.rank) {
      throw new TierError(`${name} is a fixed role — its rank can't change`, 422);
    }
    await r.query("UPDATE role_levels SET label = $1 WHERE name = $2", [opts.label ?? current.label, name]);
  } else {
    const rank = Number(opts.rank ?? current?.rank);
    if (!Number.isInteger(rank) || rank < LEARNER_RANKS.min || rank > LEARNER_RANKS.max) {
      throw new TierError(`a role's rank sits between reader (0) and moderator (${FIXED_ROLES.moderator}): 1–${LEARNER_RANKS.max}`, 422);
    }
    const clash = [...(await load(r)).roles.values()].find((x) => x.rank === rank && x.name !== name);
    if (clash) throw new TierError(`rank ${rank} is already used by ${clash.name}`, 409);
    await r.query(
      `INSERT INTO role_levels (name, rank, label) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET rank = excluded.rank, label = excluded.label`,
      [name, rank, opts.label ?? current?.label ?? ""]);
  }
  clearRoleCache(r);
  return (await load(r)).roles.get(name)!;
}

/** Remove a learner rung nobody holds and nothing requires. */
export async function removeRoleLevel(r: SqlRunner, name: string): Promise<void> {
  const current = (await load(r)).roles.get(name);
  if (!current) throw new TierError(`no such role: ${name}`, 404);
  if (current.fixed) throw new TierError(`${name} is a fixed role`, 422);
  const [held] = await r.query("SELECT COUNT(*)::int AS n FROM users WHERE role = $1", [name]);
  const [invited] = await r.query("SELECT COUNT(*)::int AS n FROM invites WHERE role = $1 AND redeemed_by IS NULL", [name]);
  const [needed] = await r.query(
    `SELECT (SELECT COUNT(*) FROM feature_access WHERE min_role = $1)
          + (SELECT COUNT(*) FROM claim_versions WHERE audience_role = $1)
          + (SELECT COUNT(*) FROM submissions WHERE audience_role = $1) AS n`, [name]);
  const why = [
    Number(held?.n) ? `held by ${held!.n} account(s)` : "",
    Number(invited?.n) ? `on ${invited!.n} open invite(s)` : "",
    Number(needed?.n) ? `required by ${needed!.n} feature/result(s)` : "",
  ].filter(Boolean);
  if (why.length) throw new TierError(`can't remove ${name}: ${why.join(", ")}`, 409);
  await r.query("DELETE FROM role_levels WHERE name = $1", [name]);
  clearRoleCache(r);
}

// ---- features whose minimum role is configurable ----------------------------------

export async function featureMinRole(r: SqlRunner, feature: Feature): Promise<string> {
  return (await load(r)).features.get(feature) ?? "maintainer";   // fail closed
}
export async function listFeatures(r: SqlRunner): Promise<{ feature: Feature; minRole: string }[]> {
  const f = (await load(r)).features;
  return FEATURES.map((feature) => ({ feature, minRole: f.get(feature) ?? "maintainer" }));
}
export async function setFeatureMinRole(r: SqlRunner, feature: string, minRole: string): Promise<void> {
  if (!(FEATURES as readonly string[]).includes(feature)) throw new TierError(`unknown feature: ${feature}`, 422);
  if (!(await roleExists(r, minRole))) throw new TierError(`unknown role: ${minRole}`, 422);
  await r.query(
    `INSERT INTO feature_access (feature, min_role, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (feature) DO UPDATE SET min_role = excluded.min_role, updated_at = now()`, [feature, minRole]);
  clearRoleCache(r);
}

/** Guard a feature at the minimum role the maintainer chose for it. */
export function requireFeature(feature: Feature, r: SqlRunner): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "authentication required" }, 401);
    const min = await featureMinRole(r, feature);
    if (rankOf(user) < (await roleRank(r, min))) {
      return c.json({ detail: `${feature === "publish" ? "publishing" : feature} needs the ${min} role or higher`, role: min }, 403);
    }
    await next();
  };
}

// ---- audiences: who may see a published result ------------------------------------

export interface Audience { minRole: string | null; minPlan: string | null }

/** Check an audience a publisher or reviewer asked for: real rungs, real tiers (or none). */
export async function validAudience(r: SqlRunner, a: unknown): Promise<Audience> {
  const x = (a && typeof a === "object" ? a : {}) as { minRole?: unknown; minPlan?: unknown };
  const minRole = x.minRole == null || x.minRole === "" ? null : String(x.minRole);
  const minPlan = x.minPlan == null || x.minPlan === "" ? null : String(x.minPlan);
  if (minRole && !(await roleExists(r, minRole))) throw new TierError(`unknown role: ${minRole}`, 422);
  if (minPlan && !(await loadTiers(r)).has(minPlan)) throw new TierError(`unknown plan tier: ${minPlan}`, 422);
  return { minRole, minPlan };
}

/**
 * May this viewer see a result with this audience? Staff (moderator+) always may — they review
 * it; the author always may. Otherwise: role at least minRole AND plan at least minPlan.
 */
export async function makeAudienceCheck(r: SqlRunner, viewer: Principal | undefined) {
  const tiers = await loadTiers(r);
  const staff = isStaff(viewer);
  const rank = viewer ? rankOf(viewer) : -1;
  const ranks = (await load(r)).roles;
  return (a: { audience_role?: unknown; audience_plan?: unknown; author_id?: unknown }): boolean => {
    if (staff || (viewer && a.author_id != null && String(a.author_id) === viewer.id)) return true;
    const role = a.audience_role == null ? null : String(a.audience_role);
    const plan = a.audience_plan == null ? null : String(a.audience_plan);
    if (role && rank < (ranks.get(role)?.rank ?? Infinity)) return false;
    if (plan && !(viewer && meetsPlan(viewer, plan, tiers))) return false;
    return true;
  };
}
