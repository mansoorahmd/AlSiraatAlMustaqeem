// The corpus routes over quran.db, mounted at /corpus — what the golden-parity tests call. It's
// the same route code the research server mounts at /corpus (server/src/corpus/serve.ts), over the
// SQLite driver instead of Postgres. The study tools (routes/tools.ts: occurrences, spellings,
// speech openers, pronouns, wording, diff, spread, supplications, frame) come in with toolRoutes.

import { Hono } from "hono";
import { resolve } from "node:path";
import { Db } from "../src/db.js";
import { sqliteCorpus } from "../src/corpus-db.js";
import { createCorpusServices, type CorpusServices } from "../src/corpus-services.js";
import { HttpError } from "../src/content.js";
import { contentRoutes } from "../src/routes/content.js";
import { rootRoutes } from "../src/routes/roots.js";
import { similarityRoutes } from "../src/routes/similarity.js";
import { echoRoutes } from "../src/routes/echoes.js";
import { linkRoutes } from "../src/routes/links.js";
import { constructionRoutes } from "../src/routes/constructions.js";
import { toolRoutes } from "../src/routes/tools.js";
import { corpusRoutes } from "../src/routes/corpus.js";

const QURAN = process.env.QF_QURAN_DB ?? resolve(import.meta.dirname, "..", "..", "quran.db");

let services: CorpusServices | undefined;
/** The corpus services over quran.db (one set per test file). */
export const corpusServices = (): CorpusServices =>
  (services ??= createCorpusServices(sqliteCorpus(new Db(QURAN, { readOnly: true }))));

export function corpusTestApp(): Hono {
  const svc = corpusServices();
  const v1 = new Hono();
  for (const r of [contentRoutes(svc), rootRoutes(svc), similarityRoutes(svc), echoRoutes(svc), linkRoutes(svc), constructionRoutes(svc), toolRoutes(svc), corpusRoutes(svc)]) {
    v1.route("/", r);
  }
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ detail: err.message }, err.status as 400);
    return c.json({ detail: `internal error: ${(err as Error).message}` }, 500);
  });
  return app.route("/corpus", v1);
}
