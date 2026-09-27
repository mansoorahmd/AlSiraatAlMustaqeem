// Remote service entry — separate process from the local API (they share nothing but the
// concept). Serves the research channel and the Qur'an corpus over HTTP against Postgres.

import { serve } from "@hono/node-server";
import { createApp, cloudCorpus } from "./app.js";
import { config } from "./config.js";
import { warmCorpus } from "../../server/src/corpus-services.js";

serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`MQRG remote on http://localhost:${info.port}`);
});

// Build the corpus's in-memory indexes (echoes, spellings, similarity, free text) now, in the
// background, so the first reader doesn't wait for them. Until they're ready those routes simply
// build on first use; if the corpus hasn't been migrated yet, say so plainly.
const t0 = Date.now();
warmCorpus(cloudCorpus)
  .then(() => console.log(`corpus ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`))
  .catch((e) => console.error(
    `corpus not ready — run \`npm run corpus:migrate\` to load it into Postgres (${(e as Error).message})`));
