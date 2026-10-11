// The signed-in user's research, served at /research over the shared `research` schema.
//
// Every request runs in ONE transaction on ONE connection, bound to that user (schema.ts): the
// non-superuser research role, app.user_id, search_path — all LOCAL, so a pooled connection can't
// carry them into someone else's request. Row-level security then shows and admits only that
// user's rows. The user id comes from the authenticated principal only; there is no route that
// reads another person's research.
//
// Research is a FEATURE (any account, role reader+). A request made with an API token (the MCP)
// gets the AI write boundary (boundary.ts).

import { Hono } from "hono";
import { requireRole, type Env } from "../roles.js";
import { ResearchStore } from "./store.js";
import { researchDataRoutes } from "./routes.js";
import { aiBoundary } from "./boundary.js";
import { pgResearch } from "./pg-research.js";
import { bindResearchUser, type ResearchConn } from "./schema.js";

export interface ResearchPool {
  connect(): Promise<ResearchConn & { release(): void }>;
}

type ResearchEnv = Env & { Variables: Env["Variables"] & { research: ResearchStore } };

export function researchApp(pool: ResearchPool): Hono<ResearchEnv> {
  const app = new Hono<ResearchEnv>();

  app.use("/research/*", requireRole("reader"), async (c, next) => {
    const user = c.get("user")!;
    const conn = await pool.connect();
    let commit = false;
    try {
      await conn.query("BEGIN");
      await bindResearchUser(conn, user.id);
      c.set("research", new ResearchStore(pgResearch(conn), user.id));
      await next();
      commit = !c.error && c.res.status < 500;
    } finally {
      try { await conn.query(commit ? "COMMIT" : "ROLLBACK"); } finally { conn.release(); }
    }
  });

  app.route("/", researchDataRoutes(
    (c) => c.get("research" as never) as ResearchStore,
    (c) => (c.get("user" as never) as { via?: string } | undefined)?.via === "token" ? aiBoundary : undefined,
  ));
  return app;
}
