// The plan ladder is the monetization gate — the twin of role-boundary.test.ts. The ladder is
// DATA now (plan_tiers), so these tests build one: free < student < pro < scholar. They prove the
// predicate, including every way it must fail CLOSED: an unknown tier on the account, an unknown
// tier in the gate, and a lapsed plan (which counts as free). The guards that use it, and the
// rule that staff pass them, are in access.test.ts.

import { describe, it, expect } from "vitest";
import { meetsPlan, effectiveRank, rankOf, planExpired, isTierName, type Tiers } from "../src/plans.js";

const LADDER = [
  { name: "free", rank: 0, label: "Free" },
  { name: "student", rank: 50, label: "Student" },
  { name: "pro", rank: 100, label: "Pro" },
  { name: "scholar", rank: 200, label: "Scholar" },
];
const tiers: Tiers = new Map(LADDER.map((t) => [t.name, t]));

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
