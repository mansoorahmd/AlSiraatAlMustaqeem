// Roles — a person's standing: what they may DO (features). The ladder is data (role_levels,
// role-ladder.ts): a maintainer adds learner rungs such as student and scholar. Three rungs are
// FIXED because the staff powers hang on them, and their ranks never change:
//
//   reader 0  ·  (learner rungs, 1–79, e.g. student 10 · researcher 20 · scholar 30)  ·
//   moderator 80 (review)  ·  maintainer 100 (administer)
//
// This file stays free of the database: a principal carries its role's rank (loaded with it at
// sign-in, invites.ts loadPrincipal), so a guard is a comparison. Features whose minimum is the
// maintainer's choice (publishing) are guarded by requireFeature in role-ladder.ts.

import type { MiddlewareHandler } from "hono";

export type Role = string;

/** The fixed rungs and their ranks — seeded by migration 0009, never editable. */
export const FIXED_ROLES = { reader: 0, moderator: 80, maintainer: 100 } as const;
export type FixedRole = keyof typeof FIXED_ROLES;
/** Learner rungs sit strictly between reader and moderator. */
export const LEARNER_RANKS = { min: 1, max: FIXED_ROLES.moderator - 1 };
/** Ranks of the seeded rungs, for a principal built without its rank (tests, old callers). */
const SEEDED: Record<string, number> = { ...FIXED_ROLES, student: 10, researcher: 20, scholar: 30 };

export interface Principal {
  id: string;
  role: Role;
  /** the role's rank on the ladder (loaded with the principal); higher may do more */
  roleRank?: number;
  // The billing axis (see plans.ts): a tier name from plan_tiers.
  plan?: string;
  planExpiresAt?: string | null;
  /** How they signed in: the app's session cookie, or a personal API token (session.ts). */
  via?: "session" | "token";
}

/** Hono env: the authenticated principal lives in c.var.user. */
export type Env = { Variables: { user?: Principal } };

/** A principal's rank — unknown roles rank below everyone (fail closed). */
export const rankOf = (p: Pick<Principal, "role" | "roleRank">): number =>
  p.roleRank ?? SEEDED[p.role] ?? -1;

/** True if this principal is at or above a fixed rung. */
export const atLeast = (p: Pick<Principal, "role" | "roleRank">, min: FixedRole): boolean =>
  rankOf(p) >= FIXED_ROLES[min];

/** Staff see everything they must review, whatever its audience. */
export const isStaff = (p: Pick<Principal, "role" | "roleRank"> | undefined): boolean =>
  !!p && atLeast(p, "moderator");

const TOKEN_REFUSED = "an API token can't do this — sign in to the app";

/**
 * Guard a route at a fixed rung. 401 if unauthenticated, 403 if below it.
 *
 * Maintainer powers need a signed-in SESSION, never an API token: a token lives in an AI
 * client's config, where it can leak or be steered by a prompt, and administering (roles, plans,
 * access rules, invites) is exactly what a leaked credential must not reach.
 */
export function requireRole(min: FixedRole): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "authentication required" }, 401);
    if (!atLeast(user, min)) return c.json({ detail: `requires role: ${min}` }, 403);
    if (min === "maintainer" && user.via === "token") return c.json({ detail: TOKEN_REFUSED }, 403);
    await next();
  };
}

/**
 * Session only. For managing the tokens themselves: if a token could mint tokens, revoking a
 * leaked one wouldn't contain the leak — the holder would already have minted a fresh one.
 */
export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "authentication required" }, 401);
  if (user.via === "token") return c.json({ detail: TOKEN_REFUSED }, 403);
  await next();
};
