// The research routes — cases, notes, indications, motifs, comparisons, settings, the outbox —
// over the request's store (serve.ts builds it, bound to the signed-in user).

import { Hono, type Context } from "hono";
import type { ResearchStore } from "./store.js";

type Doc = Record<string, any>;

/**
 * The write boundary for AI-authored requests (the MCP): what the research server applies when a
 * request comes with an API token rather than the reader's own session. Undefined = the reader.
 */
export interface AiBoundary {
  /** refuse to overwrite an existing record the AI didn't create */
  mustBeNewOrAi(kind: "note" | "indication" | "motif" | "case" | "link" | "speaker tag", existing: Doc | undefined): void;
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

  // revisions: the earlier texts the reader replaced (a form's meaning, a verdict, a root
  // meaning, an indication). The store keeps them as those are saved; here the reader reads
  // them, says why they changed their mind, or removes one. An assistant may only read them.
  const REVISION_KINDS = ["form", "verdict", "root-meaning", "indication"];
  r.get("/research/revisions", async (c) => {
    const kind = c.req.query("kind") ?? "";
    const target = c.req.query("target") ?? "";
    if (!REVISION_KINDS.includes(kind) || !target) {
      return c.json({ detail: `send kind (one of ${REVISION_KINDS.join(", ")}) and target` }, 422);
    }
    return c.json(await (await storeFor(c)).listRevisions(kind, target));
  });
  r.put("/research/revisions/:id", async (c) => {
    boundaryFor(c)?.refuse("say why the reader changed their mind");
    const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
    if (typeof body.reason !== "string") return c.json({ detail: "reason must be text" }, 422);
    const out = await (await storeFor(c)).setRevisionReason(c.req.param("id"), body.reason.trim().slice(0, 4000));
    return out ? c.json(out) : notFound(c, "earlier version");
  });
  r.delete("/research/revisions/:id", async (c) => {
    boundaryFor(c)?.refuse("remove an earlier version");
    if (!(await (await storeFor(c)).deleteRevision(c.req.param("id")))) return notFound(c, "earlier version");
    return c.json({ deleted: c.req.param("id") });
  });

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
  r.get("/research/notes/:id", async (c) => {
    const n = await (await storeFor(c)).getNote(c.req.param("id"));
    return n ? c.json(n) : notFound(c, "note");
  });
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

  // links: a saved link between two places in the Book (one end only = a lead)
  const VERSE = /^([1-9]\d{0,2}):([1-9]\d{0,2})$/;
  const span = (v: any): string | null => {
    if (!v || typeof v.verseKey !== "string" || !VERSE.test(v.verseKey)) return "a link end needs a verse key like 2:255";
    for (const k of ["word", "words"]) {
      if (v[k] !== undefined && v[k] !== null && !(Number.isInteger(v[k]) && v[k] >= 1)) return `${k} must be a whole number from 1`;
    }
    return null;
  };
  const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);
  r.get("/research/links", async (c) =>
    c.json(await (await storeFor(c)).listLinks({
      verse: c.req.query("verse") ?? undefined, chapter: num(c.req.query("chapter")),
      status: c.req.query("status") ?? undefined, kind: c.req.query("kind"), label: c.req.query("label"),
      markerKind: c.req.query("marker_kind") ?? undefined, markerKey: c.req.query("marker_key") ?? undefined,
    })));
  r.get("/research/links/labels", async (c) => c.json(await (await storeFor(c)).linkLabels()));
  r.get("/research/links/coverage", async (c) => c.json(await (await storeFor(c)).linkCoverage()));
  r.get("/research/links/:id", async (c) => {
    const l = await (await storeFor(c)).getLink(c.req.param("id"));
    return l ? c.json(l) : notFound(c, "link");
  });
  r.put("/research/links/:id", async (c) => {
    const s = await storeFor(c);
    let doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    const bad = span(doc.a) ?? (doc.b ? span(doc.b) : null);
    if (bad) return c.json({ detail: bad }, 422);
    const ai = boundaryFor(c);
    // settling a tension, and saying how, is the reader's
    if (ai) { ai.mustBeNewOrAi("link", await s.getLink(doc.id)); doc = { ...ai.stamp(doc), resolved: false, resolution: "" }; }
    return c.json(await s.saveLink(doc));
  });
  r.delete("/research/links/:id", async (c) => {
    boundaryFor(c)?.refuse("delete links");
    if (!(await (await storeFor(c)).deleteLink(c.req.param("id")))) return notFound(c, "link");
    return c.json({ deleted: c.req.param("id") });
  });

  // a speech opener the reader set aside: "no speech begins here". Theirs to decide.
  const skipPlace = (v: any): string | null =>
    !v || typeof v.verseKey !== "string" || !VERSE.test(v.verseKey) ? "send a verse key like 2:255"
      : !(Number.isInteger(v.word) && v.word >= 1) ? "word must be a whole number from 1" : null;
  r.get("/research/speech-skips", async (c) =>
    c.json(await (await storeFor(c)).listSpeechSkips(num(c.req.query("chapter")))));
  r.put("/research/speech-skips", async (c) => {
    boundaryFor(c)?.refuse("set a speech opener aside");
    const body = await c.req.json().catch(() => null);
    const bad = skipPlace(body);
    if (bad) return c.json({ detail: bad }, 422);
    await (await storeFor(c)).addSpeechSkip(body.verseKey, body.word);
    return c.json({ skipped: { verseKey: body.verseKey, word: body.word } });
  });
  r.post("/research/speech-skips/remove", async (c) => {
    boundaryFor(c)?.refuse("put a speech opener back");
    const body = await c.req.json().catch(() => null);
    const bad = skipPlace(body);
    if (bad) return c.json({ detail: bad }, 422);
    return c.json({ removed: await (await storeFor(c)).removeSpeechSkip(body.verseKey, body.word) });
  });

  // speech: who speaks in a span of an āyah, and to whom, as the reader tags it
  r.get("/research/speech", async (c) =>
    c.json(await (await storeFor(c)).listSpeech({
      verse: c.req.query("verse") ?? undefined, chapter: num(c.req.query("chapter")),
      speaker: c.req.query("speaker"), addressee: c.req.query("addressee"),
    })));
  r.get("/research/speech/speakers", async (c) => c.json(await (await storeFor(c)).speakers()));
  r.put("/research/speech/:id", async (c) => {
    const s = await storeFor(c);
    let doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    const bad = span({ verseKey: doc.verseKey, word: doc.word, words: doc.words });
    if (bad) return c.json({ detail: bad.replace("a link end", "a speaker tag") }, 422);
    if (!String(doc.speaker ?? "").trim() && !String(doc.addressee ?? "").trim()) {
      return c.json({ detail: "a speaker tag needs a speaker or an addressee" }, 422);
    }
    if (doc.basis !== undefined && doc.basis !== "" && doc.basis !== "stated" && doc.basis !== "inferred") {
      return c.json({ detail: "basis must be stated, inferred or empty" }, 422);
    }
    const ai = boundaryFor(c);
    if (ai) { ai.mustBeNewOrAi("speaker tag", await s.getSpeech(doc.id)); doc = ai.stamp(doc); }
    return c.json(await s.saveSpeech(doc));
  });
  r.delete("/research/speech/:id", async (c) => {
    boundaryFor(c)?.refuse("delete speaker tags");
    if (!(await (await storeFor(c)).deleteSpeech(c.req.param("id")))) return c.json({ detail: `speaker tag not found: ${c.req.param("id")}` }, 404);
    return c.json({ deleted: c.req.param("id") });
  });

  // rule checks: a rule the reader states, set against every place it covers. Which places is
  // the corpus's to say (POST /corpus/occurrences with the rule's scope); here live the rule
  // and the marks.
  const SCOPE_KINDS = ["phrase", "pair", "form", "lemma", "root", "spelling", "construction"];
  const MARKS = ["fits", "exception", "unsure"];
  const place = (v: any): string | null => {
    if (!v || typeof v.verseKey !== "string" || !VERSE.test(v.verseKey)) return "a place needs a verse key like 2:255";
    if (!(Number.isInteger(v.word) && v.word >= 1)) return "word must be a whole number from 1";
    return null;
  };
  const places = (list: unknown, max: number): string | null => {
    if (!Array.isArray(list) || list.length === 0) return "send at least one place";
    if (list.length > max) return `at most ${max} places at a time`;
    for (const p of list) { const bad = place(p); if (bad) return bad; }
    return null;
  };
  r.get("/research/rules", async (c) => c.json(await (await storeFor(c)).listRules()));
  r.get("/research/rules/:id", async (c) => {
    const rule = await (await storeFor(c)).getRule(c.req.param("id"));
    return rule ? c.json(rule) : notFound(c, "rule");
  });
  r.put("/research/rules/:id", async (c) => {
    // stating a rule, and what would prove it wrong, is the reader's
    boundaryFor(c)?.refuse("write a rule");
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    const scope = doc.scope;
    if (!scope || !SCOPE_KINDS.includes(scope.kind) || typeof scope.key !== "string" || !scope.key) {
      return c.json({ detail: `a rule needs what it covers: scope.kind (one of ${SCOPE_KINDS.join(", ")}) and scope.key` }, 422);
    }
    if (scope.kind === "construction" && (!scope.query || typeof scope.query !== "object")) {
      return c.json({ detail: "a rule over a grammar pattern needs scope.query" }, 422);
    }
    if (!String(doc.title ?? "").trim() && !String(doc.statement ?? "").trim()) {
      return c.json({ detail: "a rule needs a title or a statement" }, 422);
    }
    return c.json(await (await storeFor(c)).saveRule(doc));
  });
  r.delete("/research/rules/:id", async (c) => {
    boundaryFor(c)?.refuse("delete a rule");
    if (!(await (await storeFor(c)).deleteRule(c.req.param("id")))) return notFound(c, "rule");
    return c.json({ deleted: c.req.param("id") });
  });
  r.put("/research/rules/:id/marks", async (c) => {
    const s = await storeFor(c);
    const body = (await c.req.json().catch(() => ({}))) as { marks?: any[] };
    const bad = places(body.marks, 6000);
    if (bad) return c.json({ detail: bad }, 422);
    if (body.marks!.some((m) => !MARKS.includes(m.mark))) return c.json({ detail: `mark must be one of ${MARKS.join(", ")}` }, 422);
    if (!(await s.getRule(c.req.param("id")))) return notFound(c, "rule");
    // an AI's marks are suggestions: they never replace the reader's own (the store sees to it)
    return c.json({ saved: await s.saveRuleMarks(c.req.param("id"), body.marks!, boundaryFor(c) ? "ai" : "me") });
  });
  r.post("/research/rules/:id/marks/remove", async (c) => {
    boundaryFor(c)?.refuse("remove marks");
    const body = (await c.req.json().catch(() => ({}))) as { places?: any[] };
    const bad = places(body.places, 6000);
    if (bad) return c.json({ detail: bad }, 422);
    return c.json({ removed: await (await storeFor(c)).removeRuleMarks(c.req.param("id"), body.places!) });
  });
  r.post("/research/rules/:id/marks/accept", async (c) => {
    boundaryFor(c)?.refuse("accept suggestions");
    const body = (await c.req.json().catch(() => ({}))) as { places?: any[] };
    if (body.places !== undefined && body.places !== null) {
      const bad = places(body.places, 6000);
      if (bad) return c.json({ detail: bad }, 422);
    }
    return c.json({ accepted: await (await storeFor(c)).acceptRuleMarks(c.req.param("id"), body.places ?? undefined) });
  });

  // characters: someone the reader names; mentions: the places that point to them
  const MENTION_KINDS = ["name", "title", "description", "pronoun"];
  r.get("/research/characters", async (c) => c.json(await (await storeFor(c)).listCharacters()));
  r.get("/research/characters/:id", async (c) => {
    const ch = await (await storeFor(c)).getCharacter(c.req.param("id"));
    return ch ? c.json(ch) : notFound(c, "character");
  });
  r.put("/research/characters/:id", async (c) => {
    // who is a character, and under which names, is the reader's to say
    boundaryFor(c)?.refuse("write a character");
    const doc = await c.req.json();
    if (doc?.id !== c.req.param("id")) return idMismatch(c);
    if (!String(doc.name ?? "").trim()) return c.json({ detail: "a character needs a name" }, 422);
    if (doc.designations !== undefined && !Array.isArray(doc.designations)) return c.json({ detail: "designations must be a list" }, 422);
    for (const d of doc.designations ?? []) {
      if (!d || !SCOPE_KINDS.includes(d.kind) || typeof d.key !== "string" || !d.key) {
        return c.json({ detail: "each name or title needs kind and key (what the corpus looks for)" }, 422);
      }
    }
    return c.json(await (await storeFor(c)).saveCharacter(doc));
  });
  r.delete("/research/characters/:id", async (c) => {
    boundaryFor(c)?.refuse("delete a character");
    if (!(await (await storeFor(c)).deleteCharacter(c.req.param("id")))) return notFound(c, "character");
    return c.json({ deleted: c.req.param("id") });
  });
  r.get("/research/mentions", async (c) =>
    c.json(await (await storeFor(c)).listMentions({
      verse: c.req.query("verse") ?? undefined, chapter: num(c.req.query("chapter")),
      character: c.req.query("character") ?? undefined, status: c.req.query("status") ?? undefined,
      kind: c.req.query("kind") ?? undefined, source: c.req.query("source") ?? undefined,
    })));
  r.put("/research/mentions", async (c) => {
    const s = await storeFor(c);
    const body = (await c.req.json().catch(() => ({}))) as { mentions?: any[] };
    const bad = places(body.mentions, 6000);
    if (bad) return c.json({ detail: bad.replace("place", "mention") }, 422);
    const seen = new Set<string>();
    for (const m of body.mentions!) {
      if (typeof m.characterId !== "string" || !m.characterId) return c.json({ detail: "each mention needs characterId" }, 422);
      if (m.kind !== undefined && !MENTION_KINDS.includes(m.kind)) return c.json({ detail: `kind must be one of ${MENTION_KINDS.join(", ")}` }, 422);
      if (m.words !== undefined && !(Number.isInteger(m.words) && m.words >= 1)) return c.json({ detail: "words must be a whole number from 1" }, 422);
      if (m.part !== undefined && !(Number.isInteger(m.part) && m.part >= 0 && m.part <= 20)) {
        return c.json({ detail: "part must be 0 (the word itself) or the number of one of its pronouns" }, 422);
      }
      seen.add(m.characterId);
    }
    for (const id of seen) {
      if (!(await s.characterExists(id))) return c.json({ detail: `character not found: ${id}` }, 404);
    }
    // an AI's mentions are always potential, and never touch one that is already filed
    return c.json({ saved: await s.addMentions(body.mentions!, boundaryFor(c) ? "ai" : "me") });
  });
  const ids = (list: unknown): string[] | null =>
    Array.isArray(list) && list.length > 0 && list.length <= 6000 && list.every((x) => typeof x === "string" && x) ? (list as string[]) : null;
  r.post("/research/mentions/status", async (c) => {
    // establishing a mention is the reader's decision
    boundaryFor(c)?.refuse("establish a mention or set it back");
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown; status?: string };
    const list = ids(body.ids);
    if (!list) return c.json({ detail: "send the ids of the mentions (1 to 6000)" }, 422);
    if (body.status !== "established" && body.status !== "potential") return c.json({ detail: "status must be established or potential" }, 422);
    return c.json({ changed: await (await storeFor(c)).setMentionStatus(list, body.status) });
  });
  r.post("/research/mentions/note", async (c) => {
    boundaryFor(c)?.refuse("change a mention's note");
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; note?: string };
    if (typeof body.id !== "string" || !body.id) return c.json({ detail: "send the mention's id" }, 422);
    return c.json({ changed: await (await storeFor(c)).setMentionNote(body.id, String(body.note ?? "")) });
  });
  r.post("/research/mentions/remove", async (c) => {
    boundaryFor(c)?.refuse("remove mentions");
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
    const list = ids(body.ids);
    if (!list) return c.json({ detail: "send the ids of the mentions (1 to 6000)" }, 422);
    return c.json({ removed: await (await storeFor(c)).removeMentions(list) });
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
    if (kind !== "note" && kind !== "indication" && kind !== "link" && kind !== "speech") {
      return c.json({ detail: "kind must be note, indication, link or speech" }, 422);
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
