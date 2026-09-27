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
import { requireRole, type Env } from "../roles.js";
import { ResearchStore } from "../../../server/src/research.js";
import { researchDataRoutes } from "../../../server/src/routes/research.js";
import { aiBoundary } from "../../../server/src/research-boundary.js";
import { pgResearch } from "./pg-research.js";
import { ensureResearchSchema, markReady, type ResearchConn } from "./schema.js";

export interface ResearchPool {
  connect(): Promise<ResearchConn & { release(): void }>;
}

type ResearchEnv = Env & { Variables: Env["Variables"] & { research: ResearchStore } };

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
      c.set("research", await ResearchStore.open(pgResearch(conn)));
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

  app.route("/", researchDataRoutes(
    (c) => c.get("research" as never) as ResearchStore,
    (c) => (c.get("user" as never) as { via?: string } | undefined)?.via === "token" ? aiBoundary : undefined,
  ));
  return app;
}
