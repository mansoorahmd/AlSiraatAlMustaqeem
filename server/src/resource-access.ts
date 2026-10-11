// Resources are plan-based. One table (resource_access) says the lowest plan tier that may read
// each resource; features stay role-based (roles.ts). The two rules together:
//
//   a FEATURE (publish, review, establish, administer)   → requireRole(min role)
//   a RESOURCE (corpus, community, a translation, a lexicon) → requireResource / itemFilter
//
// Resources come in two shapes:
//   whole    corpus, community — one rule each (key '*'); guards a set of routes: 401 / 402
//   per-item translation <id>, lexicon <source> — optional extra rules; an item the caller's plan
//            doesn't reach is LEFT OUT of results rather than failing the request
//
// A rule's min_plan is a tier name, 'free' (any signed-in account), or null = PUBLIC (no sign-in).
// Everything fails CLOSED: a missing whole-kind rule reads as `pro`, an unknown tier never passes.
// Rules are cached per runner for CACHE_MS; a change made here applies at once in this process.

import type { MiddlewareHandler } from "hono";
import type { SqlRunner } from "./migrate.js";
import type { Env, Principal } from "./roles.js";
import { loadTiers, meetsPlan, TierError, type Tiers } from "./plans.js";

export const RESOURCE_KINDS = ["corpus", "community", "translation", "lexicon"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export type WholeKind = "corpus" | "community";

export const isResourceKind = (v: unknown): v is ResourceKind =>
  typeof v === "string" && (RESOURCE_KINDS as readonly string[]).includes(v);
export const isWholeKind = (k: ResourceKind): k is WholeKind => k === "corpus" || k === "community";

const LABEL: Record<ResourceKind, string> = {
  corpus: "the corpus", community: "the community's readings",
  translation: "this translation", lexicon: "this dictionary",
};

/** When a whole-kind rule is missing, the strictest sensible default. */
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

/** Every rule, whole kinds first, for the admin screen and the public GET. */
export async function listRules(r: SqlRunner): Promise<Rule[]> {
  const order = (k: string) => RESOURCE_KINDS.indexOf(k as ResourceKind);
  return [...(await rules(r))].map(([k, minPlan]) => {
    const [kind, ...rest] = k.split(":");
    return { kind: kind as ResourceKind, key: rest.join(":"), minPlan };
  }).sort((a, b) => order(a.kind) - order(b.kind) || a.key.localeCompare(b.key, "en", { numeric: true }));
}

/** The minimum for a whole kind (fail closed when absent). */
export async function wholeMin(r: SqlRunner, kind: WholeKind): Promise<string | null> {
  const m = await rules(r);
  return m.has(id(kind, "*")) ? m.get(id(kind, "*"))! : FALLBACK_MIN;
}

/** May this caller read something whose minimum is `minPlan`? null = public. */
export const canRead = (user: Principal | undefined, minPlan: string | null, tiers: Tiers): boolean =>
  minPlan === null || (!!user && meetsPlan(user, minPlan, tiers));

function assertShape(kind: ResourceKind, key: string): void {
  if (!isResourceKind(kind)) throw new TierError(`kind must be one of ${RESOURCE_KINDS.join(", ")}`, 422);
  if (isWholeKind(kind) ? key !== "*" : (!key || key === "*")) {
    throw new TierError(isWholeKind(kind)
      ? `${kind} is a whole resource — its key is *`
      : `${kind} rules name one ${kind} (a key, not *)`, 422);
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

/** Drop a per-item rule, so the item needs nothing beyond its whole kind. */
export async function removeRule(r: SqlRunner, kind: ResourceKind, key: string): Promise<void> {
  assertShape(kind, key);
  if (isWholeKind(kind)) throw new TierError(`${kind} always has a rule — set it to public instead`, 409);
  await r.query(`DELETE FROM resource_access WHERE kind = $1 AND "key" = $2`, [kind, key]);
  cache.delete(r);
}

/**
 * Guard routes behind a whole resource. 401 when it needs a sign-in the caller lacks, 402 when
 * it needs a tier they don't reach. The body names the resource and tier, so the app can say
 * exactly what's needed.
 */
export function requireResource(kind: WholeKind, r: SqlRunner): MiddlewareHandler<Env> {
  return async (c, next) => {
    const min = await wholeMin(r, kind);
    if (min === null) return next();
    const user = c.get("user");
    if (!user) return c.json({ detail: `sign in to read ${LABEL[kind]}`, resource: kind, plan: min }, 401);
    if (!meetsPlan(user, min, await loadTiers(r))) {
      return c.json({ detail: `${LABEL[kind]} needs an active ${min} plan`, resource: kind, plan: min }, 402);
    }
    await next();
  };
}

/**
 * Which items of a per-item kind this caller may read — a predicate the content layer applies,
 * knowing nothing about plans. An item with no rule is always allowed.
 */
export async function itemFilter(
  r: SqlRunner, user: Principal | undefined, kind: "translation" | "lexicon",
): Promise<(key: string | number) => boolean> {
  const m = await rules(r);
  const prefix = `${kind}:`;
  if (![...m.keys()].some((k) => k.startsWith(prefix))) return () => true;
  const tiers = await loadTiers(r);
  return (key) => {
    const k = id(kind, String(key));
    return !m.has(k) || canRead(user, m.get(k)!, tiers);
  };
}
