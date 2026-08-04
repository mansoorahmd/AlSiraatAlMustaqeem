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

  // user root meanings
  r.get("/research/root-meanings", (c) => c.json(s.listRootMeanings()));
  r.get("/research/root-meanings/:root", (c) => c.json(s.getRootMeaning(c.req.param("root"))));
  r.put("/research/root-meanings/:root", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { meaning?: string };
    return c.json(s.setRootMeaning(c.req.param("root"), body.meaning ?? ""));
  });
  r.delete("/research/root-meanings/:root", (c) => {
    s.deleteRootMeaning(c.req.param("root"));
    return c.json({ deleted: c.req.param("root") });
  });

  // motifs (بيوت)
  r.get("/research/motifs", (c) => c.json(s.listMotifs()));
  r.get("/research/motifs/by-root/:root", (c) => c.json(s.motifsForRoot(c.req.param("root"))));
  r.put("/research/motifs/:id", async (c) => {
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return c.json({ detail: "document id does not match URL" }, 400);
    return c.json(s.saveMotif(doc));
  });
  r.delete("/research/motifs/:id", (c) => {
    if (!s.deleteMotif(c.req.param("id"))) return c.json({ detail: `motif not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
  });
  r.put("/research/motifs/:id/roots/:root", (c) => {
    s.addMotifRoot(c.req.param("id"), c.req.param("root"));
    return c.json({ ok: true });
  });
  r.delete("/research/motifs/:id/roots/:root", (c) => {
    s.removeMotifRoot(c.req.param("id"), c.req.param("root"));
    return c.json({ ok: true });
  });

  // comparisons (saveable boards of pinned āyāt & roots)
  r.get("/research/compare-sets", (c) => c.json(s.listCompareSets()));
  r.put("/research/compare-sets/:id", async (c) => {
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return c.json({ detail: "document id does not match URL" }, 400);
    return c.json(s.saveCompareSet(doc));
  });
  r.delete("/research/compare-sets/:id", (c) => {
    if (!s.deleteCompareSet(c.req.param("id"))) return c.json({ detail: `comparison not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
  });
  r.get("/research/compare-sets/:id/items", (c) => c.json(s.listCompareItems(c.req.param("id"))));
  r.delete("/research/compare-sets/:id/items", (c) => {
    s.clearCompareItems(c.req.param("id"));
    return c.json({ ok: true });
  });
  r.put("/research/compare-sets/:id/items/:itemId", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: "ayah" | "root"; ref?: string; label?: string | null };
    if (!body.kind || !body.ref) return c.json({ detail: "kind and ref are required" }, 422);
    return c.json(s.addCompareItem(c.req.param("id"), { id: c.req.param("itemId"), ...body }));
  });
  r.delete("/research/compare-sets/:id/items/:itemId", (c) => {
    if (!s.removeCompareItem(c.req.param("id"), c.req.param("itemId")))
      return c.json({ detail: `item not found: ${c.req.param("itemId")}` }, 404);
    return c.json({ deleted: c.req.param("itemId") });
  });

  return r;
}
