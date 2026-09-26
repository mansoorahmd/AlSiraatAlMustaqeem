// Runtime-configurable access: the plan ladder (tiers as data), the corpus policy
// (public | signed_in | plan ≥ tier), and per-translation locks — proved end to end through the
// real /corpus routes over the migrated fixture corpus. Against real Postgres (PGlite).

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import type { Env, Principal } from "../src/roles.js";
import { loadTiers, setTier, removeTier, clearTierCache, TierError } from "../src/plans.js";
import { setPlan } from "../src/invites.js";
import {
  getCorpusPolicy, setCorpusPolicy, setTranslationAccess, translationFilter,
  requireCorpusAccess, clearCorpusAccessCache,
} from "../src/corpus-access.js";
import { corpusRoutes } from "../src/corpus/routes.js";
import { migrateCorpus } from "../src/corpus/load.js";
import { makeFixture, pgliteRunner } from "./fixtures/corpus-fixture.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let r: SqlRunner;

beforeAll(async () => {
  r = pgliteRunner().r;
  await runMigrations(r, MIGR);
  await migrateCorpus({ sqlitePath: makeFixture("access.db"), runner: r });
});

beforeEach(async () => {
  await r.exec(`DELETE FROM translation_access;
                UPDATE corpus_policy SET access = 'plan', min_plan = 'pro';
                DELETE FROM users;
                DELETE FROM plan_tiers WHERE name NOT IN ('free', 'pro');`);
  clearTierCache(r);
  clearCorpusAccessCache(r);
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

  it("won't remove free, pro, or a tier someone holds; removes an unused one", async () => {
    await ladder();
    await expect(removeTier(r, "free")).rejects.toThrow();
    await expect(removeTier(r, "pro")).rejects.toThrow(/gates the community/);
    const [u] = await r.query(`INSERT INTO users (email, plan) VALUES ('s@x.org', 'student') RETURNING id`);
    await expect(removeTier(r, "student")).rejects.toThrow(/still held/);
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

describe("the corpus policy", () => {
  it("defaults to plan ≥ pro", async () => {
    expect(await getCorpusPolicy(r)).toEqual({ access: "plan", minPlan: "pro" });
  });

  it("changes at runtime; the tier is kept when only the level changes", async () => {
    await ladder();
    expect(await setCorpusPolicy(r, { access: "plan", minPlan: "scholar" })).toEqual({ access: "plan", minPlan: "scholar" });
    expect(await setCorpusPolicy(r, { access: "public" })).toEqual({ access: "public", minPlan: "scholar" });
    expect(await getCorpusPolicy(r)).toEqual({ access: "public", minPlan: "scholar" });
  });

  it("refuses an unknown level or tier — in code and in the database", async () => {
    await expect(setCorpusPolicy(r, { access: "everyone" as never })).rejects.toBeInstanceOf(TierError);
    await expect(setCorpusPolicy(r, { access: "plan", minPlan: "ghost" })).rejects.toThrow(/unknown plan tier/);
    await expect(r.query(`UPDATE corpus_policy SET access = 'everyone'`)).rejects.toThrow();
  });
});

// A mini app: the principal comes from headers, then the REAL corpus routes behind the REAL guard.
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
  app.use("/corpus/*", requireCorpusAccess(r));
  app.route("/corpus", corpusRoutes(r));
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

describe("reading the corpus under each policy", () => {
  it("plan ≥ pro (the default): anonymous 401, free 402, pro 200", async () => {
    expect(await status(V)).toBe(401);
    expect(await status(V, "free")).toBe(402);
    expect(await status(V, "pro")).toBe(200);
  });

  it("public: anyone, no sign-in", async () => {
    await setCorpusPolicy(r, { access: "public" });
    expect(await status(V)).toBe(200);
  });

  it("signed_in: anonymous 401, any account (free included) 200", async () => {
    await setCorpusPolicy(r, { access: "signed_in" });
    expect(await status(V)).toBe(401);
    expect(await status(V, "free")).toBe(200);
  });

  it("plan ≥ scholar: pro is turned away naming scholar; scholar reads; a lapsed scholar doesn't", async () => {
    await ladder();
    await setCorpusPolicy(r, { access: "plan", minPlan: "scholar" });
    const res = await get(V, "pro");
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ access: "plan", plan: "scholar" });
    expect(await status(V, "scholar")).toBe(200);
    expect(await status(V, "scholar", new Date(Date.now() - 1000).toISOString())).toBe(402);
  });
});

describe("translations locked to a tier", () => {
  const ids = async (path: string, plan?: string) =>
    ((await (await get(path, plan)).json()) as { resource_id?: number; id?: number }[])
      .map((t) => t.resource_id ?? t.id);

  beforeEach(async () => {
    await ladder();
    await setCorpusPolicy(r, { access: "public" });
    await setTranslationAccess(r, 131, "scholar");
  });

  it("are left out for anyone below the tier, and included at it", async () => {
    expect(await ids("/corpus/verses/1:1/translations")).toEqual([20]);
    expect(await ids("/corpus/verses/1:1/translations", "pro")).toEqual([20]);
    expect(await ids("/corpus/verses/1:1/translations", "scholar")).toEqual([20, 131]);
  });

  it("apply everywhere translations appear — the verse, and the resource list", async () => {
    const verse = async (plan?: string) =>
      ((await (await get("/corpus/verses/1:1?translations=true", plan)).json()) as { translations: { resource_id: number }[] })
        .translations.map((t) => t.resource_id);
    expect(await verse()).toEqual([20]);
    expect(await verse("scholar")).toEqual([20, 131]);
    expect(await ids("/corpus/translation-resources")).toEqual([20]);
    expect(await ids("/corpus/translation-resources", "scholar")).toEqual([20, 131]);
  });

  it("unlocking restores them", async () => {
    await setTranslationAccess(r, 131, null);
    expect(await ids("/corpus/verses/1:1/translations")).toEqual([20, 131]);
  });

  it("the filter is a plain predicate the content layer applies", async () => {
    const anon = await translationFilter(r, undefined);
    expect([anon(20), anon(131)]).toEqual([true, false]);
  });
});

describe("the routes answer like the local API", () => {
  beforeEach(async () => { await setCorpusPolicy(r, { access: "public" }); });

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
