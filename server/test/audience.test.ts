// Roles as a ladder of data, a configurable role for publishing, and the audience on every
// published result: who may see it (at least a role, at least a plan), proposed by the author and
// confirmed or changed by the reviewer. Against real Postgres (PGlite).

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import type { Env, Principal } from "../src/roles.js";
import {
  listRoles, setRoleLevel, removeRoleLevel, requireFeature, setFeatureMinRole, clearRoleCache,
  validAudience, makeAudienceCheck,
} from "../src/role-ladder.js";
import { proposeClaim, establish, setAudience, claimsFor, globalReading, communityReadingsFor } from "../src/claims.js";
import { pullSince, ZERO_CURSORS } from "../src/pull.js";
import { clearTierCache } from "../src/plans.js";
import { pgliteRunner } from "./fixtures/corpus-fixture.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let r: SqlRunner;
let author: string;

beforeAll(async () => {
  r = pgliteRunner().r;
  await runMigrations(r, MIGR);
});

beforeEach(async () => {
  await r.exec(`DELETE FROM reviews; DELETE FROM dissents; DELETE FROM global_forms; DELETE FROM claim_versions;
                DELETE FROM claims; DELETE FROM users;
                UPDATE feature_access SET min_role = 'researcher';
                DELETE FROM role_levels WHERE name NOT IN ('reader','student','researcher','scholar','moderator','maintainer');
                INSERT INTO role_levels (name, rank, label) VALUES ('student', 10, 'Student'), ('scholar', 30, 'Scholar')
                  ON CONFLICT (name) DO NOTHING;`);
  clearRoleCache(r); clearTierCache(r);
  author = String((await r.query(`INSERT INTO users (email, role) VALUES ('author@x.org', 'scholar') RETURNING id`))[0]!.id);
});

const viewer = (role: string, rank: number, plan = "free"): Principal => ({ id: `v-${role}-${plan}`, role, roleRank: rank, plan });

describe("the role ladder is data", () => {
  it("seeded low → high: reader < student < researcher < scholar < moderator < maintainer", async () => {
    expect((await listRoles(r)).map((x) => x.name)).toEqual(["reader", "student", "researcher", "scholar", "moderator", "maintainer"]);
  });

  it("a maintainer adds a learner rung between reader and moderator", async () => {
    await setRoleLevel(r, { name: "senior-scholar", rank: 40, label: "Senior scholar" });
    expect((await listRoles(r)).map((x) => x.name)).toContain("senior-scholar");
    await r.query(`UPDATE users SET role = 'senior-scholar' WHERE id = $1`, [author]);   // it can be held
  });

  it("refuses a malformed ladder: outside 1–79, a taken rank, moving a fixed rung", async () => {
    await expect(setRoleLevel(r, { name: "boss", rank: 90 })).rejects.toThrow(/between reader/);
    await expect(setRoleLevel(r, { name: "zero", rank: 0 })).rejects.toThrow(/between reader/);
    await expect(setRoleLevel(r, { name: "clash", rank: 30 })).rejects.toThrow(/already used by scholar/);
    await expect(setRoleLevel(r, { name: "moderator", rank: 50 })).rejects.toThrow(/fixed role/);
    await expect(setRoleLevel(r, { name: "Bad Name", rank: 5 })).rejects.toThrow(/lowercase/);
  });

  it("won't remove a fixed rung, or one somebody holds", async () => {
    await expect(removeRoleLevel(r, "moderator")).rejects.toThrow(/fixed/);
    await expect(removeRoleLevel(r, "scholar")).rejects.toThrow(/held by 1 account/);
    await removeRoleLevel(r, "student");
    expect((await listRoles(r)).map((x) => x.name)).not.toContain("student");
  });
});

describe("publishing needs the role the maintainer chose", () => {
  const appAs = (p: Principal) => {
    const app = new Hono<Env>();
    app.use("*", async (c, next) => { c.set("user", p); await next(); });
    app.post("/claims", requireFeature("publish", r), (c) => c.json({ ok: true }));
    return app;
  };
  const publish = (p: Principal) => appAs(p).request("/claims", { method: "POST" });

  it("researcher by default: a student can't, a researcher can", async () => {
    const no = await publish(viewer("student", 10));
    expect(no.status).toBe(403);
    expect(((await no.json()) as { detail: string }).detail).toMatch(/needs the researcher role/);
    expect((await publish(viewer("researcher", 20))).status).toBe(200);
  });

  it("the maintainer can open it to students", async () => {
    await setFeatureMinRole(r, "publish", "student");
    expect((await publish(viewer("student", 10))).status).toBe(200);
    expect((await publish(viewer("reader", 0))).status).toBe(403);
  });
});

describe("the audience of a published result", () => {
  const scholarPro = { minRole: "scholar", minPlan: "pro" };
  async function publishedFor(audience: { minRole: string | null; minPlan: string | null }, subject = "فلح") {
    const v = await proposeClaim(r, {
      authorId: author, subjectKind: "root", subjectValue: subject,
      payload: { meaning: "to attain the good", argument: "see 23:1" }, audience,
    });
    await establish(r, v.claimId, v.version);
    return v;
  }
  const sees = async (p: Principal | undefined, subject = "فلح") => {
    const see = await makeAudienceCheck(r, p);
    return {
      claims: (await claimsFor(r, "root", subject, see)).length,
      global: !!(await globalReading(r, "root", subject, see)),
      chips: (await communityReadingsFor(r, { root: subject }, see)).communityRoot.length,
      pulled: (await pullSince(r, ZERO_CURSORS, 500, see)).globalForms.length,
    };
  };
  const nothing = { claims: 0, global: false, chips: 0, pulled: 0 };
  const everything = { claims: 1, global: true, chips: 1, pulled: 1 };

  it("an audience must name real rungs and tiers", async () => {
    await expect(validAudience(r, { minRole: "wizard" })).rejects.toThrow(/unknown role/);
    await expect(validAudience(r, { minPlan: "gold" })).rejects.toThrow(/unknown plan/);
    expect(await validAudience(r, undefined)).toEqual({ minRole: null, minPlan: null });
  });

  it("'scholar + pro': hidden below the role or the plan, everywhere it could be read", async () => {
    await publishedFor(scholarPro);
    expect(await sees(viewer("reader", 0, "pro"))).toEqual(nothing);          // plan, but not the role
    expect(await sees(viewer("scholar", 30, "free"))).toEqual(nothing);       // role, but not the plan
    expect(await sees(viewer("scholar", 30, "pro"))).toEqual(everything);
    expect(await sees(undefined)).toEqual(nothing);                           // signed out
  });

  it("the author and the staff always see it", async () => {
    await publishedFor(scholarPro);
    expect(await sees({ id: author, role: "scholar", roleRank: 30, plan: "free" })).toEqual(everything);
    expect(await sees(viewer("moderator", 80))).toEqual(everything);
  });

  it("no audience = anyone the community rule already lets in", async () => {
    await publishedFor({ minRole: null, minPlan: null });
    expect(await sees(viewer("reader", 0))).toEqual(everything);
  });

  it("the reviewer confirms or changes what the publisher proposed", async () => {
    const v = await publishedFor(scholarPro);
    await setAudience(r, v.claimId, v.version, { minRole: "student", minPlan: null });
    expect(await sees(viewer("student", 10))).toEqual(everything);
    expect(await sees(viewer("reader", 0))).toEqual(nothing);
  });
});
