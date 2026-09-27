// Corpus channel routes. Read-only reporting only — applying patches writes to the corpus and is
// done out-of-band by the CLI / desktop startup, not through a running server (which holds the
// corpus read-only). Mounted by both hosts (see routes/content.ts).

import { Hono } from "hono";
import { corpusVersion, type CorpusServices } from "../corpus-services.js";

export function corpusRoutes(svc: CorpusServices): Hono {
  const r = new Hono();
  // which corpus edition is loaded — 0 if never patched
  r.get("/corpus/version", async (c) => c.json(await corpusVersion(svc.corpus)));
  return r;
}
