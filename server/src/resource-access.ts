// Plans decide what you may USE; roles decide what you may DO (roles.ts). One table
// (resource_access) holds the lowest plan tier for each thing a plan can unlock:
//
//   feature <key>        every plan feature (plan-features.ts: text, search, notes, cases, …) —
//                        one rule each, set in Admin → Access. Corpus reads answer 401 / 402 by
//                        it; the reader's own records become read-only when it is locked.
//   translation <id>,    optional extra rules on single items; an item the caller's plan doesn't
//   lexicon <source>     reach is LEFT OUT of results rather than failing the request
//
// A rule's min_plan is a tier name, 'free' (any signed-in account), or null = PUBLIC (no sign-in).
// Everything fails CLOSED: a missing feature rule reads as `pro`, an unknown tier never passes.
// Rules are cached per runner for CACHE_MS; a change made here applies at once in this process.

import type { Context, MiddlewareHandler } from "hono";
import type { SqlRunner } from "./migrate.js";
import type { Env, Principal } from "./roles.js";
import { loadTiers, meetsPlan, TierError, type Tiers } from "./plans.js";
import {
  FEATURES, FEATURE_KEYS, isPlanFeature, featureLabel, featureForCorpus, featureForResearch, type PlanFeature,
} from "./plan-features.js";

export const RESOURCE_KINDS = ["feature", "translation", "lexicon"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const isResourceKind = (v: unknown): v is ResourceKind =>
  typeof v === "string" && (RESOURCE_KINDS as readonly string[]).includes(v);

/** When a feature rule is missing, the strictest sensible default. */
const FALLBACK_MIN = "pro";
const CACHE_MS = 10_000;
const cache = new WeakMap<SqlRunner, { rules: Map<string, string | null>; at: number }>();
const id = (kind: ResourceKind, key: string) => `${kind}:${key}`;

export interface Rule { kind: ResourceKind; key: string; minPlan: string | null }

async function rules(r: SqlRunner): Promise<Map<string, string | null>> {
  const hit = cache.get(r);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rules;
  const rows = await r.query(`SELECT kind, "key", min_plan FROM resource_access`);
  const m = new Map(rows.map((x) =>
    [id(x.kind as ResourceKind, String(x.key)), x.min_plan == null ? null : String(x.min_plan)] as const));
  cache.set(r, { rules: m, at: Date.now() });
  return m;
}

export const clearResourceAccessCache = (r: SqlRunner): void => { cache.delete(r); };

/** Every rule, features first (in their list order), for the admin screen and the public GET. */
export async function listRules(r: SqlRunner): Promise<Rule[]> {
  const order = (k: string) => RESOURCE_KINDS.indexOf(k as ResourceKind);
  const featureOrder = (key: string) => FEATURE_KEYS.indexOf(key);
  return [...(await rules(r))].map(([k, minPlan]) => {
    const [kind, ...rest] = k.split(":");
    return { kind: kind as ResourceKind, key: rest.join(":"), minPlan };
  }).sort((a, b) => order(a.kind) - order(b.kind) ||
    (a.kind === "feature" ? featureOrder(a.key) - featureOrder(b.key) : a.key.localeCompare(b.key, "en", { numeric: true })));
}

/** The minimum for one feature (fail closed when absent). */
export async function featureMin(r: SqlRunner, key: PlanFeature): Promise<string | null> {
  const m = await rules(r);
  return m.has(id("feature", key)) ? m.get(id("feature", key))! : FALLBACK_MIN;
}

/** May this caller read something whose minimum is `minPlan`? null = public. */
export const canRead = (user: Principal | undefined, minPlan: string | null, tiers: Tiers): boolean =>
  minPlan === null || (!!user && meetsPlan(user, minPlan, tiers));

/** Every feature → may this caller use it — what /me tells the app, so it can show the locks. */
export async function featuresFor(r: SqlRunner, user: Principal | undefined): Promise<Record<PlanFeature, boolean>> {
  const tiers = await loadTiers(r);
  const out = {} as Record<PlanFeature, boolean>;
  for (const f of FEATURES) out[f.key] = canRead(user, await featureMin(r, f.key), tiers);
  return out;
}

function assertShape(kind: ResourceKind, key: string): void {
  if (!isResourceKind(kind)) throw new TierError(`kind must be one of ${RESOURCE_KINDS.join(", ")}`, 422);
  if (kind === "feature") {
    if (!isPlanFeature(key)) throw new TierError(`no such feature: "${key}" (features: ${FEATURE_KEYS.join(", ")})`, 422);
    return;
  }
  // A rule only protects what its key exactly matches, so a near-miss key ("05", "lane ")
  // would protect nothing while looking set. Insist on the canonical form.
  if (kind === "translation" && !/^[1-9]\d{0,8}$/.test(key)) {
    throw new TierError(`a translation key is its resource id, e.g. 131 (got "${key}")`, 422);
  }
  if (kind === "lexicon" && !/^[a-z0-9_]{1,64}$/.test(key)) {
    throw new TierError(`a lexicon key is its source name, e.g. lane (got "${key}")`, 422);
  }
}

/** Set a resource's minimum tier (null = public). A maintainer act. */
export async function setRule(
  r: SqlRunner, kind: ResourceKind, key: string, minPlan: string | null, byUserId: string | null = null,
): Promise<Rule> {
  assertShape(kind, key);
  if (minPlan !== null) {
    const tiers = await loadTiers(r);
    if (!tiers.has(minPlan)) {
      throw new TierError(`unknown plan tier: ${minPlan} (tiers: ${[...tiers.keys()].join(", ")})`, 422);
    }
  }
  await r.query(
    `INSERT INTO resource_access (kind, "key", min_plan, updated_at, updated_by)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (kind, "key") DO UPDATE SET min_plan = excluded.min_plan,
       updated_at = now(), updated_by = excluded.updated_by`,
    [kind, key, minPlan, byUserId]);
  cache.delete(r);
  return { kind, key, minPlan };
}

/** Drop a per-item rule, so the item needs nothing beyond its feature. */
export async function removeRule(r: SqlRunner, kind: ResourceKind, key: string): Promise<void> {
  assertShape(kind, key);
  if (kind === "feature") throw new TierError("a feature always has a rule — set it to public instead", 409);
  await r.query(`DELETE FROM resource_access WHERE kind = $1 AND "key" = $2`, [kind, key]);
  cache.delete(r);
}

/**
 * The refusal for a feature this caller may not use, or null when they may. 401 when it needs a
 * sign-in the caller lacks, 402 when it needs a tier they don't reach. The body names the feature
 * and tier, so the app and the MCP can say exactly what's needed.
 */
async function refusal(r: SqlRunner, c: Context<Env>, keys: PlanFeature[]): Promise<Response | null> {
  const tiers = await loadTiers(r);
  const user = c.get("user");
  let first: { key: PlanFeature; min: string } | null = null;
  for (const key of keys) {
    const min = await featureMin(r, key);
    if (canRead(user, min, tiers)) return null;          // any one of them is enough
    first ??= { key, min: min! };
  }
  if (!first) return null;
  const body = { resource: "feature", feature: first.key, plan: first.min };
  const what = featureLabel(first.key);
  return user
    ? c.json({ ...body, detail: `${what} needs an active ${first.min} plan` }, 402)
    : c.json({ ...body, detail: `sign in to use ${what}` }, 401);
}

/** Guard routes behind one feature. */
export function requirePlanFeature(key: PlanFeature, r: SqlRunner): MiddlewareHandler<Env> {
  return async (c, next) => (await refusal(r, c, [key])) ?? next();
}

/** Guard /corpus: each read answers by the feature it uses (plan-features.ts). */
export function requireCorpusFeature(r: SqlRunner): MiddlewareHandler<Env> {
  return async (c, next) =>
    (await refusal(r, c, [featureForCorpus(c.req.method, c.req.path.replace(/^\/corpus/, ""))])) ?? next();
}

/** Guard /research writes: a locked feature's records stay readable but can't be changed. */
export function requireResearchFeature(r: SqlRunner): MiddlewareHandler<Env> {
  return async (c, next) => {
    const f = featureForResearch(c.req.method, c.req.path);
    if (!f) return next();
    return (await refusal(r, c, Array.isArray(f) ? f : [f])) ?? next();
  };
}

/** May this caller use a feature? (for filtering inside an answer, corpus/serve.ts) */
export async function mayUse(r: SqlRunner, user: Principal | undefined, key: PlanFeature): Promise<boolean> {
  return canRead(user, await featureMin(r, key), await loadTiers(r));
}

/**
 * Which items of a per-item kind this caller may read — a predicate the content layer applies,
 * knowing nothing about plans. An item with no rule is always allowed.
 */
export async function itemFilter(
  r: SqlRunner, user: Principal | undefined, kind: "translation" | "lexicon",
): Promise<(key: string | number) => boolean> {
  // the item's own feature first: locked meanings / translations leave every item out
  if (!(await mayUse(r, user, kind === "lexicon" ? "meanings" : "translations"))) return () => false;
  const m = await rules(r);
  const prefix = `${kind}:`;
  if (![...m.keys()].some((k) => k.startsWith(prefix))) return () => true;
  const tiers = await loadTiers(r);
  return (key) => {
    const k = id(kind, String(key));
    return !m.has(k) || canRead(user, m.get(k)!, tiers);
  };
}
