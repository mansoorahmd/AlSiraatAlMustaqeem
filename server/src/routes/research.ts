// Research routes — cases, form-status, trails, notes (research.db).

import { Hono } from "hono";
import type { AppState } from "../state.js";
import { backupResearch, defaultBackupPath } from "../backup.js";

export function researchRoutes(state: AppState): Hono {
  const r = new Hono();
  const s = state.research;

  // one-click backup: a clean, complete copy of research.db (WAL folded in).
  // `dest` (absolute, ending .db) is optional; the default sits in a sibling
  // backups/ folder next to the live db. Desktop passes a user-chosen path.
  r.post("/research/backup", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dest?: string; overwrite?: boolean };
    const dest = body.dest?.trim() ? body.dest.trim() : defaultBackupPath(state.researchDb.path);
    try {
      return c.json(backupResearch(state.researchDb, dest, { overwrite: body.overwrite === true }));
    } catch (e) {
      return c.json({ detail: (e as Error).message }, 400);
    }
  });

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

  // proposals from the MCP server, awaiting the reader's review
  r.get("/research/proposed", (c) => c.json(s.listProposed()));
  r.put("/research/proposed/:kind/:id/accept", (c) => {
    const kind = c.req.param("kind");
    if (kind !== "note" && kind !== "indication") {
      return c.json({ detail: "kind must be note or indication" }, 422);
    }
    if (!s.acceptProposed(kind, c.req.param("id"))) {
      return c.json({ detail: `no AI-proposed ${kind}: ${c.req.param("id")}` }, 404);
    }
    return c.json({ accepted: c.req.param("id") });
  });

  // word indications: meanings anchored at the ROOT (one primary per root) with
  // per-form refinements; standalone lemma indications for rootless words
  r.get("/research/indications/gloss", (c) => c.json(s.glossData()));
  r.get("/research/indications/for-word", (c) =>
    c.json(s.indicationsForWord(c.req.query("lemma") ?? null, c.req.query("root") ?? null)));
  r.get("/research/indications/:id/refinements", (c) => c.json(s.refinementsForParent(c.req.param("id"))));
  r.put("/research/indications/:id", async (c) => {
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return c.json({ detail: "document id does not match URL" }, 400);
    if (!doc.root && !doc.lemma) return c.json({ detail: "root or lemma is required" }, 422);
    return c.json(s.saveIndication(doc));
  });
  r.put("/research/indications/:id/primary", (c) => {
    const out = s.setPrimaryIndication(c.req.param("id"));
    if (!out) return c.json({ detail: `indication not found: ${c.req.param("id")}` }, 404);
    return c.json(out);
  });
  r.delete("/research/indications/:id", (c) => {
    if (!s.deleteIndication(c.req.param("id"))) return c.json({ detail: `indication not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
  });

  // per-form refinement of a root indication (this form's shade of that indication)
  r.put("/research/refinements/:id", async (c) => {
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return c.json({ detail: "document id does not match URL" }, 400);
    if (!doc.parentId || !doc.lemma) return c.json({ detail: "parentId and lemma are required" }, 422);
    const out = s.saveRefinement(doc);
    if (!out) return c.json({ detail: `root indication not found: ${doc.parentId}` }, 404);
    return c.json(out);
  });
  r.delete("/research/refinements/:id", (c) => {
    if (!s.deleteIndication(c.req.param("id"))) return c.json({ detail: `refinement not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
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

  // settings — device-independent key/value UI prefs (reading prefs, active comparison)
  r.get("/research/settings/:key", (c) => c.json({ value: s.getSetting(c.req.param("key")) ?? null }));
  r.put("/research/settings/:key", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { value?: unknown };
    s.setSetting(c.req.param("key"), body.value ?? null);
    return c.json({ ok: true });
  });

  return r;
}
