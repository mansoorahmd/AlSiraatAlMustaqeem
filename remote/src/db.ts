// Postgres connection pool for the remote research channel. This is where a structured,
// multi-writer, transactional store genuinely earns its place (SHARED_RESEARCH.md §3).

import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/** A driver-agnostic runner (pg here; PGlite in tests) — see migrate.ts. */
export const pgRunner = {
  exec: async (sql: string): Promise<void> => { await pool.query(sql); },
  query: async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> =>
    (await pool.query(sql, params)).rows,
};

// The Qur'an corpus is read through its own pool, whose connections resolve unqualified table
// names to the `corpus` schema (the shared corpus code never names a schema) and return int8 —
// COUNT(*), SUM(integer) — as a number, exactly as SQLite does. See corpus/pg-corpus.ts.
const INT8 = 20, NUMERIC = 1700;
export const corpusPool = new pg.Pool({
  connectionString: config.databaseUrl,
  options: "-c search_path=corpus,public",
  types: {
    getTypeParser: ((oid: number, format?: string) =>
      oid === INT8 || oid === NUMERIC
        ? (v: string) => Number(v)
        : pg.types.getTypeParser(oid, format as never)) as typeof pg.types.getTypeParser,
  },
});

export const corpusRunner = {
  exec: async (sql: string): Promise<void> => { await corpusPool.query(sql); },
  query: async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> =>
    (await corpusPool.query(sql, params)).rows,
};
