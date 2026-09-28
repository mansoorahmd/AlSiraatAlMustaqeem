// The schema migration, validated against PGlite (real Postgres compiled to WASM, in-process).
// The service uses node-postgres against a real server; the same .sql runs here.

import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db: PGlite;
let runner: SqlRunner;

beforeAll(async () => {
  db = new PGlite();
  runner = {
    exec: (sql) => db.exec(sql).then(() => undefined),
    query: async (sql, params = []) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[],
  };
  await runMigrations(runner, MIGR);
});

describe("schema migration", () => {
  it("creates every research-channel table", async () => {
    const rows = await runner.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "users", "invites", "claims", "claim_versions", "global_forms", "dissents",
      "submissions", "submission_items", "reviews", "redactions", "sync_cursors", "_migrations",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("defaults role to reader and mints a uuid id", async () => {
    await db.query("INSERT INTO users (email) VALUES ('reader@example.org')");
    const rows = (await db.query<{ id: string; role: string }>(
      "SELECT id, role FROM users WHERE email='reader@example.org'",
    )).rows;
    expect(rows[0]!.role).toBe("reader");
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("enforces the role CHECK constraint", async () => {
    await expect(
      db.query("INSERT INTO users (email, role) VALUES ('x@example.org', 'wizard')"),
    ).rejects.toThrow();
  });

  it("enforces referential integrity (a dissent needs a real claim version)", async () => {
    await expect(
      db.query(
        "INSERT INTO dissents (id, claim_id, claim_version, author_id, payload_json) " +
        "VALUES ('dsn_x','clm_nope',1,gen_random_uuid(),'{}'::jsonb)",
      ),
    ).rejects.toThrow();
  });

  it("is idempotent — re-running applies nothing", async () => {
    expect(await runMigrations(runner, MIGR)).toEqual([]);
  });
});
