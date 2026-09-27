// The Postgres driver for the shared research code (server/src/research-db.ts). Runs on ONE
// connection, inside the request's transaction, with search_path already set to the signed-in
// user's own schema (serve.ts) — so the research code's unqualified table names can only mean
// that person's tables.

import type { ResearchDb, Row } from "../../../server/src/research-db.js";
import { toPgPlaceholders } from "../corpus/pg-corpus.js";
import type { ResearchConn } from "./schema.js";

// int8 (timestamps, COUNT) arrives as a string from node-pg (parsed to number by the research
// pool, db.ts) or a BigInt from PGlite — normalised to a number, as SQLite returns it
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
    dialect: "postgres",
    query,
    one: async <T = Row>(sql: string, params: unknown[] = []) => (await query<T>(sql, params))[0],
    scalar: async <T = unknown>(sql: string, params: unknown[] = []) => {
      const row = (await query(sql, params))[0];
      return row ? (Object.values(row)[0] as T) : undefined;
    },
    run: async (sql, params = []) => ({ changes: (await conn.query(toPgPlaceholders(sql), params)).rowCount }),
    exec: async (sql) => {
      for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) await conn.query(stmt);
    },
  };
}
