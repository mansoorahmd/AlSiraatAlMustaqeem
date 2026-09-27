// The plan ladder is the monetization gate — the twin of role-boundary.test.ts. It proves the
// middleware: unauthenticated is 401, an active paid plan passes, and no plan / a wrong plan /
// a LAPSED plan is 402 (Payment Required). Same spirit as the role and write-boundary tests —
// the gate is mechanical and tested, not trusted.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireRole, type Env, type Principal } from "../src/roles.js";
import {
  requirePlan, planActive, atLeastPlan, planExpired, isPlan, PLANS,
} from "../src/plans.js";

// a tiny app: a test-only middleware injects the principal from headers, then routes are guarded.
function makeApp() {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    const role = c.req.header("x-test-role");
    if (role) {
      const user: Principal = {
        id: "u1",
        role: role as never,
        plan: (c.req.header("x-test-plan") as never) ?? "free",
        planExpiresAt: c.req.header("x-test-plan-expires") ?? null,
      };
      c.set("user", user);
    }
    await next();
  });
  // A paid feature needs BOTH: the role to be allowed, and the plan to have paid for it.
  app.get("/paid", requireRole("reader"), requirePlan("pro"), (c) => c.text("ok"));
  return app;
}

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

describe("plan ladder", () => {
  it("orders plans low → high", () => {
    expect([...PLANS]).toEqual(["free", "pro"]);
  });
  it("atLeastPlan compares rungs", () => {
    expect(atLeastPlan("pro", "free")).toBe(true);
    expect(atLeastPlan("pro", "pro")).toBe(true);
    expect(atLeastPlan("free", "pro")).toBe(false);
  });
  it("isPlan rejects junk", () => {
    expect(isPlan("pro")).toBe(true);
    expect(isPlan("platinum")).toBe(false);
    expect(isPlan(undefined)).toBe(false);
  });
  it("planExpired: null never expires, past does, future does not", () => {
    expect(planExpired(null)).toBe(false);
    expect(planExpired(iso(-1000))).toBe(true);
    expect(planExpired(iso(60_000))).toBe(false);
  });
  it("planActive requires paid, high-enough, and not lapsed", () => {
    expect(planActive({ plan: "pro", planExpiresAt: null })).toBe(true);
    expect(planActive({ plan: "pro", planExpiresAt: iso(60_000) })).toBe(true);
    expect(planActive({ plan: "free", planExpiresAt: null })).toBe(false);
    expect(planActive({ plan: "pro", planExpiresAt: iso(-1000) })).toBe(false);
    expect(planActive({})).toBe(false);
  });
});

describe("requirePlan middleware", () => {
  const app = makeApp();
  const get = (headers: Record<string, string> = {}) => app.request("/paid", { headers });

  it("401 when unauthenticated", async () => {
    expect((await get()).status).toBe(401);
  });
  it("402 with a role but no paid plan", async () => {
    expect((await get({ "x-test-role": "researcher", "x-test-plan": "free" })).status).toBe(402);
  });
  it("passes with an active pro plan", async () => {
    expect((await get({ "x-test-role": "reader", "x-test-plan": "pro" })).status).toBe(200);
  });
  it("402 when the pro plan has lapsed", async () => {
    const res = await get({ "x-test-role": "maintainer", "x-test-plan": "pro", "x-test-plan-expires": iso(-1000) });
    expect(res.status).toBe(402);
  });
  it("402 body names the required plan", async () => {
    const res = await get({ "x-test-role": "researcher", "x-test-plan": "free" });
    expect(await res.json()).toMatchObject({ plan: "pro" });
  });
});
