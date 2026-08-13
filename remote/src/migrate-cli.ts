// Apply pending migrations to the configured Postgres: `npm run migrate -w @alsiraat/remote`.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool, pgRunner } from "./db.js";
import { runMigrations } from "./migrate.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

try {
  const applied = await runMigrations(pgRunner, dir);
  console.log(applied.length ? `✔ applied: ${applied.join(", ")}` : "• up to date");
} catch (e) {
  console.error(`migrate: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
