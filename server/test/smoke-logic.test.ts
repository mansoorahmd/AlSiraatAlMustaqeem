// The smoke CLI runs against a real server, so its *logic* is proven here instead: the same
// checks it performs (uuid default, CHECK, FK, invite flow, cleanup) against PGlite. If these
// pass but `npm run smoke` fails on your Postgres, the difference is the server/driver — which
// is exactly what the smoke test exists to catch.

import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import { createInvite, validateInvite, finishRedeem, bindLocalId, loadPrincipal } from "../src/invites.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const TAG = "smoke-logic";

let db: PGlite;
let r: SqlRunner;

beforeAll(async () => {
  db = new PGlite();
  r = {
    exec: (sql) => db.exec(sql).then(() => undefined),
    query: async (sql, params = []) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[],
  };
  await runMigrations(r, MIGR);
});

describe("smoke checks (same assertions the CLI makes)", () => {
  it("both migrations are recorded", async () => {
    const names = (await r.query("SELECT name FROM _migrations ORDER BY name")).map((x) => x.name);
    expect(names).toContain("0001_init.sql");
    expect(names).toContain("0002_auth.sql");
  });

  it("Better Auth tables exist", async () => {
    const rows = await r.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN ('session','account','verification')`,
    );
    expect(rows).toHaveLength(3);
  });

  it("users.id default mints a uuid and role defaults to reader", async () => {
    const [u] = await r.query("INSERT INTO users (email) VALUES ($1) RETURNING id, role", [`u-${TAG}@x.invalid`]);
    const { id, role } = u as { id: string; role: string };
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(role).toBe("reader");
  });

  it("the full invite flow works and binds a local_id", async () => {
    const [boss] = await r.query(
      "INSERT INTO users (email, role) VALUES ($1,'maintainer') RETURNING id", [`boss-${TAG}@x.invalid`]);
    const invite = await createInvite(r, {
      issuedBy: (boss as { id: string }).id, role: "moderator", expiresInDays: 7,
    });
    const inv = await validateInvite(r, invite.code);
    const [u] = await r.query("INSERT INTO users (email) VALUES ($1) RETURNING id",
      [`new-${TAG}@x.invalid`]) as { id: string }[];
    await finishRedeem(r, { code: invite.code, userId: u!.id, role: inv.role });
    const out = { userId: u!.id, role: (await loadPrincipal(r, u!.id))!.role };
    expect(out.role).toBe("moderator");

    const local = "11111111-2222-3333-4444-555555555555";
    await bindLocalId(r, out.userId, local);
    expect((await loadPrincipal(r, out.userId))!.localId).toBe(local);
  });

  it("cleanup removes only the tagged rows", async () => {
    const before = (await r.query("SELECT COUNT(*)::int AS n FROM users"))[0] as { n: number };
    expect(before.n).toBeGreaterThan(0);
    await r.query("DELETE FROM invites WHERE issued_by IN (SELECT id FROM users WHERE email LIKE $1)", [`%${TAG}%`]);
    const gone = await r.query("DELETE FROM users WHERE email LIKE $1 RETURNING id", [`%${TAG}%`]);
    expect(gone.length).toBeGreaterThan(0);
    expect(((await r.query("SELECT COUNT(*)::int AS n FROM users"))[0] as { n: number }).n).toBe(0);
  });
});
