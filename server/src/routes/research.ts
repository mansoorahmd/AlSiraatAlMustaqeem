// Research routes, in two builders:
//
//   researchDataRoutes(store)   the research itself — cases, notes, indications, motifs,
//                               comparisons, settings, the outbox. Shared: the local server
//                               passes its research.db, the research server passes the signed-in
//                               user's own Postgres schema (remote/src/research/). Same paths,
//                               same JSON, either way.
//   researchFileRoutes(state)   local only: which research.db FILE is open, whose it is, backup.

import { Hono, type Context } from "hono";
import { reopenResearch, type AppState } from "../state.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupResearch, defaultBackupPath } from "../backup.js";
import type { ResearchStore } from "../research.js";

type Doc = Record<string, any>;

/**
 * The write boundary for AI-authored requests (the MCP): what the research server applies when a
 * request comes with an API token rather than the reader's own session. Undefined = the reader.
 */
export interface AiBoundary {
  /** refuse to overwrite an existing record the AI didn't create */
  mustBeNewOrAi(kind: "note" | "indication" | "motif" | "case", existing: Doc | undefined): void;
  /** tag the record as the AI's, and never let it set a primary */
  stamp<T extends Doc>(doc: T): T;
  /** refuse outright (deleting, accepting proposals, …) */
  refuse(what: string): never;
  /** a case write: the reader's items and conclusions preserved, only AI-owned additions allowed */
  mergeCase(existing: Doc | undefined, incoming: Doc): Doc;
}

export class BoundaryError extends Error {}

export function researchDataRoutes(
  storeFor: (c: Context) => ResearchStore | Promise<ResearchStore>,
  boundaryFor: (c: Context) => AiBoundary | undefined = () => undefined,
): Hono {
  const r = new Hono();
  r.onError((err, c) => {
    if (err instanceof BoundaryError) return c.json({ detail: err.message }, 403);
    throw err;
  });
  const idMismatch = (c: Context) => c.json({ detail: "document id does not match URL" }, 400);
  const notFound = (c: Context, what: string) => c.json({ detail: `${what} not found: ${c.req.param("id")}` }, 404);

  // cases
  r.get("/research/cases", async (c) => c.json(await (await storeFor(c)).listCases()));
  r.get("/research/cases/:id", async (c) => {
    const doc = await (await storeFor(c)).getCase(c.req.param("id"));
    return doc ? c.json(doc) : notFound(c, "case");
  });
  r.put("/research/cases/:id", async (c) => {
    const s = await storeFor(c);
    let doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    const ai = boundaryFor(c);
    if (ai) doc = ai.mergeCase(await s.getCase(doc.id), doc);
    return c.json(await s.saveCase(doc));
  });
  r.delete("/research/cases/:id", async (c) => {
    boundaryFor(c)?.refuse("delete a case");
    if (!(await (await storeFor(c)).deleteCase(c.req.param("id")))) return notFound(c, "case");
    return c.json({ deleted: c.req.param("id") });
  });

  r.get("/research/form-status", async (c) => c.json(await (await storeFor(c)).formStatus()));
  r.get("/research/cases/:id/forms/:lemma/revisions", async (c) =>
    c.json(await (await storeFor(c)).revisions(c.req.param("id"), c.req.param("lemma"))));

  // trails
  r.get("/research/trails", async (c) => c.json(await (await storeFor(c)).listTrails()));
  r.put("/research/trails/:id", async (c) => {
    boundaryFor(c)?.refuse("write trails");
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    return c.json(await (await storeFor(c)).saveTrail(doc));
  });
  r.delete("/research/trails/:id", async (c) => {
    boundaryFor(c)?.refuse("delete trails");
    if (!(await (await storeFor(c)).deleteTrail(c.req.param("id")))) return notFound(c, "trail");
    return c.json({ deleted: c.req.param("id") });
  });

  // notes
  r.get("/research/notes", async (c) =>
    c.json(await (await storeFor(c)).listNotes({
      verse: c.req.query("verse") ?? undefined,
      root: c.req.query("root") ?? undefined,
      lemma: c.req.query("lemma") ?? undefined,
    })));
  r.put("/research/notes/:id", async (c) => {
    const s = await storeFor(c);
    let doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    const ai = boundaryFor(c);
    if (ai) { ai.mustBeNewOrAi("note", await s.getNote(doc.id)); doc = ai.stamp(doc); }
    return c.json(await s.saveNote(doc));
  });
  r.delete("/research/notes/:id", async (c) => {
    boundaryFor(c)?.refuse("delete notes");
    if (!(await (await storeFor(c)).deleteNote(c.req.param("id")))) return notFound(c, "note");
    return c.json({ deleted: c.req.param("id") });
  });

  // user root meanings
  r.get("/research/root-meanings", async (c) => c.json(await (await storeFor(c)).listRootMeanings()));
  r.get("/research/root-meanings/:root", async (c) =>
    c.json(await (await storeFor(c)).getRootMeaning(c.req.param("root"))));
  r.put("/research/root-meanings/:root", async (c) => {
    boundaryFor(c)?.refuse("set the reader's own root meaning");
    const body = (await c.req.json().catch(() => ({}))) as { meaning?: string };
    return c.json(await (await storeFor(c)).setRootMeaning(c.req.param("root"), body.meaning ?? ""));
  });
  r.delete("/research/root-meanings/:root", async (c) => {
    boundaryFor(c)?.refuse("delete the reader's own root meaning");
    await (await storeFor(c)).deleteRootMeaning(c.req.param("root"));
    return c.json({ deleted: c.req.param("root") });
  });

  // motifs (بيوت)
  r.get("/research/motifs", async (c) => c.json(await (await storeFor(c)).listMotifs()));
  r.get("/research/motifs/by-root/:root", async (c) =>
    c.json(await (await storeFor(c)).motifsForRoot(c.req.param("root"))));
  r.get("/research/motifs/:id", async (c) => {
    const m = await (await storeFor(c)).getMotif(c.req.param("id"));
    return m ? c.json(m) : notFound(c, "motif");
  });
  r.put("/research/motifs/:id", async (c) => {
    const s = await storeFor(c);
    let doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    const ai = boundaryFor(c);
    if (ai) { ai.mustBeNewOrAi("motif", await s.getMotif(doc.id)); doc = ai.stamp(doc); }
    return c.json(await s.saveMotif(doc));
  });
  r.delete("/research/motifs/:id", async (c) => {
    boundaryFor(c)?.refuse("delete motifs");
    if (!(await (await storeFor(c)).deleteMotif(c.req.param("id")))) return notFound(c, "motif");
    return c.json({ deleted: c.req.param("id") });
  });
  // An AI may add roots to (or remove them from) only a motif it proposed.
  const aiMayEditMotif = async (c: Context, s: ResearchStore) => {
    const ai = boundaryFor(c);
    if (!ai) return;
    const id = c.req.param("id") ?? "";
    const m = await s.getMotif(id);
    if (!m) throw new BoundaryError(`No such motif: ${id}.`);
    ai.mustBeNewOrAi("motif", m);
  };
  r.put("/research/motifs/:id/roots/:root", async (c) => {
    const s = await storeFor(c);
    await aiMayEditMotif(c, s);
    await s.addMotifRoot(c.req.param("id"), c.req.param("root"));
    return c.json({ ok: true });
  });
  r.delete("/research/motifs/:id/roots/:root", async (c) => {
    const s = await storeFor(c);
    await aiMayEditMotif(c, s);
    await s.removeMotifRoot(c.req.param("id"), c.req.param("root"));
    return c.json({ ok: true });
  });

  // proposals from the MCP server, awaiting the reader's review
  r.get("/research/proposed", async (c) => c.json(await (await storeFor(c)).listProposed()));
  r.put("/research/proposed/:kind/:id/accept", async (c) => {
    boundaryFor(c)?.refuse("accept its own proposals — that is the reader's decision");
    const kind = c.req.param("kind");
    if (kind !== "note" && kind !== "indication") {
      return c.json({ detail: "kind must be note or indication" }, 422);
    }
    if (!(await (await storeFor(c)).acceptProposed(kind, c.req.param("id")))) {
      return c.json({ detail: `no AI-proposed ${kind}: ${c.req.param("id")}` }, 404);
    }
    return c.json({ accepted: c.req.param("id") });
  });

  // word indications: meanings anchored at the ROOT (one primary per root) with
  // per-form refinements; standalone lemma indications for rootless words
  r.get("/research/indications/gloss", async (c) => c.json(await (await storeFor(c)).glossData()));
  r.get("/research/indications/for-word", async (c) =>
    c.json(await (await storeFor(c)).indicationsForWord(
      c.req.query("lemma") ?? null, c.req.query("root") ?? null, c.req.query("surface") ?? null)));
  r.get("/research/indications/:id/refinements", async (c) =>
    c.json(await (await storeFor(c)).refinementsForParent(c.req.param("id"))));
  r.get("/research/indications/:id", async (c) => {
    const d = await (await storeFor(c)).getIndication(c.req.param("id"));
    return d ? c.json(d) : notFound(c, "indication");
  });
  r.put("/research/indications/:id", async (c) => {
    const s = await storeFor(c);
    let doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    if (!doc.root && !doc.lemma) return c.json({ detail: "root or lemma is required" }, 422);
    const ai = boundaryFor(c);
    if (ai) { ai.mustBeNewOrAi("indication", await s.getIndication(doc.id)); doc = ai.stamp(doc); }
    return c.json(await s.saveIndication(doc));
  });
  r.put("/research/indications/:id/primary", async (c) => {
    boundaryFor(c)?.refuse("choose the reader's primary indication");
    const out = await (await storeFor(c)).setPrimaryIndication(c.req.param("id"));
    return out ? c.json(out) : notFound(c, "indication");
  });
  r.delete("/research/indications/:id", async (c) => {
    boundaryFor(c)?.refuse("delete indications");
    if (!(await (await storeFor(c)).deleteIndication(c.req.param("id")))) return notFound(c, "indication");
    return c.json({ deleted: c.req.param("id") });
  });

  // per-form refinement of a root indication (this form's shade of that indication)
  r.put("/research/refinements/:id", async (c) => {
    const s = await storeFor(c);
    let doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    if (!doc.parentId || !doc.lemma) return c.json({ detail: "parentId and lemma are required" }, 422);
    const ai = boundaryFor(c);
    if (ai) {
      ai.mustBeNewOrAi("indication", (await s.refinementFor(doc.parentId, doc.lemma)) ?? undefined);
      doc = ai.stamp(doc);
    }
    const out = await s.saveRefinement(doc);
    if (!out) return c.json({ detail: `root indication not found: ${doc.parentId}` }, 404);
    return c.json(out);
  });
  r.delete("/research/refinements/:id", async (c) => {
    boundaryFor(c)?.refuse("delete refinements");
    if (!(await (await storeFor(c)).deleteIndication(c.req.param("id")))) return notFound(c, "refinement");
    return c.json({ deleted: c.req.param("id") });
  });

  // comparisons (saveable boards of pinned āyāt & roots)
  r.get("/research/compare-sets", async (c) => c.json(await (await storeFor(c)).listCompareSets()));
  r.put("/research/compare-sets/:id", async (c) => {
    boundaryFor(c)?.refuse("edit comparisons");
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    return c.json(await (await storeFor(c)).saveCompareSet(doc));
  });
  r.delete("/research/compare-sets/:id", async (c) => {
    boundaryFor(c)?.refuse("delete comparisons");
    if (!(await (await storeFor(c)).deleteCompareSet(c.req.param("id")))) return notFound(c, "comparison");
    return c.json({ deleted: c.req.param("id") });
  });
  r.get("/research/compare-sets/:id/items", async (c) =>
    c.json(await (await storeFor(c)).listCompareItems(c.req.param("id"))));
  r.delete("/research/compare-sets/:id/items", async (c) => {
    boundaryFor(c)?.refuse("edit comparisons");
    await (await storeFor(c)).clearCompareItems(c.req.param("id"));
    return c.json({ ok: true });
  });
  r.put("/research/compare-sets/:id/items/:itemId", async (c) => {
    boundaryFor(c)?.refuse("edit comparisons");
    const body = (await c.req.json().catch(() => ({}))) as { kind?: "ayah" | "root"; ref?: string; label?: string | null };
    if (!body.kind || !body.ref) return c.json({ detail: "kind and ref are required" }, 422);
    return c.json(await (await storeFor(c)).addCompareItem(c.req.param("id"), { id: c.req.param("itemId"), ...body }));
  });
  r.delete("/research/compare-sets/:id/items/:itemId", async (c) => {
    boundaryFor(c)?.refuse("edit comparisons");
    if (!(await (await storeFor(c)).removeCompareItem(c.req.param("id"), c.req.param("itemId"))))
      return c.json({ detail: `item not found: ${c.req.param("itemId")}` }, 404);
    return c.json({ deleted: c.req.param("itemId") });
  });

  // outbound submission ledger: which records have been offered upstream, and with what
  // content — so the app can show "shared" vs "changed since shared" and chain a re-submission
  // via `supersedes` rather than creating an orphaned duplicate.
  r.get("/research/submission-log", async (c) => c.json(await (await storeFor(c)).listSubmissionLog()));
  r.get("/research/submission-log/:localRef", async (c) =>
    c.json((await (await storeFor(c)).getSubmissionFor(c.req.param("localRef"))) ?? null));
  r.put("/research/submission-log/:localRef", async (c) => {
    boundaryFor(c)?.refuse("publish");
    const body = (await c.req.json().catch(() => ({}))) as
      { submissionId?: string; contentHash?: string; kind?: string; status?: string };
    if (!body.submissionId || !body.contentHash) {
      return c.json({ detail: "submissionId and contentHash are required" }, 422);
    }
    return c.json(await (await storeFor(c)).recordSubmission({ localRef: c.req.param("localRef"), ...body }));
  });

  // proposed-claims ledger: which readings this reader has offered to the community, so the
  // Propose button can show "proposed" vs "changed since proposed". The claim itself is remote.
  r.get("/research/proposals", async (c) =>
    c.json((await (await storeFor(c)).getProposal(
      c.req.query("subjectKind") ?? "form", c.req.query("subjectValue") ?? "")) ?? null));
  r.post("/research/proposals", async (c) => {
    boundaryFor(c)?.refuse("publish");
    const body = (await c.req.json().catch(() => ({}))) as
      { subjectKind?: string; subjectValue?: string; contentHash?: string };
    if (!body.subjectValue || !body.contentHash) {
      return c.json({ detail: "subjectValue and contentHash are required" }, 422);
    }
    return c.json(await (await storeFor(c)).recordProposal({
      subjectKind: body.subjectKind ?? "form", subjectValue: body.subjectValue, contentHash: body.contentHash,
    }));
  });

  // settings — device-independent key/value UI prefs (reading prefs, active comparison)
  r.get("/research/settings/:key", async (c) =>
    c.json({ value: (await (await storeFor(c)).getSetting(c.req.param("key"))) ?? null }));
  r.put("/research/settings/:key", async (c) => {
    boundaryFor(c)?.refuse("change settings");
    const body = (await c.req.json().catch(() => ({}))) as { value?: unknown };
    await (await storeFor(c)).setSetting(c.req.param("key"), body.value ?? null);
    return c.json({ ok: true });
  });

  return r;
}

/** Local only: the research.db FILE — which one is open, whose it is, and backing it up. */
export function researchFileRoutes(state: AppState): Hono {
  const r = new Hono();
  // NB: read the store per request — `state.research` is swapped when the reader opens another
  // file, and a captured reference would keep writing to the old one.
  const s = () => state.research;

  // the reader's account-independent local identity (minted on first run). Sign-in binds an
  // account to this id, so pre-account work stays correctly attributed.
  r.get("/research/identity", async (c) => c.json({
    localId: s().localId,
    // which research.db this server is actually using — never leave this a mystery
    databasePath: state.researchDb.path,
    // whose research this file is, read from inside the file itself. null until claimed.
    owner: (await s().getOwner()) ?? null,
  }));

  /**
   * Claim this database, or re-assign it. You hold the file, so you may correct a typo or hand
   * it on; the uuid is re-derived from the email and becomes the id remote work binds to.
   */
  r.put("/research/owner", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; name?: string };
    try {
      const owner = await s().setOwner(body.email ?? "", body.name);
      // label the recent-files entry with the person, not the filename
      state.databases.label(state.researchDb.path, (owner.name as string) || (owner.email as string));
      return c.json(owner);
    } catch (e) {
      return c.json({ detail: (e as Error).message }, 422);
    }
  });

  // --- which database file is open (identity lives inside each file, not here) ---
  r.get("/research/databases", async (c) => c.json({
    current: { path: state.researchDb.path, owner: (await s().getOwner()) ?? null },
    recent: state.databases.recent(),
  }));

  /**
   * Open another .db — a backup, a colleague's file, your own from another machine.
   *
   * By default the file is COPIED to the working location and you edit the copy: opening a
   * backup in place would turn it into a live database (WAL sidecars appear beside it) and it
   * would stop being the untouched copy you took. Any existing working database is moved aside,
   * never overwritten, and its new path is reported. `inPlace: true` opts out.
   */
  r.post("/research/databases/open", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { path?: string; inPlace?: boolean };
    if (!body.path) return c.json({ detail: "path is required" }, 422);
    const previous = state.researchDb.path;
    try {
      let full: string;
      let replaced: string | null = null;
      if (body.inPlace) {
        full = state.databases.use(body.path);
      } else {
        state.researchDb.close();          // release the working file before replacing it
        ({ path: full, replaced } = state.databases.adopt(body.path));
      }
      await reopenResearch(state, full);
      const owner = await s().getOwner();
      if (owner) state.databases.label(full, (owner.name as string) || (owner.email as string));
      return c.json({ path: state.researchDb.path, owner: owner ?? null, replaced });
    } catch (e) {
      try { await reopenResearch(state, previous); } catch { /* nothing more to do */ }
      return c.json({ detail: (e as Error).message }, 400);
    }
  });

  /**
   * The open research.db itself, as one clean file (WAL folded in) — what the app uploads to
   * the research server to bring this computer's research into the reader's account. The file
   * on disk is left exactly as it is.
   */
  r.get("/research/file", async (c) => {
    const dir = mkdtempSync(join(tmpdir(), "alsiraat-file-"));
    try {
      const copy = join(dir, "research.db");
      backupResearch(state.researchDb, copy);
      return c.body(readFileSync(copy), 200, {
        "content-type": "application/vnd.sqlite3", "cache-control": "no-store",
      });
    } finally {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp */ }
    }
  });

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

  return r;
}
