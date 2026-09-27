// Move the Qur'an corpus (quran.db) into Postgres, then prove the copy is exact.
//
//   npm run corpus:migrate -w @alsiraat/remote              # load + verify
//   npm run corpus:migrate -w @alsiraat/remote -- --verify  # verify an existing copy only
//
// Source: QF_QURAN_DB, else the project's quran.db. Target: DATABASE_URL (the remote's
// Postgres), schema `corpus`. Only the `corpus` schema is ever rebuilt — the remote's research
// tables in `public` are never touched. Exit code 1 if verification finds any difference.
//
// This is step 1 of moving the corpus to the cloud: the data moves and is verified. The app and
// the MCP still read quran.db until the corpus query layer is ported (step 2).

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";
import type { SqlRunner } from "./migrate.js";
import { migrateCorpus } from "./corpus/load.js";
import { verifyCorpus, type VerifyReport } from "./corpus/verify.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sqlitePath = process.env.QF_QURAN_DB ?? resolve(repo, "quran.db");
const verifyOnly = process.argv.includes("--verify");

const mark = (ok: boolean) => (ok ? "✔" : "✘");

function printReport(rep: VerifyReport): void {
  console.log("\n  table                    sqlite        pg   columns  content");
  for (const t of rep.tables) {
    console.log(`  ${t.name.padEnd(22)} ${String(t.sqliteRows).padStart(8)}  ${String(t.pgRows).padStart(8)}` +
      `      ${mark(t.columnsMatch)}        ${mark(t.contentMatch)}`);
  }
  console.log(`  ${"word_occurrences (view)".padEnd(22)} ${String(rep.view.sqliteRows).padStart(8)}  ` +
    `${String(rep.view.pgRows).padStart(8)}      -        ${mark(rep.view.contentMatch)}`);
  console.log(`\n  foreign keys   ${rep.foreignKeys.found}/${rep.foreignKeys.expected}  ${mark(rep.foreignKeys.found === rep.foreignKeys.expected)}`);
  console.log(`  indexes        ${rep.indexes.found}/${rep.indexes.expected}  ${mark(rep.indexes.found === rep.indexes.expected)}`);
  console.log(`  source         ${rep.source.fileSha256.slice(0, 16)}…  ${mark(rep.source.matches)} ` +
    (rep.source.matches ? "(this copy is of this file)" : "(STALE — made from a different file)"));
  console.log(`  arabic ${rep.arabicProbe.verseKey}     ${mark(rep.arabicProbe.equal)}  ${rep.arabicProbe.pg}`);
  console.log(rep.ok
    ? "\n  ✔ The Postgres corpus is an exact copy of quran.db."
    : `\n  ✘ ${rep.problems.length} problem(s):\n    - ${rep.problems.join("\n    - ")}`);
}

if (!existsSync(sqlitePath)) {
  console.error(`corpus:migrate: no quran.db at ${sqlitePath} — set QF_QURAN_DB.`);
  process.exit(1);
}

// ONE connection: the rebuild is a single transaction, and a pool would split it apart.
const client = new pg.Client({ connectionString: config.databaseUrl });
const runner: SqlRunner = {
  exec: async (sql) => { await client.query(sql); },
  query: async (sql, params = []) => (await client.query(sql, params as unknown[])).rows,
};

try {
  await client.connect();
  console.log(`source  ${sqlitePath}`);
  console.log(`target  ${config.databaseUrl.replace(/:[^:@/]+@/, ":***@")}  (schema "corpus")`);

  if (!verifyOnly) {
    const res = await migrateCorpus({ sqlitePath, runner, onProgress: (m) => console.log(`  ${m}`) });
    console.log(`\n  loaded ${res.totalRows.toLocaleString()} rows from ${(res.sourceBytes / 1048576).toFixed(1)} MB ` +
      `in ${(res.ms / 1000).toFixed(1)}s`);
  }

  console.log("\nverifying every row…");
  const rep = await verifyCorpus({ sqlitePath, runner });
  printReport(rep);
  if (!rep.ok) process.exitCode = 1;
} catch (e) {
  console.error(`\ncorpus:migrate: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
