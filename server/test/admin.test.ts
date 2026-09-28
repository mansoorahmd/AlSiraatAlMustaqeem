// The Admin screen's server side: users with their role and plan, role changes that can never
// leave the community without a maintainer, and every translation/dictionary with its rule —
// unfiltered, so a maintainer can unlock what their own plan can't see. PGlite, fixture corpus.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import { listUsers, setRole, listResources, AdminError } from "../src/admin.js";
import { setRule, clearResourceAccessCache } from "../src/resource-access.js";
import { setTier, clearTierCache } from "../src/plans.js";
import { migrateCorpus } from "../src/corpus/load.js";
import { makeFixture, pgliteRunner } from "./fixtures/corpus-fixture.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let r: SqlRunner;
let boss: string, amina: string;

beforeAll(async () => {
  r = pgliteRunner().r;
  await runMigrations(r, MIGR);
  await migrateCorpus({ sqlitePath: makeFixture("admin.db"), runner: r });
  await r.exec("SET search_path TO corpus, public");
});

beforeEach(async () => {
  await r.exec(`DELETE FROM resource_access WHERE kind IN ('translation', 'lexicon');
                DELETE FROM api_tokens; DELETE FROM users;
                DELETE FROM plan_tiers WHERE name NOT IN ('free', 'pro');`);
  clearTierCache(r);
  clearResourceAccessCache(r);
  const rows = await r.query(
    `INSERT INTO users (email, role, plan) VALUES ('boss@x.org', 'maintainer', 'pro'), ('amina@x.org', 'researcher', 'free')
     RETURNING id, email`);
  boss = String(rows.find((u) => u.email === "boss@x.org")!.id);
  amina = String(rows.find((u) => u.email === "amina@x.org")!.id);
});

describe("users", () => {
  it("lists every user with role and plan (oldest first, then by email)", async () => {
    const users = await listUsers(r);
    // both were created in one statement, so the email breaks the tie
    expect(users.map((u) => [u.email, u.role, u.plan])).toEqual([
      ["amina@x.org", "researcher", "free"], ["boss@x.org", "maintainer", "pro"],
    ]);
  });

  it("changes a role", async () => {
    await setRole(r, amina, "moderator");
    expect((await listUsers(r)).find((u) => u.id === amina)!.role).toBe("moderator");
  });

  it("won't demote the only maintainer — the community would have no administrator", async () => {
    await expect(setRole(r, boss, "reader")).rejects.toThrow(/only maintainer/);
    await setRole(r, amina, "maintainer");
    await setRole(r, boss, "reader");                // fine now: amina is a maintainer
    expect((await listUsers(r)).find((u) => u.id === boss)!.role).toBe("reader");
  });

  it("refuses an unknown role or user", async () => {
    await expect(setRole(r, amina, "wizard")).rejects.toBeInstanceOf(AdminError);
    await expect(setRole(r, "00000000-0000-0000-0000-000000000000", "reader")).rejects.toThrow(/no such user/);
  });
});

describe("resources, unfiltered", () => {
  it("lists every translation and dictionary, marking which carry a rule", async () => {
    await setTier(r, { name: "scholar", rank: 200 });
    await setRule(r, "translation", "131", "scholar");
    await setRule(r, "lexicon", "lane", null);
    const res = await listResources(r, r);
    expect(res.translations.map((t) => [t.id, t.minPlan, t.ruled])).toEqual([[20, null, false], [131, "scholar", true]]);
    expect(res.lexicons).toEqual([{ source: "lane", entries: 2, minPlan: null, ruled: true }]);
  });
});
