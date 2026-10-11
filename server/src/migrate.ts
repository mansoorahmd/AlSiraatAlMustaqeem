// Minimal forward-only migration runner. Applies migrations/*.sql in filename order,
// once each, tracked in a _migrations table. Driver-agnostic (a SqlRunner) so the same
// files run against pg in production and PGlite (WASM Postgres) in tests.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SqlRunner {
  exec(sql: string): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

/** Runs any not-yet-applied .sql files in `dir`, in order. Returns the names applied. */
export async function runMigrations(r: SqlRunner, dir: string): Promise<string[]> {
  await r.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await r.query("SELECT name FROM _migrations")).map((x) => x.name as string));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    await r.exec(readFileSync(join(dir, f), "utf8"));
    await r.query("INSERT INTO _migrations (name) VALUES ($1)", [f]);
    applied.push(f);
  }
  return applied;
}
