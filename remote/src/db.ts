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
