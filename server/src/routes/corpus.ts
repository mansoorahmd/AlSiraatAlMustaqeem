// Corpus channel routes. Read-only reporting only — applying patches writes to quran.db
// and is done out-of-band by the CLI / desktop startup, not through the running server
// (which holds the corpus read-only).

import { Hono } from "hono";
import type { AppState } from "../state.js";
import { readCorpusVersion } from "../corpus/patch.js";

export function corpusRoutes(state: AppState): Hono {
  const r = new Hono();
  // which corpus edition is loaded — 0 if never patched
  r.get("/corpus/version", (c) => c.json(readCorpusVersion(state.quran)));
  return r;
}
