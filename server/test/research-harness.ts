// The research server's /research, in-process over PGlite, for tests: the real migrations, real
// row-level security, and a principal set per app — as a request with a session (the reader, in
// the app) or with an API token (the MCP).

import { Hono } from "hono";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { Env, Principal } from "../src/roles.js";
import { researchApp, type ResearchPool } from "../src/research/serve.js";
import { runMigrations } from "../src/migrate.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export interface Account { id: string; email: string; name: string }

export interface ResearchHarness {
  pglite: PGlite;
  pool: ResearchPool;
  /** Make `who` a real account (research rows reference their user). */
  addUser(who: Account): Promise<void>;
  /** /research as `who` — "session" is the reader in the app, "token" is their MCP. */
  as(who: Account, via?: "session" | "token"): Hono<Env>;
}

export async function researchHarness(): Promise<ResearchHarness> {
  const pglite = new PGlite();
  await runMigrations({
    exec: async (sql: string) => { await pglite.exec(sql); },
    query: async (sql: string, params: unknown[] = []) => (await pglite.query(sql, params)).rows as Record<string, unknown>[],
  }, MIGRATIONS);

  // PGlite is one connection: hand it out one request at a time
  let chain: Promise<void> = Promise.resolve();
  const pool: ResearchPool = {
    connect: () => new Promise((resolve) => {
      chain = chain.then(() => new Promise<void>((release) => resolve({
        query: async (sql, params = []) => {
          const r = await pglite.query(sql, params as unknown[]);
          return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length };
        },
        release,
      })));
    }),
  };

  return {
    pglite,
    pool,
    addUser: async (who) => {
      await pglite.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [who.id, who.email, who.name]);
    },
    as: (who, via = "session") => {
      const app = new Hono<Env>();
      app.use("*", async (c, next) => {
        c.set("user", { id: who.id, role: "reader", plan: "free", via } as Principal);
        await next();
      });
      app.route("/", researchApp(pool) as unknown as Hono<Env>);
      return app;
    },
  };
}

/** JSON request helpers over one app. */
export const client = (app: Hono<any>) => {
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, body === undefined ? { method } : {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  return {
    send,
    get: async (path: string) => (await app.request(path)).json() as Promise<any>,
    put: (path: string, body: unknown = {}) => send("PUT", path, body),
    del: (path: string) => send("DELETE", path),
  };
};
