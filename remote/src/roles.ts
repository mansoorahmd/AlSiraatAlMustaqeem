// The role ladder and its guard — hand-rolled (not a permissions library) because a single
// linear ladder is simpler than CASL/Casbin and mirrors the local write-boundary guard.
// The auth layer (next step) sets c.get("user"); this middleware enforces the minimum rung.

import type { MiddlewareHandler } from "hono";

export const ROLES = ["reader", "researcher", "moderator", "maintainer"] as const;
export type Role = (typeof ROLES)[number];

export const isRole = (r: unknown): r is Role =>
  typeof r === "string" && (ROLES as readonly string[]).includes(r);

const rank = (r: Role): number => ROLES.indexOf(r);

/** True if `role` sits at or above `min` on the ladder. */
export const atLeast = (role: Role, min: Role): boolean => rank(role) >= rank(min);

export interface Principal {
  id: string;
  role: Role;
  // The billing axis (see plans.ts): a tier name from plan_tiers. Carried on the principal so
  // requirePlan reads it straight off c.var.user, exactly as requireRole reads the role.
  plan?: string;
  planExpiresAt?: string | null;
  /** How they signed in: the app's session cookie, or a personal API token (session.ts). */
  via?: "session" | "token";
}

/** Hono env: the authenticated principal lives in c.var.user. */
export type Env = { Variables: { user?: Principal } };

const TOKEN_REFUSED = "an API token can't do this — sign in to the app";

/**
 * Guard a route at a minimum role. 401 if unauthenticated, 403 if below the rung.
 *
 * Maintainer powers need a signed-in SESSION, never an API token: a token lives in an AI
 * client's config, where it can leak or be steered by a prompt, and administering (roles, plans,
 * access rules, invites) is exactly what a leaked credential must not reach.
 */
export function requireRole(min: Role): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "authentication required" }, 401);
    if (!isRole(user.role) || !atLeast(user.role, min)) {
      return c.json({ detail: `requires role: ${min}` }, 403);
    }
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
