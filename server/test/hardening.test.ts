// The review's must-fixes, pinned: an API token can't manage tokens or use maintainer powers
// (so revoking a leaked one contains it); expiry days are validated, not handed to Postgres;
// a resource rule's key must be canonical, or it would protect nothing while looking set.

import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { requireRole, requireSession, type Env, type Principal } from "../src/roles.js";
import { expiryDays, setPlan, InviteError } from "../src/invites.js";
import { setRule } from "../src/resource-access.js";
import { TierError } from "../src/plans.js";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import { pgliteRunner } from "./fixtures/corpus-fixture.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** A tiny app whose caller is whoever the test says, signed in either way. */
function appAs(user: Principal | undefined) {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => { if (user) c.set("user", user); await next(); });
  app.post("/me/tokens", requireRole("reader"), requireSession, (c) => c.json({ ok: true }));
  app.get("/admin/users", requireRole("maintainer"), (c) => c.json({ ok: true }));
  app.get("/claims", requireRole("reader"), (c) => c.json({ ok: true }));
  return app;
}
const boss = (via: "session" | "token"): Principal => ({ id: "u1", role: "maintainer", plan: "pro", via });

describe("what an API token may not do", () => {
  it("can't mint (or manage) tokens — a leaked one couldn't outlive its revocation", async () => {
    expect((await appAs(boss("token")).request("/me/tokens", { method: "POST" })).status).toBe(403);
    expect((await appAs(boss("session")).request("/me/tokens", { method: "POST" })).status).toBe(200);
  });

  it("can't use maintainer powers, even for a maintainer", async () => {
    const res = await appAs(boss("token")).request("/admin/users");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/sign in to the app/);
    expect((await appAs(boss("session")).request("/admin/users")).status).toBe(200);
  });

  it("still reads as its user — that's what it's for", async () => {
    expect((await appAs(boss("token")).request("/claims")).status).toBe(200);
  });

  it("signed out is still 401, not 403", async () => {
    expect((await appAs(undefined).request("/me/tokens", { method: "POST" })).status).toBe(401);
  });
});

describe("expiry days", () => {
  it("accepts whole days 1–36500, or nothing for 'no expiry'", () => {
    expect(expiryDays(30)).toBe(30);
    expect(expiryDays("7")).toBe(7);
    expect(expiryDays(undefined)).toBeNull();
    expect(expiryDays(null)).toBeNull();
  });
  it("refuses anything that would have reached Postgres as nonsense", () => {
    for (const bad of ["abc", 1e400, 0, -3, 2.5, 99999, "1; DROP TABLE users"]) {
      expect(() => expiryDays(bad)).toThrow(InviteError);
    }
  });
});

describe("against Postgres", () => {
  let r: SqlRunner;
  let uid: string;
  beforeAll(async () => {
    r = pgliteRunner().r;
    await runMigrations(r, MIGR);
    uid = String((await r.query(`INSERT INTO users (email) VALUES ('a@x.org') RETURNING id`))[0]!.id);
  });

  it("a plan grant for N days lands N days out; a bad N is a 422, not a 500", async () => {
    await setPlan(r, { userId: uid, plan: "pro", expiresInDays: 30 });
    const [row] = await r.query(`SELECT (plan_expires_at - now()) > interval '29 days' AS ok FROM users WHERE id = $1`, [uid]);
    expect(row!.ok).toBe(true);
    await expect(setPlan(r, { userId: uid, plan: "pro", expiresInDays: "abc" as never }))
      .rejects.toMatchObject({ status: 422 });
    await setPlan(r, { userId: uid, plan: "pro" });
    const [open] = await r.query(`SELECT plan_expires_at FROM users WHERE id = $1`, [uid]);
    expect(open!.plan_expires_at).toBeNull();
  });

  it("a rule's key must be canonical, or it would protect nothing", async () => {
    for (const key of ["05", "12 ", "abc", "0"]) {
      await expect(setRule(r, "translation", key, "pro")).rejects.toBeInstanceOf(TierError);
    }
    await expect(setRule(r, "lexicon", "Lanes Lexicon", "pro")).rejects.toBeInstanceOf(TierError);
    expect(await setRule(r, "translation", "131", "pro")).toMatchObject({ key: "131" });
    expect(await setRule(r, "lexicon", "lanes_lexicon", null)).toMatchObject({ key: "lanes_lexicon" });
  });
});
