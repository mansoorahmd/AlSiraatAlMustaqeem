// Remote service entry — separate process from the local API (they share nothing but the
// concept). Serves the research channel over HTTP against Postgres.

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";

serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`MQRG remote on http://localhost:${info.port}`);
});
