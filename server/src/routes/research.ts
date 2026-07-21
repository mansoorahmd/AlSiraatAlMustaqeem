// Research routes — cases, form-status, trails, notes (research.db).

import { Hono } from "hono";
import type { AppState } from "../state.js";

export function researchRoutes(state: AppState): Hono {
  const r = new Hono();
  const s = state.research;

  // cases
  r.get("/research/cases", (c) => c.json(s.listCases()));
  r.get("/research/cases/:id", (c) => {
    const doc = s.getCase(c.req.param("id"));
    if (!doc) return c.json({ detail: `case not found: ${c.req.param("id")}` }, 404);
    return c.json(doc);
  });
  r.put("/research/cases/:id", async (c) => {
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return c.json({ detail: "document id does not match URL" }, 400);
    return c.json(s.saveCase(doc));
  });
  r.delete("/research/cases/:id", (c) => {
    if (!s.deleteCase(c.req.param("id"))) return c.json({ detail: `case not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
  });

  r.get("/research/form-status", (c) => c.json(s.formStatus()));
  r.get("/research/cases/:id/forms/:lemma/revisions", (c) =>
    c.json(s.revisions(c.req.param("id"), c.req.param("lemma"))));

  // trails
  r.get("/research/trails", (c) => c.json(s.listTrails()));
  r.put("/research/trails/:id", async (c) => {
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return c.json({ detail: "document id does not match URL" }, 400);
    return c.json(s.saveTrail(doc));
  });
  r.delete("/research/trails/:id", (c) => {
    if (!s.deleteTrail(c.req.param("id"))) return c.json({ detail: `trail not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
  });

  // notes
  r.get("/research/notes", (c) =>
    c.json(s.listNotes({
      verse: c.req.query("verse") ?? undefined,
      root: c.req.query("root") ?? undefined,
      lemma: c.req.query("lemma") ?? undefined,
    })));
  r.put("/research/notes/:id", async (c) => {
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return c.json({ detail: "document id does not match URL" }, 400);
    return c.json(s.saveNote(doc));
  });
  r.delete("/research/notes/:id", (c) => {
    if (!s.deleteNote(c.req.param("id"))) return c.json({ detail: `note not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
  });

  return r;
}
