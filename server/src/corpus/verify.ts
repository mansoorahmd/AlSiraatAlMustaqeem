// Prove the Postgres corpus is a faithful copy of quran.db — every row, not a sample.
//
// For each table, both sides are reduced to (row count, content fingerprint). The fingerprint is
// an ORDER-INDEPENDENT sum of per-row hashes over every column's value, so it matches exactly
// when — and only when — both sides hold the same multiset of rows. Row counts alone would miss
// a corrupted Arabic string; this catches a single changed character anywhere.
//
// Also checked: identical column lists, the word_occurrences view (count + content), all nine
// foreign keys present, the indexes present, and that the copy was made from THIS source file
// (sha256), so a quran.db replaced since the migration shows up as stale.

import { DatabaseSync } from "./sqlite.js";
import { createHash } from "node:crypto";
import type { SqlRunner } from "../migrate.js";
import { SCHEMA, TABLES, FOREIGN_KEY_COUNT } from "./schema.js";
import { sha256File, sourceColumns } from "./load.js";

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const MASK = (1n << 64n) - 1n;
const PAGE = 20_000;
/** The b-tree indexes carried over from quran.db, plus the two full-text replacements. */
const EXPECTED_INDEXES = 27 + 2;

/** One canonical spelling per value, identical whichever driver produced it. */
function norm(v: unknown): string {
  if (v === null || v === undefined) return "\u0000";
  if (v instanceof Uint8Array) return "b:" + Buffer.from(v).toString("hex");
  if (typeof v === "number") return "n:" + (Object.is(v, -0) ? "0" : String(v));
  if (typeof v === "bigint") return "n:" + v.toString();
  if (typeof v === "boolean") return "n:" + (v ? "1" : "0");
  return "s:" + String(v);
}

function rowHash(values: unknown[]): bigint {
  const hex = createHash("sha256").update(values.map(norm).join("\u001f")).digest("hex");
  return BigInt("0x" + hex.slice(0, 16));
}

interface Fingerprint { count: number; sum: bigint }

function sqliteFingerprint(sqlite: DatabaseSync, sql: string, cols: string[]): Fingerprint {
  const stmt = sqlite.prepare(sql);
  const it = (stmt as unknown as { iterate?: () => Iterable<Record<string, unknown>> }).iterate;
  const rows = typeof it === "function" ? it.call(stmt) : (stmt.all() as Record<string, unknown>[]);
  let count = 0, sum = 0n;
  for (const row of rows) { sum = (sum + rowHash(cols.map((c) => row[c]))) & MASK; count++; }
  return { count, sum };
}

/** Keyset-paged, so a large table never has to sit in memory at once. */
async function pgTableFingerprint(
  r: SqlRunner, table: string, pk: string, cols: string[],
): Promise<Fingerprint> {
  const colList = cols.map(q).join(", ");
  let count = 0, sum = 0n;
  let after: unknown = undefined;
  for (;;) {
    const rows = after === undefined
      ? await r.query(`SELECT ${colList} FROM ${SCHEMA}.${q(table)} ORDER BY ${q(pk)} LIMIT ${PAGE}`)
      : await r.query(
          `SELECT ${colList} FROM ${SCHEMA}.${q(table)} WHERE ${q(pk)} > $1 ORDER BY ${q(pk)} LIMIT ${PAGE}`,
          [after]);
    for (const row of rows) { sum = (sum + rowHash(cols.map((c) => row[c]))) & MASK; count++; }
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1]![pk];
  }
  return { count, sum };
}

export interface VerifyReport {
  ok: boolean;
  tables: { name: string; sqliteRows: number; pgRows: number; columnsMatch: boolean; contentMatch: boolean }[];
  view: { sqliteRows: number; pgRows: number; contentMatch: boolean };
  foreignKeys: { expected: number; found: number };
  indexes: { expected: number; found: number };
  source: { fileSha256: string; migratedFromSha256: string | null; matches: boolean };
  arabicProbe: { verseKey: string; sqlite: string; pg: string; equal: boolean };
  problems: string[];
}

export async function verifyCorpus(
  opts: { sqlitePath: string; runner: SqlRunner },
): Promise<VerifyReport> {
  const r = opts.runner;
  const problems: string[] = [];
  const sqlite = new DatabaseSync(opts.sqlitePath, { readOnly: true });
  try {
    const exists = await r.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [SCHEMA]);
    if (!exists.length) {
      throw new Error(`There is no "${SCHEMA}" schema yet — run the migration first.`);
    }

    // ---- every table: same columns, same rows -------------------------------------------
    const tables: VerifyReport["tables"] = [];
    for (const t of TABLES) {
      const cols = sourceColumns(sqlite, t.name);
      const pgCols = (await r.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [SCHEMA, t.name])).map((x) => String(x.column_name));
      const columnsMatch = cols.length === pgCols.length && cols.every((c, i) => c === pgCols[i]);
      if (!columnsMatch) problems.push(`${t.name}: columns differ (sqlite ${cols.join(",")} | pg ${pgCols.join(",")})`);

      const s = sqliteFingerprint(sqlite, `SELECT ${cols.map(q).join(", ")} FROM ${q(t.name)}`, cols);
      const p = columnsMatch ? await pgTableFingerprint(r, t.name, t.pk, cols) : { count: -1, sum: -1n };
      const contentMatch = columnsMatch && s.count === p.count && s.sum === p.sum;
      if (columnsMatch && !contentMatch) {
        problems.push(s.count !== p.count
          ? `${t.name}: row count differs (sqlite ${s.count}, pg ${p.count})`
          : `${t.name}: same row count but the content differs`);
      }
      tables.push({ name: t.name, sqliteRows: s.count, pgRows: p.count, columnsMatch, contentMatch });
    }

    // ---- the view: the join itself must translate faithfully ---------------------------
    const viewCols = (await r.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'word_occurrences' ORDER BY ordinal_position`,
      [SCHEMA])).map((x) => String(x.column_name));
    const sv = sqliteFingerprint(sqlite,
      `SELECT ${viewCols.map(q).join(", ")} FROM word_occurrences`, viewCols);
    let pvCount = 0, pvSum = 0n;
    // the view is ~78k rows; one read is fine and avoids unstable paging over a non-unique order
    for (const row of await r.query(`SELECT ${viewCols.map(q).join(", ")} FROM ${SCHEMA}.word_occurrences`)) {
      pvSum = (pvSum + rowHash(viewCols.map((c) => row[c]))) & MASK; pvCount++;
    }
    const view = { sqliteRows: sv.count, pgRows: pvCount, contentMatch: sv.count === pvCount && sv.sum === pvSum };
    if (!view.contentMatch) problems.push(`word_occurrences view differs (sqlite ${sv.count}, pg ${pvCount})`);

    // ---- structure --------------------------------------------------------------------
    const fk = Number((await r.query(
      `SELECT COUNT(*)::int AS n FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = $1 AND c.contype = 'f'`, [SCHEMA]))[0]?.n ?? 0);
    if (fk !== FOREIGN_KEY_COUNT) problems.push(`foreign keys: expected ${FOREIGN_KEY_COUNT}, found ${fk}`);

    const ix = Number((await r.query(
      `SELECT COUNT(*)::int AS n FROM pg_indexes
        WHERE schemaname = $1 AND (indexname LIKE 'idx\\_%' OR indexname LIKE '%\\_fts\\_gin')`,
      [SCHEMA]))[0]?.n ?? 0);
    if (ix !== EXPECTED_INDEXES) problems.push(`indexes: expected ${EXPECTED_INDEXES}, found ${ix}`);

    // ---- provenance: is this copy of THIS file? ----------------------------------------
    const fileSha256 = await sha256File(opts.sqlitePath);
    const metaRow = (await r.query(
      `SELECT "value" FROM ${SCHEMA}.corpus_meta WHERE "key" = 'source_sha256'`))[0];
    const migratedFromSha256 = metaRow ? String(metaRow.value) : null;
    const matches = migratedFromSha256 === fileSha256;
    if (!matches) problems.push("the Postgres copy was made from a different quran.db — re-run the migration");

    // ---- a human-visible check on the text itself --------------------------------------
    const verseKey = "1:1";
    const sa = (sqlite.prepare("SELECT text_uthmani FROM verses WHERE verse_key = ?").get(verseKey) as
      { text_uthmani?: string } | undefined)?.text_uthmani ?? "";
    const pa = String((await r.query(
      `SELECT text_uthmani FROM ${SCHEMA}.verses WHERE verse_key = $1`, [verseKey]))[0]?.text_uthmani ?? "");
    const arabicProbe = { verseKey, sqlite: sa, pg: pa, equal: sa === pa && sa.length > 0 };
    if (!arabicProbe.equal) problems.push(`Arabic probe ${verseKey} differs`);

    return {
      ok: problems.length === 0,
      tables, view,
      foreignKeys: { expected: FOREIGN_KEY_COUNT, found: fk },
      indexes: { expected: EXPECTED_INDEXES, found: ix },
      source: { fileSha256, migratedFromSha256, matches },
      arabicProbe,
      problems,
    };
  } finally {
    sqlite.close();
  }
}
