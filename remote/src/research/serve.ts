// The signed-in user's research, served at /research — the same routes and JSON the local server
// serves from a research.db (server/src/routes/research.ts), over their own Postgres schema.
//
// Every request runs in ONE transaction on ONE connection with search_path set to that user's
// schema (SET LOCAL — it ends with the transaction, so a pooled connection can't carry it into
// someone else's request). Nothing here takes a schema or user id from the request: it comes
// from the authenticated principal only. There is no route that reads another person's research.
//
// Research is a FEATURE (any account, role reader+). A request made with an API token (the MCP)
// gets the AI write boundary (server/src/research-boundary.ts).

import { Hono } from "hono";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "../../../server/src/db.js";
import { sqliteResearch, type ResearchDb } from "../../../server/src/research-db.js";
import { copyResearch, defuseSqlite } from "../../../server/src/research-transfer.js";
import { requireRole, type Env } from "../roles.js";
import { ResearchStore } from "../../../server/src/research.js";
import { researchDataRoutes } from "../../../server/src/routes/research.js";
import { aiBoundary } from "../../../server/src/research-boundary.js";
import { pgResearch } from "./pg-research.js";
import { ensureResearchSchema, markReady, type ResearchConn } from "./schema.js";

export interface ResearchPool {
  connect(): Promise<ResearchConn & { release(): void }>;
}

type ResearchEnv = Env & { Variables: Env["Variables"] & { research: ResearchStore; researchDb: ResearchDb } };

/** Largest research.db accepted for import (the reader's whole research is usually < 5 MB). */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const SQLITE_MAGIC = "SQLite format 3\u0000";

/** A throwaway SQLite file for the length of `fn` — removed afterwards whatever happens. */
async function withTempFile<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "mqrg-research-"));
  try { return await fn(join(dir, "research.db")); }
  finally { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ } }
}

/** `profileFor` names the account (email, display name) for its research's owner record. */
export function researchApp(
  pool: ResearchPool,
  profileFor: (userId: string) => Promise<{ email: string; name: string }>,
): Hono<ResearchEnv> {
  const app = new Hono<ResearchEnv>();

  app.use("/research/*", requireRole("reader"), async (c, next) => {
    const user = c.get("user")!;
    const conn = await pool.connect();
    let commit = false, schema = "";
    try {
      await conn.query("BEGIN");
      schema = await ensureResearchSchema(conn, user.id, () => profileFor(user.id));
      await conn.query(`SET LOCAL search_path TO "${schema}"`);
      const db = pgResearch(conn);
      c.set("researchDb", db);
      c.set("research", await ResearchStore.open(db));
      await next();
      commit = !c.error && c.res.status < 500;
    } finally {
      try { await conn.query(commit ? "COMMIT" : "ROLLBACK"); } finally { conn.release(); }
      if (commit) markReady(schema);
    }
  });

  // whose research this is — the account (the local server reports the file's owner here)
  app.get("/research/identity", async (c) => {
    const s = c.get("research");
    return c.json({ localId: s.localId, databasePath: null, owner: (await s.getOwner()) ?? null });
  });

  /** A complete copy of your research as a research.db file — yours to keep, and re-importable. */
  app.get("/research/export", async (c) => {
    const owner = await c.get("research").getOwner();
    const bytes = await withTempFile(async (path) => {
      const file = new Db(path);
      try {
        const target = sqliteResearch(file);
        const store = await ResearchStore.open(target);
        await target.run("DELETE FROM settings");            // the account's own settings replace the fresh file's
        await copyResearch(c.get("researchDb"), target);
        if (owner) await store.setOwner(owner.email as string, owner.name as string);
        await target.exec("PRAGMA journal_mode = DELETE");   // one self-contained file, no WAL beside it
      } finally { file.close(); }
      return readFileSync(path);
    });
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return c.body(bytes, 200, {
      "content-type": "application/vnd.sqlite3",
      "content-disposition": `attachment; filename="research-${day}.db"`,
      "cache-control": "no-store",
    });
  });

  /**
   * Bring a research.db into your account (the file from this computer, a backup, an export).
   * MERGE: adds what isn't there yet, never overwrites or deletes; importing twice adds nothing.
   * All in the request's transaction — a bad file changes nothing.
   */
  app.post("/research/import", async (c) => {
    if ((c.get("user") as { via?: string } | undefined)?.via === "token") {
      return c.json({ detail: "an API token can't import research — sign in to the app" }, 403);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > MAX_IMPORT_BYTES) return c.json({ detail: "that file is larger than 100 MB" }, 413);
    if (Buffer.from(bytes.subarray(0, 16)).toString("latin1") !== SQLITE_MAGIC) {
      return c.json({ detail: "that isn't a research database (.db) file" }, 422);
    }
    const report = await withTempFile(async (path) => {
      writeFileSync(path, bytes);
      const file = new Db(path);
      try {
        const source = sqliteResearch(file);
        await defuseSqlite(source);
        await ResearchStore.open(source);                   // an older file is brought up to date first
        return await copyResearch(source, c.get("researchDb"), { skipSettings: ["local_id"] });
      } finally { file.close(); }
    });
    const copied = Object.values(report).reduce((n, t) => n + t.copied, 0);
    return c.json({ copied, tables: report });
  });

  app.route("/", researchDataRoutes(
    (c) => c.get("research" as never) as ResearchStore,
    (c) => (c.get("user" as never) as { via?: string } | undefined)?.via === "token" ? aiBoundary : undefined,
  ));
  return app;
}
