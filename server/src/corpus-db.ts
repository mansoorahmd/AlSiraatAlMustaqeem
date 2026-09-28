// The corpus database, as an async interface — so ONE corpus codebase runs over two engines:
//
//   SQLite   quran.db, via sqliteCorpus()   — the tests, the MCP's MQ_CORPUS=local, the parity reference
//   Postgres the cloud's `corpus` schema, via remote/src/corpus/pg-corpus.ts — what /corpus serves
//
// Every query in the corpus modules is written once, with `?` placeholders, and must behave the
// same on both. The rules that keep it that way (each one learned the hard way — see CORPUS.md):
//
//   • GROUP BY every selected column that isn't aggregated. SQLite allows bare columns; Postgres
//     refuses the query. (Grouping by a table's primary key is fine in both.)
//   • If row ORDER matters, ORDER BY a TOTAL order. Without one SQLite returns insertion order and
//     Postgres guarantees nothing. `DISTINCT` has no order — use GROUP BY … ORDER BY MIN(id).
//   • Nullable sort keys: write NULLS FIRST on ASC and NULLS LAST on DESC — SQLite's defaults,
//     which Postgres reverses. (SQLite ≥ 3.30 accepts the syntax.)
//   • No SQLite-only functions (IFNULL, GROUP_CONCAT, instr, …) and no boolean-valued columns
//     (SQLite yields 0/1, Postgres true/false).
//   • Counts come back as JS numbers from both drivers (Postgres int8 is normalised).
//
// Text sorts identically because the Postgres corpus declares every text column COLLATE "C",
// the byte order that SQLite's BINARY uses.

import type { Db } from "./db.js";

export type Row = Record<string, unknown>;

export interface CorpusDb {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  scalar<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

/** The SQLite corpus (quran.db) behind the async interface. */
export function sqliteCorpus(db: Db): CorpusDb {
  return {
    query: async <T = Row>(sql: string, params: unknown[] = []) => db.query<T>(sql, params),
    one: async <T = Row>(sql: string, params: unknown[] = []) => db.one<T>(sql, params),
    scalar: async <T = unknown>(sql: string, params: unknown[] = []) => db.scalar<T>(sql, params),
  };
}

/**
 * Build a thing once, on first use, even when many requests ask at the same moment — the shared
 * promise means a second caller waits for the first build instead of starting another.
 */
export function once(build: () => Promise<void>): () => Promise<void> {
  let p: Promise<void> | null = null;
  return () => (p ??= build().catch((e) => { p = null; throw e; }));
}
