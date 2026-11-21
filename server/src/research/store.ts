// Research store — the reader's own scholarship: cases (+ form_research), the earlier texts they
// replaced (revisions), trails,
// notes, root meanings, motifs, indications, comparisons, settings, and the outbox of what they
// have published.
//
// One store per request, over that request's connection, already bound to the signed-in user
// (schema.ts): row-level security shows and admits only their rows, and every insert takes their
// user_id by default — so no query here names a user, and none can reach another's. The tables
// are migrations/0010_research_rls.sql. Every visible ordering is total (ids as the last key).

import type { ResearchDb } from "./pg-research.js";

const now = () => Date.now();
type Doc = Record<string, any>;
type MotifRow = { id: string; name: string; note: string; source?: string; created_at: number; updated_at: number };

export class ResearchStore {
  /**
   * `userId` is the signed-in account: what the reader's records are stamped with as their
   * author (author_id), so a record carries who wrote it wherever it's shown.
   */
  constructor(private db: ResearchDb, readonly userId: string) {}

  // -- cases --
  async listCases(): Promise<Doc[]> {
    return (await this.db.query<{ doc: string }>("SELECT doc FROM cases ORDER BY updated_at DESC, id"))
      .map((r) => JSON.parse(r.doc));
  }
  async getCase(id: string): Promise<Doc | undefined> {
    const row = await this.db.one<{ doc: string }>("SELECT doc FROM cases WHERE id = ?", [id]);
    return row ? JSON.parse(row.doc) : undefined;
  }
  async saveCase(doc: Doc): Promise<Doc> {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    // verdictAt = when the verdict last changed; it is the server's, whatever the client sent
    const prev = await this.getCase(doc.id);
    const before = String(prev?.verdict ?? "").trim();
    if (!prev) doc.verdictAt = t;
    else if (before === String(doc.verdict ?? "").trim()) doc.verdictAt = prev.verdictAt ?? prev.createdAt ?? t;
    else {
      if (before && this.stood(prev.verdictAt, t)) await this.keepRevision("verdict", doc.id, before, t);
      doc.verdictAt = t;
    }
    const subject = doc.subject ?? {};
    await this.db.run(
      `INSERT INTO cases (id, subject_type, subject_value, title, status, verdict, spark_verse_key, doc, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET subject_type=excluded.subject_type, subject_value=excluded.subject_value,
         title=excluded.title, status=excluded.status, verdict=excluded.verdict,
         spark_verse_key=excluded.spark_verse_key, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, subject.type ?? "root", subject.value ?? "", doc.title ?? "", doc.status ?? "open",
       doc.verdict ?? "", subject.sparkVerseKey ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    await this.reconcileFormResearch(doc);
    return doc;
  }
  async deleteCase(id: string): Promise<boolean> {
    // its form research goes with it (ON DELETE CASCADE), and so do the earlier texts kept for it
    const gone = (await this.db.run("DELETE FROM cases WHERE id = ?", [id])).changes > 0;
    if (gone) {
      await this.db.run(
        "DELETE FROM revisions WHERE (kind = 'verdict' AND target = ?) OR (kind = 'form' AND strpos(target, ?) = 1)",
        [id, `${id}|`]);
    }
    return gone;
  }

  /** Keep form_research in step with the case document — the case board is the source. */
  private async reconcileFormResearch(doc: Doc): Promise<void> {
    const caseId = doc.id;
    const root = (doc.subject ?? {}).value ?? "";
    const forms: Record<string, any> = doc.formResearch ?? {};
    const t = now();
    const old = new Map<string, { status: string; meaning: string }>();
    for (const r of await this.db.query<{ lemma: string; status: string; meaning: string }>(
      "SELECT lemma, status, meaning FROM form_research WHERE case_id = ?", [caseId],
    )) old.set(r.lemma, { status: r.status, meaning: r.meaning });

    for (const [lemma, fr] of Object.entries(forms)) {
      const status = fr.status ?? "open";
      const meaning = fr.meaning ?? "";
      const prev = old.get(lemma);
      old.delete(lemma);
      if (prev && prev.status === "established" && prev.meaning && prev.meaning !== meaning) {
        await this.keepRevision("form", `${caseId}|${lemma}`, prev.meaning, t);
      }
      await this.db.run(
        `INSERT INTO form_research (case_id, root, lemma, status, meaning, established_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT (user_id, case_id, lemma) DO UPDATE SET root=excluded.root, status=excluded.status,
           meaning=excluded.meaning, established_at=excluded.established_at, updated_at=excluded.updated_at`,
        [caseId, root, lemma, status, meaning, fr.establishedAt ?? null, t],
      );
    }
    for (const lemma of old.keys()) {
      await this.db.run("DELETE FROM form_research WHERE case_id = ? AND lemma = ?", [caseId, lemma]);
    }
  }

  async formStatus(): Promise<Doc[]> {
    return this.db.query(
      `SELECT fr.lemma, fr.root, fr.status, fr.meaning, fr.case_id, c.status AS case_status
       FROM form_research fr JOIN cases c ON c.id = fr.case_id
       ORDER BY fr.case_id, fr.lemma`,
    );
  }
  // -- revisions: an earlier text the reader replaced, with its date and (if they say) why --
  /** How long a text must have stood for its replacement to be worth keeping. The app saves as
   *  the reader types, so without this every keystroke would be an "earlier version". */
  static readonly STOOD_MS = 10 * 60 * 1000;
  /** Had a text last changed at `since` stood long enough by `t`? Unknown age counts as yes. */
  private stood(since: unknown, t: number): boolean {
    const at = Number(since);
    return !Number.isFinite(at) || at <= 0 || t - at >= ResearchStore.STOOD_MS;
  }
  /** Keep `before` as an earlier version of a target, unless one was kept for it moments ago:
   *  that one already holds the text that stood, and what follows is the same edit continuing. */
  private async keepRevision(kind: string, target: string, before: string, t: number): Promise<void> {
    const last = await this.db.scalar<number>(
      "SELECT MAX(replaced_at) FROM revisions WHERE kind = ? AND target = ?", [kind, target]);
    if (last !== null && last !== undefined && t - Number(last) < ResearchStore.STOOD_MS) return;
    await this.db.run("INSERT INTO revisions (kind, target, before, replaced_at) VALUES (?,?,?,?)", [kind, target, before, t]);
  }
  private static revisionRow(r: any): Doc {
    return { id: String(r.id), kind: r.kind, target: r.target, before: r.before ?? "", reason: r.reason ?? "", replacedAt: Number(r.replaced_at) };
  }
  /** The earlier versions of one thing, newest first. */
  async listRevisions(kind: string, target: string): Promise<Doc[]> {
    return (await this.db.query(
      "SELECT * FROM revisions WHERE kind = ? AND target = ? ORDER BY replaced_at DESC, id DESC", [kind, target],
    )).map(ResearchStore.revisionRow);
  }
  async setRevisionReason(id: string, reason: string): Promise<Doc | undefined> {
    if (!/^\d+$/.test(id)) return undefined;
    await this.db.run("UPDATE revisions SET reason = ? WHERE id = ?", [reason, Number(id)]);
    const r = await this.db.one("SELECT * FROM revisions WHERE id = ?", [Number(id)]);
    return r ? ResearchStore.revisionRow(r) : undefined;
  }
  async deleteRevision(id: string): Promise<boolean> {
    if (!/^\d+$/.test(id)) return false;
    return (await this.db.run("DELETE FROM revisions WHERE id = ?", [Number(id)])).changes > 0;
  }

  // -- trails --
  async listTrails(): Promise<Doc[]> {
    return (await this.db.query<{ doc: string }>("SELECT doc FROM trails ORDER BY updated_at DESC, id"))
      .map((r) => JSON.parse(r.doc));
  }
  async saveTrail(doc: Doc): Promise<Doc> {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    await this.db.run(
      `INSERT INTO trails (id, name, subject, doc, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET name=excluded.name, subject=excluded.subject, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, doc.name ?? "", doc.subject ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return doc;
  }
  async deleteTrail(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM trails WHERE id = ?", [id])).changes > 0;
  }

  // -- notes --
  private static noteRow(r: any): Doc {
    return {
      id: r.id, verseKey: r.verse_key, wordPosition: r.word_position, kind: r.kind,
      text: r.text, answer: r.answer ?? "", resolved: !!r.resolved,
      lemma: r.lemma ?? null, root: r.root ?? null, source: r.source ?? "me",
      authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  async getNote(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM notes WHERE id = ?", [id]);
    return r ? ResearchStore.noteRow(r) : undefined;
  }
  async listNotes(opts: { verse?: string; root?: string; lemma?: string } = {}): Promise<Doc[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.verse) { clauses.push("verse_key = ?"); params.push(opts.verse); }
    if (opts.root) { clauses.push("root = ?"); params.push(opts.root); }
    if (opts.lemma) { clauses.push("lemma = ?"); params.push(opts.lemma); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (await this.db.query(`SELECT * FROM notes ${where} ORDER BY created_at, id`, params)).map(ResearchStore.noteRow);
  }
  async saveNote(doc: Doc): Promise<Doc> {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    await this.db.run(
      `INSERT INTO notes (id, verse_key, word_position, kind, text, answer, resolved, lemma, root, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET verse_key=excluded.verse_key, word_position=excluded.word_position,
         kind=excluded.kind, text=excluded.text, answer=excluded.answer, resolved=excluded.resolved,
         lemma=excluded.lemma, root=excluded.root, updated_at=excluded.updated_at`,
      [doc.id, doc.verseKey, doc.wordPosition ?? null, doc.kind ?? "note", doc.text ?? "",
       doc.answer ?? "", doc.resolved ? 1 : 0, doc.lemma ?? null, doc.root ?? null,
       doc.source === "ai" ? "ai" : "me", doc.createdAt, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return doc;
  }
  async deleteNote(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM notes WHERE id = ?", [id])).changes > 0;
  }

  // -- user root meanings --
  async getRootMeaning(root: string): Promise<Doc> {
    const row = await this.db.one<{ root: string; meaning: string; updated_at: number }>(
      "SELECT root, meaning, updated_at FROM user_root_meanings WHERE root = ?", [root],
    );
    return { root, meaning: row?.meaning ?? "", updatedAt: row?.updated_at ?? 0 };
  }
  async listRootMeanings(): Promise<Doc[]> {
    return (await this.db.query<{ root: string; meaning: string; updated_at: number }>(
      "SELECT root, meaning, updated_at FROM user_root_meanings ORDER BY updated_at DESC, root",
    )).map((r) => ({ root: r.root, meaning: r.meaning, updatedAt: r.updated_at }));
  }
  async setRootMeaning(root: string, meaning: string): Promise<Doc> {
    const t = now();
    const text = (meaning ?? "").trim();
    const prev = await this.db.one<{ meaning: string; updated_at: number }>(
      "SELECT meaning, updated_at FROM user_root_meanings WHERE root = ?", [root]);
    if (prev?.meaning && prev.meaning !== text && this.stood(prev.updated_at, t)) {
      await this.keepRevision("root-meaning", root, prev.meaning, t);
    }
    if (!text) {
      await this.db.run("DELETE FROM user_root_meanings WHERE root = ?", [root]);
      return { root, meaning: "", updatedAt: t };
    }
    await this.db.run(
      `INSERT INTO user_root_meanings (root, meaning, updated_at, author_id, origin) VALUES (?,?,?,?,?)
       ON CONFLICT (user_id, root) DO UPDATE SET meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [root, text, t, this.userId, "local"],
    );
    return { root, meaning: text, updatedAt: t };
  }
  async deleteRootMeaning(root: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM user_root_meanings WHERE root = ?", [root])).changes > 0;
  }

  // -- motifs (بيوت) --
  private async motifRoots(id: string): Promise<string[]> {
    return (await this.db.query<{ root: string }>(
      "SELECT root FROM motif_roots WHERE motif_id = ? ORDER BY added_at, root", [id],
    )).map((r) => r.root);
  }
  private static motifRow(m: MotifRow, roots: string[]): Doc {
    return {
      id: m.id, name: m.name, note: m.note, source: m.source ?? "me",
      roots, createdAt: m.created_at, updatedAt: m.updated_at,
    };
  }
  private async withRoots(rows: MotifRow[]): Promise<Doc[]> {
    const out: Doc[] = [];
    for (const m of rows) out.push(ResearchStore.motifRow(m, await this.motifRoots(m.id)));
    return out;
  }
  async listMotifs(): Promise<Doc[]> {
    return this.withRoots(await this.db.query<MotifRow>("SELECT * FROM motifs ORDER BY updated_at DESC, id"));
  }
  async getMotif(id: string): Promise<Doc | undefined> {
    const m = await this.db.one<MotifRow>("SELECT * FROM motifs WHERE id = ?", [id]);
    return m ? ResearchStore.motifRow(m, await this.motifRoots(m.id)) : undefined;
  }
  async motifsForRoot(root: string): Promise<Doc[]> {
    return this.withRoots(await this.db.query<MotifRow>(
      `SELECT m.* FROM motifs m JOIN motif_roots mr ON mr.motif_id = m.id
       WHERE mr.root = ? ORDER BY m.name, m.id`,
      [root],
    ));
  }
  async saveMotif(doc: Doc): Promise<Doc> {
    const t = now();
    const id = doc.id;
    const existing = await this.getMotif(id);
    await this.db.run(
      `INSERT INTO motifs (id, name, note, source, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET name=excluded.name, note=excluded.note, updated_at=excluded.updated_at`,
      [id, doc.name ?? "", doc.note ?? "", doc.source === "ai" ? "ai" : existing?.source ?? "me",
       doc.createdAt ?? t, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return {
      id, name: doc.name ?? "", note: doc.note ?? "",
      source: existing?.source ?? (doc.source === "ai" ? "ai" : "me"),
      roots: await this.motifRoots(id), updatedAt: t,
    };
  }
  async deleteMotif(id: string): Promise<boolean> {
    await this.db.run("DELETE FROM motif_roots WHERE motif_id = ?", [id]);
    return (await this.db.run("DELETE FROM motifs WHERE id = ?", [id])).changes > 0;
  }
  async addMotifRoot(id: string, root: string): Promise<void> {
    await this.db.run(
      "INSERT INTO motif_roots (motif_id, root, added_at) VALUES (?,?,?) ON CONFLICT DO NOTHING",
      [id, root, now()],
    );
    await this.db.run("UPDATE motifs SET updated_at = ? WHERE id = ?", [now(), id]);
  }
  async removeMotifRoot(id: string, root: string): Promise<void> {
    await this.db.run("DELETE FROM motif_roots WHERE motif_id = ? AND root = ?", [id, root]);
    await this.db.run("UPDATE motifs SET updated_at = ? WHERE id = ?", [now(), id]);
  }

  // -- comparisons (named, saveable boards of pinned āyāt & roots) --
  private static setRow(r: any): Doc {
    return { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, count: Number(r.count ?? 0) };
  }
  private static itemRow(r: any): Doc {
    return { id: r.id, setId: r.set_id, kind: r.kind, ref: r.ref, label: r.label ?? null, createdAt: r.created_at };
  }
  private async touchCompareSet(id: string): Promise<void> {
    await this.db.run("UPDATE compare_sets SET updated_at = ? WHERE id = ?", [now(), id]);
  }

  /** All saved comparisons, most-recently-touched first, with member counts. */
  async listCompareSets(): Promise<Doc[]> {
    return (await this.db.query(
      `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
       FROM compare_sets s LEFT JOIN compare_items c ON c.set_id = s.id
       GROUP BY s.id, s.title, s.created_at, s.updated_at ORDER BY s.updated_at DESC, s.id`,
    )).map(ResearchStore.setRow);
  }
  async getCompareSet(id: string): Promise<Doc | undefined> {
    const r = await this.db.one(
      `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
       FROM compare_sets s LEFT JOIN compare_items c ON c.set_id = s.id WHERE s.id = ?
       GROUP BY s.id, s.title, s.created_at, s.updated_at`,
      [id],
    );
    return r ? ResearchStore.setRow(r) : undefined;
  }
  async saveCompareSet(doc: Doc): Promise<Doc> {
    const t = now();
    await this.db.run(
      `INSERT INTO compare_sets (id, title, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      [doc.id, doc.title ?? "", doc.createdAt ?? t, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return (await this.getCompareSet(doc.id))!;
  }
  async deleteCompareSet(id: string): Promise<boolean> {
    await this.db.run("DELETE FROM compare_items WHERE set_id = ?", [id]);
    return (await this.db.run("DELETE FROM compare_sets WHERE id = ?", [id])).changes > 0;
  }
  async listCompareItems(setId: string): Promise<Doc[]> {
    return (await this.db.query("SELECT * FROM compare_items WHERE set_id = ? ORDER BY created_at, id", [setId]))
      .map(ResearchStore.itemRow);
  }
  async addCompareItem(setId: string, doc: Doc): Promise<Doc> {
    await this.db.run(
      `INSERT INTO compare_items (id, set_id, kind, ref, label, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, set_id, kind, ref) DO NOTHING`,
      [doc.id, setId, doc.kind, doc.ref, doc.label ?? null, doc.createdAt ?? now()],
    );
    await this.touchCompareSet(setId);
    // return the row that now holds this (set,kind,ref) — its own id or the pre-existing one
    const r = await this.db.one("SELECT * FROM compare_items WHERE set_id = ? AND kind = ? AND ref = ?", [setId, doc.kind, doc.ref]);
    return ResearchStore.itemRow(r);
  }
  async removeCompareItem(setId: string, itemId: string): Promise<boolean> {
    const changed = (await this.db.run("DELETE FROM compare_items WHERE id = ? AND set_id = ?", [itemId, setId])).changes > 0;
    if (changed) await this.touchCompareSet(setId);
    return changed;
  }
  async clearCompareItems(setId: string): Promise<void> {
    await this.db.run("DELETE FROM compare_items WHERE set_id = ?", [setId]);
    await this.touchCompareSet(setId);
  }

  // -- links: a saved link between two places in the Book; with one end only it is a lead --
  private static linkRow(r: any): Doc {
    return {
      id: r.id,
      a: { verseKey: r.a_verse, word: Number(r.a_word), words: Number(r.a_words) },
      b: r.b_verse ? { verseKey: r.b_verse, word: Number(r.b_word ?? 1), words: Number(r.b_words ?? 1) } : null,
      kind: r.kind ?? "",
      marker: r.marker_key ? { kind: r.marker_kind ?? "", key: r.marker_key, text: r.marker_text ?? r.marker_key } : null,
      label: r.label ?? "", note: r.note ?? "",
      status: r.b_verse ? (r.status === "lead" ? "lead" : "kept") : "lead",
      resolved: !!r.resolved, resolution: r.resolution ?? "",
      source: r.source ?? "me", authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
  async getLink(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM links WHERE id = ?", [id]);
    return r ? ResearchStore.linkRow(r) : undefined;
  }
  /** `verse` matches either end; `chapter` any link with an end in that sūrah. */
  async listLinks(opts: { verse?: string; chapter?: number; status?: string; kind?: string; label?: string;
    markerKind?: string; markerKey?: string } = {}): Promise<Doc[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.verse) { clauses.push("(a_verse = ? OR b_verse = ?)"); params.push(opts.verse, opts.verse); }
    if (opts.chapter) {
      const like = `${Math.trunc(opts.chapter)}:%`;
      clauses.push("(a_verse LIKE ? OR b_verse LIKE ?)"); params.push(like, like);
    }
    if (opts.status === "lead") clauses.push("(b_verse IS NULL OR status = 'lead')");
    if (opts.status === "kept") clauses.push("(b_verse IS NOT NULL AND status <> 'lead')");
    if (opts.kind !== undefined) { clauses.push("kind = ?"); params.push(opts.kind); }
    if (opts.label !== undefined) { clauses.push("label = ?"); params.push(opts.label); }
    if (opts.markerKey) { clauses.push("marker_key = ?"); params.push(opts.markerKey); }
    if (opts.markerKind) { clauses.push("marker_kind = ?"); params.push(opts.markerKind); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (await this.db.query(`SELECT * FROM links ${where} ORDER BY created_at, id`, params)).map(ResearchStore.linkRow);
  }
  async saveLink(doc: Doc): Promise<Doc> {
    const t = now();
    const a = doc.a ?? {};
    const b = doc.b ?? null;
    const marker = doc.marker ?? null;
    const createdAt = doc.createdAt ?? t;
    await this.db.run(
      `INSERT INTO links (id, a_verse, a_word, a_words, b_verse, b_word, b_words, kind, marker_kind, marker_key, marker_text,
                          label, note, status, resolved, resolution, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET a_verse=excluded.a_verse, a_word=excluded.a_word, a_words=excluded.a_words,
         b_verse=excluded.b_verse, b_word=excluded.b_word, b_words=excluded.b_words, kind=excluded.kind,
         marker_kind=excluded.marker_kind, marker_key=excluded.marker_key, marker_text=excluded.marker_text,
         label=excluded.label, note=excluded.note, status=excluded.status, resolved=excluded.resolved,
         resolution=excluded.resolution, updated_at=excluded.updated_at`,
      [doc.id, a.verseKey, a.word ?? 1, a.words ?? 1,
       b?.verseKey ?? null, b ? (b.word ?? 1) : null, b ? (b.words ?? 1) : null,
       doc.kind ?? "", marker?.kind ?? null, marker?.key ?? null, marker?.text ?? null,
       doc.label ?? "", doc.note ?? "", b && doc.status !== "lead" ? "kept" : "lead",
       // only a tension is ever "settled"
       doc.kind === "tension" && !!doc.resolved, doc.kind === "tension" ? String(doc.resolution ?? "") : "",
       doc.source === "ai" ? "ai" : "me", createdAt, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return (await this.getLink(doc.id))!;
  }
  async deleteLink(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM links WHERE id = ?", [id])).changes > 0;
  }
  /** The labels in use, each with how many links carry it (the reader's image and theme groups). */
  async linkLabels(): Promise<{ label: string; count: number }[]> {
    return (await this.db.query<{ label: string; n: number }>(
      "SELECT label, COUNT(*) AS n FROM links WHERE label <> '' GROUP BY label ORDER BY label"))
      .map((r) => ({ label: r.label, count: Number(r.n) }));
  }
  /** Which āyāt the reader has linked, per sūrah: every āyah that is an end of a kept link, and
   *  every āyah that only has a lead. The app sets these against each sūrah's length. */
  async linkCoverage(): Promise<{ chapter: number; linked: string[]; leads: string[] }[]> {
    const rows = await this.db.query<{ a_verse: string; b_verse: string | null; status: string }>(
      "SELECT a_verse, b_verse, status FROM links ORDER BY created_at, id");
    const linked = new Set<string>();
    const leads = new Set<string>();
    for (const r of rows) {
      if (r.b_verse && r.status !== "lead") { linked.add(r.a_verse); linked.add(r.b_verse); }
      else { leads.add(r.a_verse); if (r.b_verse) leads.add(r.b_verse); }
    }
    const chapterOf = (k: string) => parseInt(k.split(":")[0] ?? "", 10) || 0;
    const verseOf = (k: string) => parseInt(k.split(":")[1] ?? "", 10) || 0;
    const per = new Map<number, { linked: string[]; leads: string[] }>();
    const slot = (ch: number) => {
      let s = per.get(ch);
      if (!s) { s = { linked: [], leads: [] }; per.set(ch, s); }
      return s;
    };
    for (const k of linked) slot(chapterOf(k)).linked.push(k);
    for (const k of leads) if (!linked.has(k)) slot(chapterOf(k)).leads.push(k);
    const sort = (list: string[]) => list.sort((x, y) => verseOf(x) - verseOf(y));
    return [...per.entries()].sort((x, y) => x[0] - y[0])
      .map(([chapter, s]) => ({ chapter, linked: sort(s.linked), leads: sort(s.leads) }));
  }

  // -- speech: who speaks in a span of an āyah, and to whom, as the reader tags it --
  private static speechRow(r: any): Doc {
    return {
      id: r.id, verseKey: r.verse_key, word: Number(r.word), words: r.words == null ? null : Number(r.words),
      speaker: r.speaker ?? "", addressee: r.addressee ?? "", listeners: r.listeners ?? "",
      basis: r.basis === "stated" || r.basis === "inferred" ? r.basis : "", note: r.note ?? "",
      source: r.source ?? "me", authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
  async getSpeech(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM speech WHERE id = ?", [id]);
    return r ? ResearchStore.speechRow(r) : undefined;
  }
  async listSpeech(opts: { verse?: string; chapter?: number; speaker?: string; addressee?: string } = {}): Promise<Doc[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.verse) { clauses.push("verse_key = ?"); params.push(opts.verse); }
    if (opts.chapter) { clauses.push("verse_key LIKE ?"); params.push(`${Math.trunc(opts.chapter)}:%`); }
    if (opts.speaker !== undefined) { clauses.push("speaker = ?"); params.push(opts.speaker); }
    if (opts.addressee !== undefined) { clauses.push("addressee = ?"); params.push(opts.addressee); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (await this.db.query(`SELECT * FROM speech ${where} ORDER BY created_at, id`, params)).map(ResearchStore.speechRow);
  }
  async saveSpeech(doc: Doc): Promise<Doc> {
    const t = now();
    await this.db.run(
      `INSERT INTO speech (id, verse_key, word, words, speaker, addressee, listeners, basis, note, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET verse_key=excluded.verse_key, word=excluded.word, words=excluded.words,
         speaker=excluded.speaker, addressee=excluded.addressee, listeners=excluded.listeners, basis=excluded.basis,
         note=excluded.note, updated_at=excluded.updated_at`,
      [doc.id, doc.verseKey, doc.word ?? 1, doc.words ?? null, (doc.speaker ?? "").trim(), (doc.addressee ?? "").trim(),
       String(doc.listeners ?? "").trim(), doc.basis === "stated" || doc.basis === "inferred" ? doc.basis : "",
       doc.note ?? "", doc.source === "ai" ? "ai" : "me", doc.createdAt ?? t, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return (await this.getSpeech(doc.id))!;
  }
  async deleteSpeech(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM speech WHERE id = ?", [id])).changes > 0;
  }
  /** The names the reader has used, with how many spans each speaks and is addressed in. */
  /** Speech openers the reader set aside as "no speech here", in Book order. */
  async listSpeechSkips(chapter?: number): Promise<{ verseKey: string; word: number }[]> {
    const where = chapter ? "WHERE verse_key LIKE ?" : "";
    return (await this.db.query<{ verse_key: string; word: number }>(
      `SELECT verse_key, word FROM speech_skips ${where}
       ORDER BY split_part(verse_key, ':', 1)::int, split_part(verse_key, ':', 2)::int, word`,
      chapter ? [`${Math.trunc(chapter)}:%`] : [],
    )).map((r) => ({ verseKey: r.verse_key, word: Number(r.word) }));
  }
  async addSpeechSkip(verseKey: string, word: number): Promise<void> {
    await this.db.run(
      "INSERT INTO speech_skips (verse_key, word, created_at) VALUES (?,?,?) ON CONFLICT (user_id, verse_key, word) DO NOTHING",
      [verseKey, word, now()]);
  }
  async removeSpeechSkip(verseKey: string, word: number): Promise<boolean> {
    return (await this.db.run("DELETE FROM speech_skips WHERE verse_key = ? AND word = ?", [verseKey, word])).changes > 0;
  }

  async speakers(): Promise<{ name: string; speaks: number; addressed: number }[]> {
    const out = new Map<string, { name: string; speaks: number; addressed: number }>();
    const slot = (name: string) => {
      let s = out.get(name);
      if (!s) { s = { name, speaks: 0, addressed: 0 }; out.set(name, s); }
      return s;
    };
    for (const r of await this.db.query<{ speaker: string; n: number }>(
      "SELECT speaker, COUNT(*) AS n FROM speech WHERE speaker <> '' GROUP BY speaker ORDER BY speaker")) slot(r.speaker).speaks = Number(r.n);
    for (const r of await this.db.query<{ addressee: string; n: number }>(
      "SELECT addressee, COUNT(*) AS n FROM speech WHERE addressee <> '' GROUP BY addressee ORDER BY addressee")) slot(r.addressee).addressed = Number(r.n);
    return [...out.values()].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  }

  // -- rule checks: a rule the reader states, and a mark on each place it covers --
  private static ruleRow(r: any): Doc {
    let query: unknown;
    if (r.scope_query) { try { query = JSON.parse(r.scope_query); } catch { query = undefined; } }
    return {
      id: r.id, title: r.title ?? "", statement: r.statement ?? "", falsifier: r.falsifier ?? "",
      scope: { kind: r.scope_kind, key: r.scope_key, text: r.scope_text ?? "", ...(query ? { query } : {}) },
      source: r.source ?? "me", authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
  private static markRow(r: any): Doc {
    return { verseKey: r.verse_key, word: Number(r.word), mark: r.mark, note: r.note ?? "",
      source: r.source === "ai" ? "ai" : "me", updatedAt: Number(r.updated_at) };
  }
  /** Per rule: the reader's own marks by value, and how many AI suggestions wait. */
  private async ruleCounts(ruleId?: string): Promise<Map<string, { fits: number; exception: number; unsure: number; suggested: number }>> {
    const rows = await this.db.query<{ rule_id: string; mark: string; source: string; n: number }>(
      `SELECT rule_id, mark, source, COUNT(*) AS n FROM rule_marks ${ruleId ? "WHERE rule_id = ?" : ""} GROUP BY rule_id, mark, source`,
      ruleId ? [ruleId] : []);
    const out = new Map<string, { fits: number; exception: number; unsure: number; suggested: number }>();
    for (const r of rows) {
      let c = out.get(r.rule_id);
      if (!c) { c = { fits: 0, exception: 0, unsure: 0, suggested: 0 }; out.set(r.rule_id, c); }
      if (r.source === "ai") c.suggested += Number(r.n);
      else if (r.mark === "fits" || r.mark === "exception" || r.mark === "unsure") c[r.mark] += Number(r.n);
    }
    return out;
  }
  async listRules(): Promise<Doc[]> {
    const counts = await this.ruleCounts();
    return (await this.db.query("SELECT * FROM rules ORDER BY created_at, id"))
      .map((r: any) => ({ ...ResearchStore.ruleRow(r), counts: counts.get(r.id) ?? { fits: 0, exception: 0, unsure: 0, suggested: 0 } }));
  }
  /** One rule with every mark on it, in Book order. */
  async getRule(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM rules WHERE id = ?", [id]);
    if (!r) return undefined;
    const marks = (await this.db.query(
      `SELECT * FROM rule_marks WHERE rule_id = ?
       ORDER BY split_part(verse_key, ':', 1)::int, split_part(verse_key, ':', 2)::int, word`, [id])).map(ResearchStore.markRow);
    const counts = (await this.ruleCounts(id)).get(id) ?? { fits: 0, exception: 0, unsure: 0, suggested: 0 };
    return { ...ResearchStore.ruleRow(r), counts, marks };
  }
  async saveRule(doc: Doc): Promise<Doc> {
    const t = now();
    const scope = doc.scope ?? {};
    await this.db.run(
      `INSERT INTO rules (id, title, statement, falsifier, scope_kind, scope_key, scope_text, scope_query,
                          source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET title=excluded.title, statement=excluded.statement, falsifier=excluded.falsifier,
         scope_kind=excluded.scope_kind, scope_key=excluded.scope_key, scope_text=excluded.scope_text,
         scope_query=excluded.scope_query, updated_at=excluded.updated_at`,
      [doc.id, String(doc.title ?? "").trim(), String(doc.statement ?? ""), String(doc.falsifier ?? ""),
       scope.kind, scope.key, String(scope.text ?? scope.key ?? ""), scope.query ? JSON.stringify(scope.query) : null,
       doc.source === "ai" ? "ai" : "me", doc.createdAt ?? t, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return (await this.getRule(doc.id))!;
  }
  /** The rule and its marks. */
  async deleteRule(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM rules WHERE id = ?", [id])).changes > 0;
  }
  /**
   * Mark places. The reader's mark replaces whatever was there and is theirs. An AI's is a
   * suggestion: it lands only where there is no mark yet or an earlier suggestion, never over
   * the reader's own. Returns how many were written.
   */
  async saveRuleMarks(ruleId: string, marks: { verseKey: string; word: number; mark: string; note?: string }[],
    source: "me" | "ai"): Promise<number> {
    const t = now();
    let saved = 0;
    for (let i = 0; i < marks.length; i += 200) {
      const chunk = marks.slice(i, i + 200);
      const params: unknown[] = [];
      for (const m of chunk) params.push(ruleId, m.verseKey, m.word, m.mark, String(m.note ?? ""), source, t);
      saved += (await this.db.run(
        `INSERT INTO rule_marks (rule_id, verse_key, word, mark, note, source, updated_at)
         VALUES ${chunk.map(() => "(?,?,?,?,?,?,?)").join(",")}
         ON CONFLICT (user_id, rule_id, verse_key, word) DO UPDATE
           SET mark = excluded.mark, note = excluded.note, source = excluded.source, updated_at = excluded.updated_at
           ${source === "ai" ? "WHERE rule_marks.source = 'ai'" : ""}`, params)).changes;
    }
    return saved;
  }
  async removeRuleMarks(ruleId: string, places: { verseKey: string; word: number }[]): Promise<number> {
    let removed = 0;
    for (const p of places) {
      removed += (await this.db.run("DELETE FROM rule_marks WHERE rule_id = ? AND verse_key = ? AND word = ?",
        [ruleId, p.verseKey, p.word])).changes;
    }
    return removed;
  }
  /** AI suggestions become the reader's own marks; no places = every suggestion on the rule. */
  async acceptRuleMarks(ruleId: string, places?: { verseKey: string; word: number }[]): Promise<number> {
    const t = now();
    if (!places) {
      return (await this.db.run("UPDATE rule_marks SET source = 'me', updated_at = ? WHERE rule_id = ? AND source = 'ai'", [t, ruleId])).changes;
    }
    let accepted = 0;
    for (const p of places) {
      accepted += (await this.db.run(
        "UPDATE rule_marks SET source = 'me', updated_at = ? WHERE rule_id = ? AND verse_key = ? AND word = ? AND source = 'ai'",
        [t, ruleId, p.verseKey, p.word])).changes;
    }
    return accepted;
  }

  // -- characters: someone the reader names, and the places that point to them --
  private static characterRow(r: any): Doc {
    let designations: unknown = [];
    try { designations = JSON.parse(r.designations ?? "[]"); } catch { designations = []; }
    return {
      id: r.id, name: r.name ?? "", note: r.note ?? "", designations: Array.isArray(designations) ? designations : [],
      source: r.source ?? "me", authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
  private static mentionRow(r: any): Doc {
    return {
      id: r.id, characterId: r.character_id, verseKey: r.verse_key, word: Number(r.word), words: Number(r.words ?? 1),
      part: Number(r.part ?? 0),
      kind: r.kind ?? "name", designation: r.designation ?? "",
      status: r.status === "established" ? "established" : "potential", note: r.note ?? "",
      source: r.source === "ai" ? "ai" : "me", createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
  /** part 0 = the word itself; 1, 2 … = that pronoun of the word, as the corpus numbers them */
  static mentionId = (characterId: string, verseKey: string, word: number, part = 0) => `${characterId}|${verseKey}|${word}|${part}`;
  private static readonly BOOK_ORDER = "split_part(verse_key, ':', 1)::int, split_part(verse_key, ':', 2)::int, word, id";
  private static readonly MENTION_ORDER = "split_part(verse_key, ':', 1)::int, split_part(verse_key, ':', 2)::int, word, part, id";
  async listCharacters(): Promise<Doc[]> {
    const counts = new Map<string, { established: number; potential: number }>();
    for (const r of await this.db.query<{ character_id: string; status: string; n: number }>(
      "SELECT character_id, status, COUNT(*) AS n FROM mentions GROUP BY character_id, status")) {
      let c = counts.get(r.character_id);
      if (!c) { c = { established: 0, potential: 0 }; counts.set(r.character_id, c); }
      if (r.status === "established") c.established += Number(r.n); else c.potential += Number(r.n);
    }
    return (await this.db.query("SELECT * FROM characters ORDER BY name, id"))
      .map((r: any) => ({ ...ResearchStore.characterRow(r), counts: counts.get(r.id) ?? { established: 0, potential: 0 } }));
  }
  /** One character with every mention of it, in Book order. */
  async getCharacter(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM characters WHERE id = ?", [id]);
    if (!r) return undefined;
    const mentions = await this.listMentions({ character: id });
    return {
      ...ResearchStore.characterRow(r), mentions,
      counts: {
        established: mentions.filter((m) => m.status === "established").length,
        potential: mentions.filter((m) => m.status !== "established").length,
      },
    };
  }
  async characterExists(id: string): Promise<boolean> {
    return !!(await this.db.one("SELECT id FROM characters WHERE id = ?", [id]));
  }
  async saveCharacter(doc: Doc): Promise<Doc> {
    const t = now();
    await this.db.run(
      `INSERT INTO characters (id, name, note, designations, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET name=excluded.name, note=excluded.note,
         designations=excluded.designations, updated_at=excluded.updated_at`,
      [doc.id, String(doc.name ?? "").trim(), String(doc.note ?? ""), JSON.stringify(Array.isArray(doc.designations) ? doc.designations : []),
       doc.source === "ai" ? "ai" : "me", doc.createdAt ?? t, t, doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return (await this.getCharacter(doc.id))!;
  }
  /** The character and every mention of it. */
  async deleteCharacter(id: string): Promise<boolean> {
    return (await this.db.run("DELETE FROM characters WHERE id = ?", [id])).changes > 0;
  }
  async listMentions(opts: { verse?: string; chapter?: number; character?: string; status?: string; kind?: string;
    source?: string } = {}): Promise<Doc[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.verse) { clauses.push("verse_key = ?"); params.push(opts.verse); }
    if (opts.chapter) { clauses.push("verse_key LIKE ?"); params.push(`${Math.trunc(opts.chapter)}:%`); }
    if (opts.character) { clauses.push("character_id = ?"); params.push(opts.character); }
    if (opts.status === "established") clauses.push("status = 'established'");
    if (opts.status === "potential") clauses.push("status <> 'established'");
    if (opts.kind) { clauses.push("kind = ?"); params.push(opts.kind); }
    // 'ai' = what an assistant filed and the reader has not decided on yet
    if (opts.source === "ai") clauses.push("source = 'ai'");
    if (opts.source === "me") clauses.push("source <> 'ai'");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (await this.db.query(`SELECT * FROM mentions ${where} ORDER BY ${ResearchStore.MENTION_ORDER}`, params)).map(ResearchStore.mentionRow);
  }
  /**
   * File places under characters. A new place is added (potential unless the reader says
   * established). One already filed keeps what it has; the reader asking for "established"
   * raises it. An AI's are always potential and never touch a mention that is already there.
   * Returns how many rows were written.
   */
  async addMentions(drafts: { characterId: string; verseKey: string; word: number; words?: number; part?: number; kind?: string;
    designation?: string; status?: string; note?: string }[], source: "me" | "ai"): Promise<number> {
    const t = now();
    let saved = 0;
    for (let i = 0; i < drafts.length; i += 150) {
      const chunk = drafts.slice(i, i + 150);
      const params: unknown[] = [];
      for (const m of chunk) {
        const part = m.part ?? 0;
        params.push(ResearchStore.mentionId(m.characterId, m.verseKey, m.word, part), m.characterId, m.verseKey, m.word, m.words ?? 1, part,
          m.kind ?? "name", String(m.designation ?? ""), source === "me" && m.status === "established" ? "established" : "potential",
          String(m.note ?? ""), source, t, t);
      }
      saved += (await this.db.run(
        `INSERT INTO mentions (id, character_id, verse_key, word, words, part, kind, designation, status, note, source, created_at, updated_at)
         VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}
         ON CONFLICT (user_id, character_id, verse_key, word, part) DO ${source === "ai" ? "NOTHING" : `UPDATE
           SET status = 'established', source = 'me', updated_at = excluded.updated_at
           WHERE excluded.status = 'established' AND mentions.status <> 'established'`}`, params)).changes;
    }
    return saved;
  }
  private async eachIdChunk(ids: string[], fn: (marks: string, chunk: string[]) => Promise<number>): Promise<number> {
    let n = 0;
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      n += await fn(chunk.map(() => "?").join(","), chunk);
    }
    return n;
  }
  /** The reader's decision on mentions; whatever they decide on becomes their own record. */
  async setMentionStatus(ids: string[], status: "potential" | "established"): Promise<number> {
    const t = now();
    return this.eachIdChunk(ids, async (marks, chunk) =>
      (await this.db.run(`UPDATE mentions SET status = ?, source = 'me', updated_at = ? WHERE id IN (${marks})`, [status, t, ...chunk])).changes);
  }
  async setMentionNote(id: string, note: string): Promise<number> {
    return (await this.db.run("UPDATE mentions SET note = ?, updated_at = ? WHERE id = ?", [note, now(), id])).changes;
  }
  async removeMentions(ids: string[]): Promise<number> {
    return this.eachIdChunk(ids, async (marks, chunk) =>
      (await this.db.run(`DELETE FROM mentions WHERE id IN (${marks})`, chunk)).changes);
  }

  // -- provenance: what an AI proposed through the MCP server ------------------
  /** Everything tagged source='ai', for the reader to review. */
  async listProposed(): Promise<Doc> {
    return {
      notes: (await this.db.query("SELECT * FROM notes WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.noteRow),
      indications: (await this.db.query("SELECT * FROM word_indications WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.indicationRow),
      links: (await this.db.query("SELECT * FROM links WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.linkRow),
      speech: (await this.db.query("SELECT * FROM speech WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.speechRow),
    };
  }
  /** Accept a proposal: it becomes the reader's own record. */
  async acceptProposed(kind: "note" | "indication" | "link" | "speech", id: string): Promise<boolean> {
    const table = { note: "notes", indication: "word_indications", link: "links", speech: "speech" }[kind];
    return (await this.db.run(`UPDATE ${table} SET source = 'me' WHERE id = ? AND source = 'ai'`, [id])).changes > 0;
  }

  // -- word indications: meanings anchored at the ROOT (one primary per root), each
  //    carrying per-FORM refinements. A word's gloss = its form's refinement of
  //    the root's primary indication, else that indication's text. Words with no root keep
  //    standalone lemma indications. --
  private static indicationRow(r: any): Doc {
    return {
      id: r.id, root: r.root ?? null, lemma: r.lemma ?? null,
      scope: r.scope ?? "lemma", parentId: r.parent_id ?? null,
      label: r.label ?? "", meaning: r.meaning ?? "",
      primary: !!r.is_primary, source: r.source ?? "me",
      authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  async getIndication(id: string): Promise<Doc | undefined> {
    const r = await this.db.one("SELECT * FROM word_indications WHERE id = ?", [id]);
    return r ? ResearchStore.indicationRow(r) : undefined;
  }
  /** The indications of a root, primary first. */
  async rootIndications(root: string): Promise<Doc[]> {
    return (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='root' AND root=? ORDER BY is_primary DESC, created_at, id", [root],
    )).map(ResearchStore.indicationRow);
  }
  /** Standalone lemma indications (words with no root). */
  async lemmaIndications(lemma: string): Promise<Doc[]> {
    return (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=? ORDER BY is_primary DESC, created_at, id",
      [lemma],
    )).map(ResearchStore.indicationRow);
  }
  /** A root indication's refinement for one form (lemma), if written. */
  async refinementFor(parentId: string, lemma: string): Promise<Doc | null> {
    const r = await this.db.one(
      "SELECT * FROM word_indications WHERE parent_id=? AND lemma=? ORDER BY created_at, id LIMIT 1", [parentId, lemma]);
    return r ? ResearchStore.indicationRow(r) : null;
  }
  async refinementsForParent(parentId: string): Promise<Doc[]> {
    return (await this.db.query(
      "SELECT * FROM word_indications WHERE parent_id=? ORDER BY created_at, id", [parentId],
    )).map(ResearchStore.indicationRow);
  }

  /** Everything the word menu needs: the word's root indications (each with THIS
   *  form's refinement) and, for rootless words, standalone lemma indications.
   *
   *  `surface` is the word AS WRITTEN (form_arabic). Refinements are now keyed by surface form
   *  so a plural (أَصْلَٰب) can differ from its singular (صُّلْب) — but we fall back to the lemma
   *  key so refinements written before the switch keep matching. */
  async indicationsForWord(lemma: string | null, root: string | null, surface?: string | null): Promise<Doc> {
    const refine = async (id: string) =>
      (surface ? await this.refinementFor(id, surface) : null) ??
      (lemma ? await this.refinementFor(id, lemma) : null);
    const rootIndications: Doc[] = [];
    if (root) {
      for (const s of await this.rootIndications(root)) {
        rootIndications.push({
          ...s,
          refinement: await refine(s.id),
          refinedCount: (await this.refinementsForParent(s.id)).length, // how many forms are done
        });
      }
    }
    const lemmaIndications = (!root && lemma) ? await this.lemmaIndications(lemma) : [];
    return {
      root, lemma, rootIndications, lemmaIndications,
      // The community's readings are not served from here: the app reads them live from
      // GET /community/readings (gated) and merges them in.
      communityRoot: [],
      communityLemma: [],
    };
  }

  private async clearRootPrimary(root: string, exceptId?: string): Promise<void> {
    await this.db.run(
      `UPDATE word_indications SET is_primary=0 WHERE scope='root' AND root=?${exceptId ? " AND id!=?" : ""}`,
      exceptId ? [root, exceptId] : [root]);
  }
  private async clearLemmaPrimary(lemma: string, exceptId?: string): Promise<void> {
    await this.db.run(
      `UPDATE word_indications SET is_primary=0 WHERE scope='lemma' AND parent_id IS NULL AND lemma=?${exceptId ? " AND id!=?" : ""}`,
      exceptId ? [lemma, exceptId] : [lemma]);
  }

  /** Create/update a root indication (root set) OR a standalone lemma indication (rootless). */
  async saveIndication(doc: Doc): Promise<Doc> {
    const t = now();
    const existing = await this.getIndication(doc.id);
    const root = doc.root ?? existing?.root ?? null;
    const lemma = doc.lemma ?? existing?.lemma ?? null;
    const scope = doc.scope ?? existing?.scope ?? (root ? "root" : "lemma");
    const had = Number(scope === "root"
      ? await this.db.scalar("SELECT COUNT(*) FROM word_indications WHERE scope='root' AND root=?", [root]) ?? 0
      : await this.db.scalar("SELECT COUNT(*) FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=?", [lemma]) ?? 0);
    const primary = doc.primary ?? existing?.primary ?? had === 0;
    await this.keepIndicationRevision(existing, doc.meaning ?? "", t);
    await this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?)
       ON CONFLICT (user_id, id) DO UPDATE SET root=excluded.root, lemma=excluded.lemma, scope=excluded.scope,
         label=excluded.label, meaning=excluded.meaning, is_primary=excluded.is_primary, updated_at=excluded.updated_at`,
      [doc.id, root, lemma, scope, doc.label ?? "", doc.meaning ?? "", primary ? 1 : 0,
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    if (primary) {
      if (scope === "root" && root) await this.clearRootPrimary(root, doc.id);
      else if (lemma) await this.clearLemmaPrimary(lemma, doc.id);
    }
    return (await this.getIndication(doc.id))!;
  }

  /** Create/update a per-form refinement of a root indication (upsert by parent+lemma). */
  async saveRefinement(doc: Doc): Promise<Doc | undefined> {
    const parent = await this.getIndication(doc.parentId);
    if (!parent || parent.scope !== "root") return undefined;
    const t = now();
    const existing = await this.refinementFor(doc.parentId, doc.lemma);
    const id = existing?.id ?? doc.id;
    await this.keepIndicationRevision(existing, doc.meaning ?? "", t);
    await this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?, 'lemma', ?, ?, ?, 0, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET label=excluded.label, meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [id, parent.root, doc.lemma, doc.parentId, doc.label ?? "", doc.meaning ?? "",
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.userId, doc.origin ?? "local"],
    );
    return this.getIndication(id);
  }

  /** The reader's own indication, about to be given another text: keep the one that stood. */
  private async keepIndicationRevision(existing: Doc | null | undefined, meaning: string, t: number): Promise<void> {
    if (!existing || existing.source === "ai") return;
    const before = String(existing.meaning ?? "").trim();
    if (before && before !== String(meaning).trim() && this.stood(existing.updatedAt, t)) {
      await this.keepRevision("indication", existing.id, before, t);
    }
  }

  async deleteIndication(id: string): Promise<boolean> {
    const s = await this.getIndication(id);
    if (!s) return false;
    await this.db.run(
      "DELETE FROM revisions WHERE kind = 'indication' AND target IN (SELECT id FROM word_indications WHERE id = ? OR parent_id = ?)",
      [id, id]);
    // deleting a root indication removes its refinements too
    await this.db.run("DELETE FROM word_indications WHERE id=? OR parent_id=?", [id, id]);
    if (s.primary && s.scope === "root" && s.root) {
      const next = await this.db.one<{ id: string }>(
        "SELECT id FROM word_indications WHERE scope='root' AND root=? ORDER BY created_at, id LIMIT 1", [s.root]);
      if (next) await this.db.run("UPDATE word_indications SET is_primary=1 WHERE id=?", [next.id]);
    } else if (s.primary && s.scope === "lemma" && !s.parentId && s.lemma) {
      const next = await this.db.one<{ id: string }>(
        "SELECT id FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=? ORDER BY created_at, id LIMIT 1", [s.lemma]);
      if (next) await this.db.run("UPDATE word_indications SET is_primary=1 WHERE id=?", [next.id]);
    }
    return true;
  }

  /** Make a root indication (or a standalone lemma indication) the primary in its group. */
  async setPrimaryIndication(id: string): Promise<Doc | undefined> {
    const s = await this.getIndication(id);
    if (!s) return undefined;
    if (s.scope === "root" && s.root) await this.clearRootPrimary(s.root);
    else if (s.scope === "lemma" && !s.parentId && s.lemma) await this.clearLemmaPrimary(s.lemma);
    else return s; // refinements have no primary
    await this.db.run("UPDATE word_indications SET is_primary=1, updated_at=? WHERE id=?", [now(), id]);
    return this.getIndication(id);
  }

  /** Reader gloss data: for each root with a PRIMARY indication, its base text and
   *  per-form refinement texts; plus rootless lemma primaries. */
  async glossData(): Promise<Doc> {
    const primaries = (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='root' AND is_primary=1 ORDER BY root, id",
    )).map(ResearchStore.indicationRow);
    const roots = primaries
      .map((p) => ({ root: p.root, text: p.label || p.meaning }))
      .filter((x) => x.text);
    const refinements: Doc[] = [];
    for (const p of primaries) {
      for (const r of await this.refinementsForParent(p.id)) {
        const text = r.label || r.meaning;
        if (text) refinements.push({ root: p.root, lemma: r.lemma, text });
      }
    }
    const lemmas = (await this.db.query(
      "SELECT * FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND is_primary=1 ORDER BY lemma, id",
    ))
      .map(ResearchStore.indicationRow)
      .map((s) => ({ lemma: s.lemma, text: s.label || s.meaning }))
      .filter((x) => x.text);
    return { roots, refinements, lemmas };
  }

  // ---- outbound submission ledger (what I've offered upstream) ------------------
  private static submissionRow(r: {
    local_ref: string; submission_id: string; content_hash: string; kind: string; status: string; submitted_at: number;
  }): Doc {
    return {
      localRef: r.local_ref, submissionId: r.submission_id, contentHash: r.content_hash,
      kind: r.kind, status: r.status, submittedAt: r.submitted_at,
    };
  }

  /** What was submitted for this record, if anything. */
  async getSubmissionFor(localRef: string): Promise<Doc | undefined> {
    const r = await this.db.one<any>("SELECT * FROM derived_submissions WHERE local_ref = ?", [localRef]);
    return r ? ResearchStore.submissionRow(r) : undefined;
  }

  async listSubmissionLog(): Promise<Doc[]> {
    return (await this.db.query<any>("SELECT * FROM derived_submissions ORDER BY submitted_at DESC, local_ref"))
      .map(ResearchStore.submissionRow);
  }

  /** Record (or replace) what was submitted for a record. */
  async recordSubmission(doc: Doc): Promise<Doc> {
    const t = now();
    await this.db.run(
      `INSERT INTO derived_submissions (local_ref, submission_id, content_hash, kind, status, submitted_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, local_ref) DO UPDATE SET submission_id=excluded.submission_id,
         content_hash=excluded.content_hash, kind=excluded.kind,
         status=excluded.status, submitted_at=excluded.submitted_at`,
      [doc.localRef, doc.submissionId, doc.contentHash, doc.kind ?? "", doc.status ?? "submitted", t],
    );
    return (await this.getSubmissionFor(doc.localRef))!;
  }

  /** Has this reader proposed a reading of this subject, and does it still match? */
  async getProposal(subjectKind: string, subjectValue: string): Promise<Doc | undefined> {
    const r = await this.db.one<{ content_hash: string; proposed_at: number }>(
      "SELECT content_hash, proposed_at FROM derived_proposed_claims WHERE subject_kind = ? AND subject_value = ?",
      [subjectKind, subjectValue]);
    return r ? { contentHash: r.content_hash, proposedAt: r.proposed_at } : undefined;
  }

  /** Record that a reading was proposed upstream (drop-safe outbox, mirrors recordSubmission). */
  async recordProposal(doc: Doc): Promise<Doc> {
    await this.db.run(
      `INSERT INTO derived_proposed_claims (subject_kind, subject_value, content_hash, proposed_at)
       VALUES (?,?,?,?)
       ON CONFLICT (user_id, subject_kind, subject_value)
         DO UPDATE SET content_hash=excluded.content_hash, proposed_at=excluded.proposed_at`,
      [doc.subjectKind, doc.subjectValue, doc.contentHash, now()],
    );
    return (await this.getProposal(doc.subjectKind, doc.subjectValue))!;
  }

  // ---- settings: device-independent key -> JSON value --------------------------
  async getSetting(key: string): Promise<unknown> {
    const row = await this.db.one<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch { return undefined; }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value ?? null), now()],
    );
  }
}
