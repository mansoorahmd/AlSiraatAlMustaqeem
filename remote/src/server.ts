// The research server's entry: accounts, the corpus, every account's research and the
// community, over HTTP against Postgres.

import { serve } from "@hono/node-server";
import { createApp, cloudCorpus } from "./app.js";
import { config, assertDeployable } from "./config.js";
import { verifyMailer } from "./mailer.js";
import { warmCorpus } from "../../corpus-core/src/corpus-services.js";

// NODE_ENV=production: refuse to start on an unsafe or broken configuration (DEPLOY.md)
try { assertDeployable(); } catch (e) { console.error((e as Error).message); process.exit(1); }

const server = serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`MQRG remote on port ${info.port} — public address ${config.baseUrl}`);
});
void verifyMailer();

// Build the corpus's in-memory indexes (echoes, spellings, similarity, free text) now, in the
// background, so the first reader doesn't wait for them. Until they're ready those routes simply
// build on first use; if the corpus hasn't been migrated yet, say so plainly.
const t0 = Date.now();
warmCorpus(cloudCorpus)
  .then(() => console.log(`corpus ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`))
  .catch((e) => console.error(
    `corpus not ready — run \`npm run corpus:migrate\` to load it into Postgres (${(e as Error).message})`));

// `docker compose stop` / a redeploy sends SIGTERM: finish in-flight requests, then exit.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
