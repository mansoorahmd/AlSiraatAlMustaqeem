// The research store's database: ONE connection, inside the request's transaction, already bound
// to the signed-in user (schema.ts). The store writes `?` placeholders; they become `$n` here.

import { toPgPlaceholders } from "../corpus/pg-corpus.js";
import type { ResearchConn } from "./schema.js";

export type Row = Record<string, unknown>;

export interface ResearchDb {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  scalar<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** INSERT/UPDATE/DELETE → how many rows it touched */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

// int8 (timestamps, COUNT) arrives as a string from node-pg (parsed to number by the research
// pool, db.ts) or a BigInt from PGlite — normalised to a number
const normalise = (row: Row): Row => {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === "bigint") row[k] = Number(v);
  }
  return row;
};

export function pgResearch(conn: ResearchConn): ResearchDb {
  const query = async <T = Row>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await conn.query(toPgPlaceholders(sql), params)).rows.map(normalise) as T[];
  return {
    query,
    one: async <T = Row>(sql: string, params: unknown[] = []) => (await query<T>(sql, params))[0],
    scalar: async <T = unknown>(sql: string, params: unknown[] = []) => {
      const row = (await query(sql, params))[0];
      return row ? (Object.values(row)[0] as T) : undefined;
    },
    run: async (sql, params = []) => ({ changes: (await conn.query(toPgPlaceholders(sql), params)).rowCount }),
  };
}
