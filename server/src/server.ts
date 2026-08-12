// Server entry: one process serving the API and (optionally) the built SPA.
//   SERVE_STATIC=1  → also serve app/dist and fall back to index.html (all-in-one)
//   SERVE_STATIC=0  → API only (mobile + CDN-hosted web build)

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createState } from "./state.js";

const PORT = Number(process.env.PORT ?? 8000);
const SERVE_STATIC = process.env.SERVE_STATIC === "1";

const state = createState();
const app = createApp(state);

if (SERVE_STATIC) {
  // QF_STATIC_ROOT lets the desktop build point at the SPA inside the app bundle;
  // the default is the repo's app/dist for `npm start`.
  const root = process.env.QF_STATIC_ROOT ?? resolve(import.meta.dirname, "..", "..", "app", "dist");
  app.use("/*", serveStatic({ root }));
  // SPA deep-link fallback
  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ detail: "not found" }, 404);
    const res = await serveStatic({ root, path: "index.html" })(c, async () => {});
    return res ?? c.text("not found", 404);
  });
}

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`AlSiraat API on http://localhost:${info.port}  (static: ${SERVE_STATIC ? "on" : "off"})`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n✖ Port ${PORT} is already in use — another server (maybe an old Python uvicorn) is running there.\n` +
      `  Close it, or start this API on a different port:  set PORT=8001 && npm run dev -w server\n`,
    );
    process.exit(1);
  }
  throw err;
});
