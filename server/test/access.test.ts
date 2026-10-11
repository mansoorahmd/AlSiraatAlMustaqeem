// Features are role-based, resources are plan-based. This proves the resource half end to end:
// the tier ladder (data), whole resources (corpus, community) guarding routes with 401/402, and
// per-item resources (translations, lexicons) filtered out below their tier — through the real
// /corpus routes over the migrated fixture corpus. Against real Postgres (PGlite).

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import type { Env, Principal } from "../src/roles.js";
import { loadTiers, setTier, removeTier, clearTierCache, TierError } from "../src/plans.js";
import { setPlan } from "../src/invites.js";
import {
  listRules, setRule, removeRule, wholeMin, requireResource, itemFilter, clearResourceAccessCache,
} from "../src/resource-access.js";
import { corpusApp } from "../src/corpus/serve.js";
import { pgCorpus } from "../src/corpus/pg-corpus.js";
import { createCorpusServices } from "../../corpus-core/src/corpus-services.js";
import { migrateCorpus } from "../src/corpus/load.js";
import { makeFixture, pgliteRunner } from "./fixtures/corpus-fixture.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let r: SqlRunner;

beforeAll(async () => {
  r = pgliteRunner().r;
  await runMigrations(r, MIGR);
  await migrateCorpus({ sqlitePath: makeFixture("access.db"), runner: r });
  // one PGlite connection plays both pools: unqualified corpus tables resolve to `corpus`,
  // the app's own tables still to `public` (their names don't overlap)
  await r.exec("SET search_path TO corpus, public");
});

beforeEach(async () => {
  await r.exec(`DELETE FROM resource_access WHERE kind IN ('translation', 'lexicon');
                UPDATE resource_access SET min_plan = 'pro';
                DELETE FROM users;
                DELETE FROM plan_tiers WHERE name NOT IN ('free', 'pro');`);
  clearTierCache(r);
  clearResourceAccessCache(r);
});

const ladder = async () => {
  await setTier(r, { name: "student", rank: 50, label: "Student" });
  await setTier(r, { name: "scholar", rank: 200, label: "Scholar" });
};

describe("plan tiers are data", () => {
  it("free and pro are seeded, lowest first", async () => {
    expect([...(await loadTiers(r)).keys()]).toEqual(["free", "pro"]);
  });

  it("a maintainer adds tiers, and the ladder orders by rank", async () => {
    await ladder();
    expect([...(await loadTiers(r)).keys()]).toEqual(["free", "student", "pro", "scholar"]);
  });

  it("refuses a malformed ladder", async () => {
    await expect(setTier(r, { name: "free", rank: 5 })).rejects.toThrow(/free is always rank 0/);
    await expect(setTier(r, { name: "gold", rank: 0 })).rejects.toThrow(/reserved for free/);
    await expect(setTier(r, { name: "Gold!", rank: 5 })).rejects.toBeInstanceOf(TierError);
    await expect(setTier(r, { name: "gold", rank: 100 })).rejects.toThrow(/already used by pro/);
  });

  it("won't remove free, or a tier someone holds or a resource requires", async () => {
    await ladder();
    await expect(removeTier(r, "free")).rejects.toThrow();
    await expect(removeTier(r, "pro")).rejects.toThrow(/required by 2 resource/);   // corpus + community
    const [u] = await r.query(`INSERT INTO users (email, plan) VALUES ('s@x.org', 'student') RETURNING id`);
    await expect(removeTier(r, "student")).rejects.toThrow(/held by 1 account/);
    await setPlan(r, { userId: String(u!.id), plan: "free" });
    await removeTier(r, "student");
    expect((await loadTiers(r)).has("student")).toBe(false);
  });

  it("an account can only hold a tier that exists — in code and in the database", async () => {
    const [u] = await r.query(`INSERT INTO users (email) VALUES ('a@x.org') RETURNING id`);
    await expect(setPlan(r, { userId: String(u!.id), plan: "ghost" })).rejects.toThrow(/unknown plan tier/);
    await expect(r.query(`UPDATE users SET plan = 'ghost' WHERE id = $1`, [u!.id])).rejects.toThrow();
  });
});

describe("resource rules", () => {
  it("corpus and community are seeded at pro; nothing else is locked", async () => {
    expect(await listRules(r)).toEqual([
      { kind: "corpus", key: "*", minPlan: "pro" },
      { kind: "community", key: "*", minPlan: "pro" },
    ]);
  });

  it("a whole resource can be public, free, or any tier — never removed", async () => {
    await setRule(r, "corpus", "*", null);
    expect(await wholeMin(r, "corpus")).toBeNull();
    await setRule(r, "corpus", "*", "free");
    expect(await wholeMin(r, "corpus")).toBe("free");
    await expect(removeRule(r, "corpus", "*")).rejects.toThrow(/set it to public instead/);
  });

  it("refuses a malformed rule — in code and in the database", async () => {
    await expect(setRule(r, "corpus", "7", "pro")).rejects.toThrow(/its key is \*/);
    await expect(setRule(r, "translation", "*", "pro")).rejects.toThrow(/not \*/);
    await expect(setRule(r, "translation", "131", "ghost")).rejects.toThrow(/unknown plan tier/);
    await expect(r.query(`INSERT INTO resource_access (kind, "key") VALUES ('movies', 'x')`)).rejects.toThrow();
    await expect(r.query(`INSERT INTO resource_access (kind, "key") VALUES ('community', 'x')`)).rejects.toThrow();
  });
});

// A mini app: the principal comes from headers; the REAL resource guard and the REAL corpus routes.
function makeApp() {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    const plan = c.req.header("x-test-plan");
    if (plan) {
      const user: Principal = { id: "u1", role: "reader", plan, planExpiresAt: c.req.header("x-test-expires") ?? null };
      c.set("user", user);
    }
    await next();
  });
  app.get("/community-thing", requireResource("community", r), (c) => c.json({ ok: true }));
  app.use("/corpus/*", requireResource("corpus", r));
  app.route("/corpus", corpusApp(createCorpusServices(pgCorpus(r)), r));
  return app;
}
// built once the database exists — makeApp() at import time would capture an undefined runner
let app: Hono<Env>;
beforeAll(() => { app = makeApp(); });
const get = (path: string, plan?: string, expires?: string) => app.request(path, {
  headers: { ...(plan ? { "x-test-plan": plan } : {}), ...(expires ? { "x-test-expires": expires } : {}) },
});
const status = async (path: string, plan?: string, expires?: string) => (await get(path, plan, expires)).status;
const V = "/corpus/verses/1:1";

describe("a whole resource guards its routes", () => {
  it("pro (the default): anonymous 401, free 402, pro 200", async () => {
    expect(await status(V)).toBe(401);
    expect(await status(V, "free")).toBe(402);
    expect(await status(V, "pro")).toBe(200);
  });

  it("public: anyone, no sign-in", async () => {
    await setRule(r, "corpus", "*", null);
    expect(await status(V)).toBe(200);
  });

  it("free: anonymous 401, any signed-in account 200", async () => {
    await setRule(r, "corpus", "*", "free");
    expect(await status(V)).toBe(401);
    expect(await status(V, "free")).toBe(200);
  });

  it("scholar: pro is turned away naming scholar; scholar reads; a lapsed scholar doesn't", async () => {
    await ladder();
    await setRule(r, "corpus", "*", "scholar");
    const res = await get(V, "pro");
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ resource: "corpus", plan: "scholar" });
    expect(await status(V, "scholar")).toBe(200);
    expect(await status(V, "scholar", new Date(Date.now() - 1000).toISOString())).toBe(402);
  });

  it("the community resource is its own rule, independent of the corpus", async () => {
    await setRule(r, "corpus", "*", null);
    expect(await status("/community-thing")).toBe(401);          // community still at pro
    await setRule(r, "community", "*", null);
    expect(await status("/community-thing")).toBe(200);
  });
});

describe("per-item resources are filtered, not refused", () => {
  const ids = async (path: string, plan?: string) =>
    ((await (await get(path, plan)).json()) as { resource_id?: number; id?: number }[])
      .map((t) => t.resource_id ?? t.id);

  beforeEach(async () => {
    await ladder();
    await setRule(r, "corpus", "*", null);
    await setRule(r, "translation", "131", "scholar");
  });

  it("a translation below the caller's tier is left out; at the tier it's included", async () => {
    expect(await ids("/corpus/verses/1:1/translations")).toEqual([20]);
    expect(await ids("/corpus/verses/1:1/translations", "pro")).toEqual([20]);
    expect(await ids("/corpus/verses/1:1/translations", "scholar")).toEqual([20, 131]);
  });

  it("applies wherever translations appear — the verse and the resource list", async () => {
    const verse = async (plan?: string) =>
      ((await (await get("/corpus/verses/1:1?translations=true", plan)).json()) as { translations: { resource_id: number }[] })
        .translations.map((t) => t.resource_id);
    expect(await verse()).toEqual([20]);
    expect(await verse("scholar")).toEqual([20, 131]);
    expect(await ids("/corpus/translation-resources")).toEqual([20]);
    expect(await ids("/corpus/translation-resources", "scholar")).toEqual([20, 131]);
  });

  it("dropping the rule restores it", async () => {
    await removeRule(r, "translation", "131");
    expect(await ids("/corpus/verses/1:1/translations")).toEqual([20, 131]);
  });

  it("a dictionary below the caller's tier is left out of a root's meanings", async () => {
    await setRule(r, "lexicon", "lane", "student");
    const sources = async (plan?: string) =>
      ((await (await get("/corpus/roots/Hmd", plan)).json()) as { meanings: { source: string }[] })
        .meanings.map((m) => m.source);
    expect(await sources()).toEqual([]);                // anonymous: lane is locked
    expect(await sources("student")).toEqual(["lane"]);  // at the tier: included
  });

  it("a lexicon rule is the same predicate, keyed by source", async () => {
    await setRule(r, "lexicon", "lane", "student");
    const anon = await itemFilter(r, undefined, "lexicon");
    const student = await itemFilter(r, { id: "s", role: "reader", plan: "student" }, "lexicon");
    expect([anon("lane"), anon("lisan")]).toEqual([false, true]);
    expect(student("lane")).toBe(true);
  });
});

describe("the routes answer like the corpus code over quran.db", () => {
  beforeEach(async () => { await setRule(r, "corpus", "*", null); });

  it("same 404s and the same 422 text", async () => {
    expect(await (await get("/corpus/chapters/abc")).json()).toEqual({ detail: "chapter not found: NaN" });
    expect(await status("/corpus/verses/9:9")).toBe(404);
    const bad = await get("/corpus/verses/1:1?script=klingon");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({
      detail: "unknown script 'klingon'; choose from imlaei, imlaei_simple, indopak, tajweed, uthmani, uthmani_simple",
    });
  });
});
