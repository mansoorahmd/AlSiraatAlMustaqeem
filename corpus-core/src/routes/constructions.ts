// Construction routes: search the Book by grammar (constructions.ts), and the ready-made queries.
// Mounted by both hosts (see routes/content.ts).

import { Hono } from "hono";
import type { CorpusServices } from "../corpus-services.js";
import {
  CONSTRUCTION_PRESETS, ConstructionQueryError, parseConstructionSearch, POS_TAGS, POS_CLASSES, PREFIXES,
  DERIVATIONS, VERB_FORMS, SUFFIXES,
} from "../constructions.js";

export function constructionRoutes(svc: CorpusServices): Hono {
  const r = new Hono();

  // body: { slots: [{ form?, lemma?, root?, pos?, prefix?, verb?, gap? }, …], atStart?, limit?, offset? }
  r.post("/construction-search", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    let q;
    try {
      q = parseConstructionSearch(body);
    } catch (e) {
      if (e instanceof ConstructionQueryError) return c.json({ detail: e.message }, 400);
      throw e;
    }
    return c.json(await svc.constructions.search(q));
  });

  // the presets, plus the vocabulary a query may use (for building one)
  r.get("/construction-presets", (c) =>
    c.json({
      presets: CONSTRUCTION_PRESETS, pos: POS_TAGS, classes: POS_CLASSES, prefixes: PREFIXES,
      derivations: DERIVATIONS, verbForms: VERB_FORMS, suffixes: SUFFIXES,
    }));

  return r;
}
