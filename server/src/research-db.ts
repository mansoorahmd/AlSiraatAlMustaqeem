// The research store's database, behind one small async interface — the same idea as
// corpus-db.ts. Two drivers:
//
//   sqliteResearch(db)   a research.db file (the local server, the tests, imports/exports)
//   pgResearch(client)   the signed-in user's own Postgres schema (remote/src/research/)
//
// ResearchStore (research.ts) is written once against this, in SQL both engines run the same way:
// `?` placeholders, ON CONFLICT upserts, and a total ORDER BY wherever order is visible.

import type { Db } from "./db.js";

export type Row = Record<string, unknown>;

export interface ResearchDb {
  readonly dialect: "sqlite" | "postgres";
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  scalar<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** INSERT/UPDATE/DELETE → how many rows it touched */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** DDL / multi-statement scripts, no parameters */
  exec(sql: string): Promise<void>;
}

export function sqliteResearch(db: Db): ResearchDb {
  return {
    dialect: "sqlite",
    query: async <T>(sql: string, params: unknown[] = []) => db.query<T>(sql, params),
    one: async <T>(sql: string, params: unknown[] = []) => db.one<T>(sql, params),
    scalar: async <T>(sql: string, params: unknown[] = []) => db.scalar<T>(sql, params),
    run: async (sql, params = []) => ({ changes: Number(db.run(sql, params).changes) }),
    exec: async (sql) => db.exec(sql),
  };
}
