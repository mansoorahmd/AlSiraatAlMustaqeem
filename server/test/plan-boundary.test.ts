// The plan ladder is the monetization gate — the twin of role-boundary.test.ts. The ladder is
// DATA now (plan_tiers), so these tests build one: free < student < pro < scholar. They prove the
// predicate and the middleware, including every way the gate must fail CLOSED: an unknown tier on
// the account, an unknown tier in the gate, and a lapsed plan (which counts as free).

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { SqlRunner } from "../src/migrate.js";
import { requireRole, type Env, type Principal } from "../src/roles.js";
import {
  requirePlan, meetsPlan, effectiveRank, rankOf, planExpired, isTierName, type Tiers,
} from "../src/plans.js";

const LADDER = [
  { name: "free", rank: 0, label: "Free" },
  { name: "student", rank: 50, label: "Student" },
  { name: "pro", rank: 100, label: "Pro" },
  { name: "scholar", rank: 200, label: "Scholar" },
];
const tiers: Tiers = new Map(LADDER.map((t) => [t.name, t]));
/** A runner that answers the tier query — all requirePlan reads. */
const runner: SqlRunner = { exec: async () => {}, query: async () => LADDER };

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const acct = (plan: string, expires: string | null = null) => ({ plan, planExpiresAt: expires });

describe("the plan ladder", () => {
  it("ranks come from the ladder; an unknown tier is -1", () => {
    expect(rankOf(tiers, "scholar")).toBe(200);
    expect(rankOf(tiers, "platinum")).toBe(-1);
    expect(rankOf(tiers, undefined)).toBe(-1);
  });
  it("tier names are lower-case identifiers", () => {
    expect(isTierName("scholar")).toBe(true);
    expect(isTierName("Scholar")).toBe(false);
    expect(isTierName("2nd")).toBe(false);
  });
  it("planExpired: null never expires, past does, future does not", () => {
    expect(planExpired(null)).toBe(false);
    expect(planExpired(iso(-1000))).toBe(true);
    expect(planExpired(iso(60_000))).toBe(false);
  });
  it("a lapsed plan counts as free", () => {
    expect(effectiveRank(acct("scholar"), tiers)).toBe(200);
    expect(effectiveRank(acct("scholar", iso(-1000)), tiers)).toBe(0);
  });
});

describe("meetsPlan", () => {
  it("a higher tier clears a lower gate; a lower tier doesn't", () => {
    expect(meetsPlan(acct("scholar"), "pro", tiers)).toBe(true);
    expect(meetsPlan(acct("pro"), "pro", tiers)).toBe(true);
    expect(meetsPlan(acct("student"), "pro", tiers)).toBe(false);
  });
  it("every known tier meets a free gate", () => {
    for (const t of LADDER) expect(meetsPlan(acct(t.name), "free", tiers)).toBe(true);
  });
  it("a lapsed scholar is free: fails pro, still meets free", () => {
    expect(meetsPlan(acct("scholar", iso(-1000)), "pro", tiers)).toBe(false);
    expect(meetsPlan(acct("scholar", iso(-1000)), "free", tiers)).toBe(true);
  });
  it("fails closed on an unknown tier — on the account or in the gate", () => {
    expect(meetsPlan(acct("platinum"), "free", tiers)).toBe(false);
    expect(meetsPlan(acct("scholar"), "platinum", tiers)).toBe(false);
  });
});

describe("requirePlan middleware", () => {
  function makeApp() {
    const app = new Hono<Env>();
    app.use("*", async (c, next) => {
      const role = c.req.header("x-test-role");
      if (role) {
        const user: Principal = {
          id: "u1", role: role as never,
          plan: c.req.header("x-test-plan") ?? "free",
          planExpiresAt: c.req.header("x-test-plan-expires") ?? null,
        };
        c.set("user", user);
      }
      await next();
    });
    // a paid feature needs BOTH: the role to be allowed, and the tier to have paid for it
    app.get("/pro", requireRole("reader"), requirePlan("pro", runner), (c) => c.text("ok"));
    app.get("/scholar", requireRole("reader"), requirePlan("scholar", runner), (c) => c.text("ok"));
    return app;
  }
  const app = makeApp();
  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });

  it("401 when unauthenticated", async () => {
    expect((await get("/pro")).status).toBe(401);
  });
  it("402 below the tier, naming the tier required", async () => {
    const res = await get("/pro", { "x-test-role": "researcher", "x-test-plan": "student" });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ plan: "pro" });
  });
  it("passes at or above the tier", async () => {
    expect((await get("/pro", { "x-test-role": "reader", "x-test-plan": "pro" })).status).toBe(200);
    expect((await get("/pro", { "x-test-role": "reader", "x-test-plan": "scholar" })).status).toBe(200);
  });
  it("a pro account can't reach a scholar-only feature", async () => {
    expect((await get("/scholar", { "x-test-role": "reader", "x-test-plan": "pro" })).status).toBe(402);
  });
  it("402 when the plan has lapsed, whatever the role", async () => {
    const res = await get("/pro", { "x-test-role": "maintainer", "x-test-plan": "scholar", "x-test-plan-expires": iso(-1000) });
    expect(res.status).toBe(402);
  });
});
