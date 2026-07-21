// Builds the Hono app: CORS, versioned /api/v1 surface, typed-error handling,
// and (optionally) static serving of the built SPA. Kept separate from the
// server entry so tests can exercise it without opening a socket.

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppState } from "./state.js";
import { VERSION } from "./state.js";
import { HttpError } from "./content.js";
import { contentRoutes } from "./routes/content.js";
import { rootRoutes } from "./routes/roots.js";
import { similarityRoutes } from "./routes/similarity.js";
import { researchRoutes } from "./routes/research.js";

export function createApp(state: AppState): Hono {
  const app = new Hono();

  // Open CORS so a future mobile app (or a separately-hosted web build) can
  // consume the API from any origin. Tighten to an allowlist when accounts land.
  app.use("/api/*", cors());

  // typed errors → { detail } with the right status (FastAPI-style)
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ detail: err.message }, err.status as 400);
    // log the full stack to the API console and surface the message so a 500
    // is diagnosable from the browser/network tab too.
    console.error(err);
    return c.json({ detail: `internal error: ${(err as Error).message}` }, 500);
  });

  const v1 = new Hono();
  v1.get("/health", (c) => c.json({ status: "ok", version: VERSION }));
  v1.route("/", contentRoutes(state));
  v1.route("/", rootRoutes(state));
  v1.route("/", similarityRoutes(state));
  v1.route("/", researchRoutes(state));

  app.route("/api/v1", v1);

  return app;
}
