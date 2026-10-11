// Load quran.db into the Postgres `corpus` schema. Step 1 of moving the corpus to the cloud.
//
// Guarantees:
//   • ENCODING-GATED — refuses to run unless the database is UTF8, because anything else would
//     mangle or reject every Arabic character. Checked before a single row is touched.
//   • ATOMIC — the whole rebuild (drop, create, copy, constrain, index) is one transaction. If
//     anything fails, it rolls back and whatever corpus was there before is still there. This
//     mirrors the signed-patch channel's all-or-nothing rule.
//   • REPEATABLE — a run always rebuilds the schema from the source file, so running it twice
//     gives the same result. It only ever touches the `corpus` schema, never `public` (the
//     remote's research tables).
//   • READ-ONLY on the source — quran.db is opened with readOnly: true.
//
// The runner MUST be a single connection (a pg.Client, or PGlite in tests) — a pooled runner
// would scatter BEGIN, the inserts and COMMIT across different connections.

import { DatabaseSync } from "./sqlite.js";
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import type { SqlRunner } from "../migrate.js";
import { SCHEMA, TABLES, CREATE_TABLES, POST_LOAD } from "./schema.js";

/** Postgres allows at most 65,535 bind parameters per statement; stay under it. */
const MAX_PARAMS = 60_000;

export interface MigrateOptions {
  sqlitePath: string;
  runner: SqlRunner;
  onProgress?: (msg: string) => void;
}

export interface MigrateResult {
  tables: { name: string; rows: number }[];
  totalRows: number;
  sourceBytes: number;
  sourceSha256: string;
  ms: number;
}

export class CorpusMigrationError extends Error {}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** Refuse anything but UTF8 — Arabic depends on it. */
export async function assertUtf8(r: SqlRunner): Promise<void> {
  const row = (await r.query("SHOW server_encoding"))[0] ?? {};
  const enc = String(Object.values(row)[0] ?? "").toUpperCase();
  if (enc !== "UTF8") {
    throw new CorpusMigrationError(
      `The database encoding is ${enc || "unknown"}, not UTF8 — Arabic text would be corrupted. ` +
      `Create the database with ENCODING 'UTF8' and run again.`);
  }
}

/** Source column names in declared order — the copy is driven by what the file really has. */
export function sourceColumns(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[])
    .map((c) => c.name);
}

/** Every value, in a shape pg binds losslessly: BLOBs become Buffers, BigInts strings. */
function toParam(v: unknown): unknown {
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === "bigint") return v.toString();
  return v;
}

function rowsOf(sqlite: DatabaseSync, table: string, cols: string[]): Iterable<Record<string, unknown>> {
  const stmt = sqlite.prepare(`SELECT ${cols.map(q).join(", ")} FROM ${q(table)} ORDER BY rowid`);
  // iterate() streams (bounded memory); fall back to all() on a runtime without it
  const it = (stmt as unknown as { iterate?: () => Iterable<Record<string, unknown>> }).iterate;
  return typeof it === "function" ? it.call(stmt) : (stmt.all() as Record<string, unknown>[]);
}

async function insertBatch(r: SqlRunner, table: string, cols: string[], batch: unknown[][]): Promise<void> {
  const n = cols.length;
  const params: unknown[] = [];
  const tuples: string[] = [];
  batch.forEach((row, i) => {
    tuples.push(`(${row.map((_, j) => `$${i * n + j + 1}`).join(",")})`);
    params.push(...row);
  });
  await r.query(
    `INSERT INTO ${SCHEMA}.${q(table)} (${cols.map(q).join(", ")}) VALUES ${tuples.join(",")}`,
    params,
  );
}

async function copyTable(
  sqlite: DatabaseSync, r: SqlRunner, table: string, cols: string[],
): Promise<number> {
  const per = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  let batch: unknown[][] = [];
  let n = 0;
  for (const row of rowsOf(sqlite, table, cols)) {
    batch.push(cols.map((c) => toParam(row[c])));
    if (batch.length === per) { await insertBatch(r, table, cols, batch); n += batch.length; batch = []; }
  }
  if (batch.length) { await insertBatch(r, table, cols, batch); n += batch.length; }
  return n;
}

/** The source's own edition, if a signed patch ever wrote one (quran.db creates it lazily). */
function sourceEdition(sqlite: DatabaseSync): { corpusVersion: string; schemaVersion: string } {
  const has = sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='corpus_meta'").get();
  if (!has) return { corpusVersion: "0", schemaVersion: "0" };
  const m = new Map((sqlite.prepare("SELECT key, value FROM corpus_meta").all() as
    { key: string; value: string }[]).map((x) => [x.key, x.value]));
  return { corpusVersion: m.get("corpus_version") ?? "0", schemaVersion: m.get("schema_version") ?? "0" };
}

export async function migrateCorpus(opts: MigrateOptions): Promise<MigrateResult> {
  const log = opts.onProgress ?? (() => {});
  const r = opts.runner;
  const t0 = Date.now();

  await assertUtf8(r);

  const sqlite = new DatabaseSync(opts.sqlitePath, { readOnly: true });
  try {
    // the source must have every table we are about to copy — no silent partial copies
    for (const t of TABLES) {
      if (sourceColumns(sqlite, t.name).length === 0) {
        throw new CorpusMigrationError(`The source has no table "${t.name}" — is this a quran.db?`);
      }
    }
    const sourceBytes = statSync(opts.sqlitePath).size;
    log("hashing source…");
    const sourceSha256 = await sha256File(opts.sqlitePath);
    const edition = sourceEdition(sqlite);

    await r.exec("BEGIN");
    try {
      log(`rebuilding schema "${SCHEMA}"…`);
      await r.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
      await r.exec(CREATE_TABLES);

      const tables: MigrateResult["tables"] = [];
      for (const t of TABLES) {
        const rows = await copyTable(sqlite, r, t.name, sourceColumns(sqlite, t.name));
        tables.push({ name: t.name, rows });
        log(`${t.name.padEnd(22)} ${String(rows).padStart(8)} rows`);
      }

      log("foreign keys, indexes, full-text, view…");
      await r.exec(POST_LOAD);

      // ids were copied verbatim; move each identity sequence past them so a later insert
      // (a signed patch adding a row) can't collide with an existing id
      for (const t of TABLES.filter((x) => x.identity)) {
        await r.query(
          `SELECT setval(pg_get_serial_sequence('${SCHEMA}.${t.name}', '${t.pk}'),
                         COALESCE((SELECT max(${q(t.pk)}) FROM ${SCHEMA}.${q(t.name)}), 1),
                         (SELECT max(${q(t.pk)}) FROM ${SCHEMA}.${q(t.name)}) IS NOT NULL)`);
      }

      const meta: [string, string][] = [
        ["corpus_version", edition.corpusVersion],
        ["schema_version", edition.schemaVersion],
        ["source_sha256", sourceSha256],
        ["source_bytes", String(sourceBytes)],
        ["migrated_at", new Date().toISOString()],
        ["migrator", "server/src/corpus/load.ts v1"],
      ];
      for (const [k, v] of meta) {
        await r.query(`INSERT INTO ${SCHEMA}.corpus_meta ("key", "value") VALUES ($1, $2)`, [k, v]);
      }

      await r.exec("COMMIT");
      const totalRows = tables.reduce((s, t) => s + t.rows, 0);
      return { tables, totalRows, sourceBytes, sourceSha256, ms: Date.now() - t0 };
    } catch (e) {
      await r.exec("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    sqlite.close();
  }
}
