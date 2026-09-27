// The Postgres driver for the shared research code (server/src/research-db.ts). Runs on ONE
// connection, inside the request's transaction, already bound to the signed-in user (schema.ts):
// row-level security shows and admits only that user's rows, and inserts take their user_id by
// default. The shared SQL is the research.db file's, unchanged, with two translations:
//   • `?` → `$n`
//   • ON CONFLICT (…) → ON CONFLICT (user_id, …) — every key leads with user_id here

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

/** The file's conflict targets name its keys; here every key leads with the owning user. */
export const scopeConflicts = (sql: string) => sql.replace(/ON CONFLICT\s*\(([^)]*)\)/gi, "ON CONFLICT (user_id, $1)");
const translate = (sql: string) => toPgPlaceholders(scopeConflicts(sql));

export function pgResearch(conn: ResearchConn): ResearchDb {
  const query = async <T = Row>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await conn.query(translate(sql), params)).rows.map(normalise) as T[];
  return {
    dialect: "postgres",
    query,
    one: async <T = Row>(sql: string, params: unknown[] = []) => (await query<T>(sql, params))[0],
    scalar: async <T = unknown>(sql: string, params: unknown[] = []) => {
      const row = (await query(sql, params))[0];
      return row ? (Object.values(row)[0] as T) : undefined;
    },
    run: async (sql, params = []) => ({ changes: (await conn.query(translate(sql), params)).rowCount }),
    exec: async (sql) => {
      for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) await conn.query(stmt);
    },
  };
}
