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
}

/** Hono env: the authenticated principal lives in c.var.user. */
export type Env = { Variables: { user?: Principal } };

/** Guard a route at a minimum role. 401 if unauthenticated, 403 if below the rung. */
export function requireRole(min: Role): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "authentication required" }, 401);
    if (!isRole(user.role) || !atLeast(user.role, min)) {
      return c.json({ detail: `requires role: ${min}` }, 403);
    }
    await next();
  };
}
