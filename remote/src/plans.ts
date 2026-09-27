// The billing/entitlement ladder and its guard — hand-rolled, and deliberately the twin of
// roles.ts. `role` says what you may do in the research process; `plan` says what you have paid
// for. They are ORTHOGONAL: a researcher on the free plan may study locally and even hold a
// moderator role, but the server-gated features (community reads, publishing, cloud MCP) require
// an ACTIVE paid plan. This module is the single enforcement point.
//
// Enforcement lives here, on the server, on purpose: a client-side lock ships on the user's disk
// and is bypassable, but the gated DATA lives on the remote, so requirePlan is real (see the
// monetization plan). Billing is not wired yet — a maintainer grants a plan out of band
// (set-plan CLI) or over HTTP (POST /plan); `planExpiresAt` lets it lapse.

import type { MiddlewareHandler } from "hono";
import type { Env } from "./roles.js";

export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export const isPlan = (p: unknown): p is Plan =>
  typeof p === "string" && (PLANS as readonly string[]).includes(p);

const rank = (p: Plan): number => PLANS.indexOf(p);

/** True if `plan` sits at or above `min` on the ladder (ignores expiry — see planActive). */
export const atLeastPlan = (plan: Plan, min: Plan): boolean => rank(plan) >= rank(min);

/** Has this plan lapsed? A NULL expiry never lapses (a manual grant with no end date). */
export const planExpired = (expiresAt: string | null | undefined): boolean =>
  expiresAt != null && new Date(expiresAt).getTime() < Date.now();

/** The one predicate the whole feature gate turns on: paid, high enough, and not lapsed. */
export function planActive(
  p: { plan?: Plan; planExpiresAt?: string | null },
  min: Plan = "pro",
): boolean {
  return !!p.plan && atLeastPlan(p.plan, min) && !planExpired(p.planExpiresAt);
}

/**
 * Guard a route behind an active paid plan. 401 if unauthenticated, 402 (Payment Required — the
 * semantically exact status) if the caller has no active plan at or above `min`. Sits AFTER
 * requireRole where a route needs both: role answers "are you allowed to", plan answers
 * "have you paid for it".
 */
export function requirePlan(min: Plan = "pro"): MiddlewareHandler<Env> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "authentication required" }, 401);
    if (!planActive(user, min)) {
      return c.json({ detail: `requires an active ${min} plan`, plan: min }, 402);
    }
    await next();
  };
}
