// Research store — the reader's own scholarship in research.db (read-write).
// Port of quran_api/research.py: cases (+ form_research/revisions), trails, notes.

import type { Db } from "./db.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY, subject_type TEXT NOT NULL, subject_value TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
    verdict TEXT NOT NULL DEFAULT '', spark_verse_key TEXT,
    doc TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_subject ON cases(subject_type, subject_value);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

CREATE TABLE IF NOT EXISTS form_research (
    case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    root TEXT NOT NULL, lemma TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    meaning TEXT NOT NULL DEFAULT '', established_at INTEGER, updated_at INTEGER NOT NULL,
    PRIMARY KEY (case_id, lemma)
);
CREATE INDEX IF NOT EXISTS idx_form_lemma ON form_research(lemma);
CREATE INDEX IF NOT EXISTS idx_form_root ON form_research(root);

CREATE TABLE IF NOT EXISTS form_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, lemma TEXT NOT NULL,
    meaning TEXT NOT NULL, replaced_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rev_lemma ON form_revisions(case_id, lemma);

CREATE TABLE IF NOT EXISTS trails (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', subject TEXT,
    doc TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, verse_key TEXT NOT NULL, word_position INTEGER,
    kind TEXT NOT NULL DEFAULT 'note', text TEXT NOT NULL DEFAULT '',
    answer TEXT NOT NULL DEFAULT '', resolved INTEGER NOT NULL DEFAULT 0,
    lemma TEXT, root TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_verse ON notes(verse_key);

-- the reader's own meaning for a root, saved alongside the dictionary lexicons
CREATE TABLE IF NOT EXISTS user_root_meanings (
    root TEXT PRIMARY KEY, meaning TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);

-- motifs (بيوت): reader-defined collections that group roots by a linguistic motif
CREATE TABLE IF NOT EXISTS motifs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS motif_roots (
    motif_id TEXT NOT NULL, root TEXT NOT NULL, added_at INTEGER NOT NULL,
    PRIMARY KEY (motif_id, root)
);
CREATE INDEX IF NOT EXISTS idx_motif_roots_root ON motif_roots(root);

-- indications: the reader's own meanings for a word, anchored at the ROOT
-- (scope='root', parent_id NULL, one primary per root). Each root indication has
-- per-FORM refinements (scope='lemma', parent_id = the root indication, one per
-- lemma). Words with no root keep standalone lemman indications.
CREATE TABLE IF NOT EXISTS word_indications (
    id TEXT PRIMARY KEY, lemma TEXT, root TEXT,
    scope TEXT NOT NULL DEFAULT 'lemma',   -- 'root' | 'lemma'
    parent_id TEXT,                        -- refinement -> its root indication; else NULL
    label TEXT NOT NULL DEFAULT '', meaning TEXT NOT NULL DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_word_indications_lemma ON word_indications(lemma);
CREATE INDEX IF NOT EXISTS idx_word_indications_root ON word_indications(root);
CREATE INDEX IF NOT EXISTS idx_word_indications_parent ON word_indications(parent_id);

-- comparisons (بيوت-style saveable boards of pinned āyāt & roots studied side by side)
CREATE TABLE IF NOT EXISTS compare_sets (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS compare_items (
    id TEXT PRIMARY KEY, set_id TEXT NOT NULL,
    kind TEXT NOT NULL, ref TEXT NOT NULL, label TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (set_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_compare_items_set ON compare_items(set_id);
`;

const NOTE_MIGRATIONS: [string, string][] = [
  ["answer", "TEXT NOT NULL DEFAULT ''"],
  ["lemma", "TEXT"],
  ["root", "TEXT"],
];

const now = () => Date.now();
type Doc = Record<string, any>;

export class ResearchStore {
  constructor(private db: Db) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(SCHEMA);
    const have = new Set(db.query<{ name: string }>("PRAGMA table_info(notes)").map((r) => r.name));
    for (const [col, decl] of NOTE_MIGRATIONS) {
      if (!have.has(col)) db.exec(`ALTER TABLE notes ADD COLUMN ${col} ${decl}`);
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_notes_lemma ON notes(lemma)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_notes_root ON notes(root)");
    // "senses" were renamed to "indications". The old tables are dropped rather
    // than migrated: the feature was still being shaped and its data was scratch.
    db.exec("DROP TABLE IF EXISTS word_senses");
    db.exec("DROP TABLE IF EXISTS sense_assignments");
  }

  // -- cases --
  listCases(): Doc[] {
    return this.db.query<{ doc: string }>("SELECT doc FROM cases ORDER BY updated_at DESC").map((r) => JSON.parse(r.doc));
  }
  getCase(id: string): Doc | undefined {
    const row = this.db.one<{ doc: string }>("SELECT doc FROM cases WHERE id = ?", [id]);
    return row ? JSON.parse(row.doc) : undefined;
  }
  saveCase(doc: Doc): Doc {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    const subject = doc.subject ?? {};
    this.db.run(
      `INSERT INTO cases (id, subject_type, subject_value, title, status, verdict, spark_verse_key, doc, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET subject_type=excluded.subject_type, subject_value=excluded.subject_value,
         title=excluded.title, status=excluded.status, verdict=excluded.verdict,
         spark_verse_key=excluded.spark_verse_key, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, subject.type ?? "root", subject.value ?? "", doc.title ?? "", doc.status ?? "open",
       doc.verdict ?? "", subject.sparkVerseKey ?? null, JSON.stringify(doc), doc.createdAt, t],
    );
    this.syncFormResearch(doc);
    return doc;
  }
  deleteCase(id: string): boolean {
    const cur = this.db.run("DELETE FROM cases WHERE id = ?", [id]);
    this.db.run("DELETE FROM form_research WHERE case_id = ?", [id]);
    return Number(cur.changes) > 0;
  }

  private syncFormResearch(doc: Doc): void {
    const caseId = doc.id;
    const root = (doc.subject ?? {}).value ?? "";
    const forms: Record<string, any> = doc.formResearch ?? {};
    const t = now();
    const old = new Map<string, { status: string; meaning: string }>();
    for (const r of this.db.query<{ lemma: string; status: string; meaning: string }>(
      "SELECT lemma, status, meaning FROM form_research WHERE case_id = ?", [caseId],
    )) old.set(r.lemma, { status: r.status, meaning: r.meaning });

    for (const [lemma, fr] of Object.entries(forms)) {
      const status = fr.status ?? "open";
      const meaning = fr.meaning ?? "";
      const prev = old.get(lemma);
      old.delete(lemma);
      if (prev && prev.status === "established" && prev.meaning && prev.meaning !== meaning) {
        this.db.run("INSERT INTO form_revisions (case_id, lemma, meaning, replaced_at) VALUES (?,?,?,?)",
          [caseId, lemma, prev.meaning, t]);
      }
      this.db.run(
        `INSERT INTO form_research (case_id, root, lemma, status, meaning, established_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(case_id, lemma) DO UPDATE SET root=excluded.root, status=excluded.status,
           meaning=excluded.meaning, established_at=excluded.established_at, updated_at=excluded.updated_at`,
        [caseId, root, lemma, status, meaning, fr.establishedAt ?? null, t],
      );
    }
    for (const lemma of old.keys()) {
      this.db.run("DELETE FROM form_research WHERE case_id = ? AND lemma = ?", [caseId, lemma]);
    }
  }

  formStatus(): Doc[] {
    return this.db.query(
      `SELECT fr.lemma, fr.root, fr.status, fr.meaning, fr.case_id, c.status AS case_status
       FROM form_research fr JOIN cases c ON c.id = fr.case_id`,
    );
  }
  revisions(caseId: string, lemma: string): Doc[] {
    return this.db.query(
      "SELECT meaning, replaced_at FROM form_revisions WHERE case_id = ? AND lemma = ? ORDER BY replaced_at DESC",
      [caseId, lemma],
    );
  }

  // -- trails --
  listTrails(): Doc[] {
    return this.db.query<{ doc: string }>("SELECT doc FROM trails ORDER BY updated_at DESC").map((r) => JSON.parse(r.doc));
  }
  saveTrail(doc: Doc): Doc {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    this.db.run(
      `INSERT INTO trails (id, name, subject, doc, created_at, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, subject=excluded.subject, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, doc.name ?? "", doc.subject ?? null, JSON.stringify(doc), doc.createdAt, t],
    );
    return doc;
  }
  deleteTrail(id: string): boolean {
    return Number(this.db.run("DELETE FROM trails WHERE id = ?", [id]).changes) > 0;
  }

  // -- notes --
  private static noteRow(r: any): Doc {
    return {
      id: r.id, verseKey: r.verse_key, wordPosition: r.word_position, kind: r.kind,
      text: r.text, answer: r.answer ?? "", resolved: !!r.resolved,
      lemma: r.lemma ?? null, root: r.root ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  listNotes(opts: { verse?: string; root?: string; lemma?: string } = {}): Doc[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.verse) { clauses.push("verse_key = ?"); params.push(opts.verse); }
    if (opts.root) { clauses.push("root = ?"); params.push(opts.root); }
    if (opts.lemma) { clauses.push("lemma = ?"); params.push(opts.lemma); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.query(`SELECT * FROM notes ${where} ORDER BY created_at`, params).map(ResearchStore.noteRow);
  }
  saveNote(doc: Doc): Doc {
    const t = now();
    doc = { ...doc, updatedAt: t };
    doc.createdAt ??= t;
    this.db.run(
      `INSERT INTO notes (id, verse_key, word_position, kind, text, answer, resolved, lemma, root, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET verse_key=excluded.verse_key, word_position=excluded.word_position,
         kind=excluded.kind, text=excluded.text, answer=excluded.answer, resolved=excluded.resolved,
         lemma=excluded.lemma, root=excluded.root, updated_at=excluded.updated_at`,
      [doc.id, doc.verseKey, doc.wordPosition ?? null, doc.kind ?? "note", doc.text ?? "",
       doc.answer ?? "", doc.resolved ? 1 : 0, doc.lemma ?? null, doc.root ?? null, doc.createdAt, t],
    );
    return doc;
  }
  deleteNote(id: string): boolean {
    return Number(this.db.run("DELETE FROM notes WHERE id = ?", [id]).changes) > 0;
  }

  // -- user root meanings --
  getRootMeaning(root: string): Doc {
    const row = this.db.one<{ root: string; meaning: string; updated_at: number }>(
      "SELECT root, meaning, updated_at FROM user_root_meanings WHERE root = ?", [root],
    );
    return { root, meaning: row?.meaning ?? "", updatedAt: row?.updated_at ?? 0 };
  }
  listRootMeanings(): Doc[] {
    return this.db
      .query<{ root: string; meaning: string; updated_at: number }>(
        "SELECT root, meaning, updated_at FROM user_root_meanings ORDER BY updated_at DESC",
      )
      .map((r) => ({ root: r.root, meaning: r.meaning, updatedAt: r.updated_at }));
  }
  setRootMeaning(root: string, meaning: string): Doc {
    const t = now();
    const text = (meaning ?? "").trim();
    if (!text) {
      this.db.run("DELETE FROM user_root_meanings WHERE root = ?", [root]);
      return { root, meaning: "", updatedAt: t };
    }
    this.db.run(
      `INSERT INTO user_root_meanings (root, meaning, updated_at) VALUES (?,?,?)
       ON CONFLICT(root) DO UPDATE SET meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [root, text, t],
    );
    return { root, meaning: text, updatedAt: t };
  }
  deleteRootMeaning(root: string): boolean {
    return Number(this.db.run("DELETE FROM user_root_meanings WHERE root = ?", [root]).changes) > 0;
  }

  // -- motifs (بيوت) --
  private motifRoots(id: string): string[] {
    return this.db
      .query<{ root: string }>("SELECT root FROM motif_roots WHERE motif_id = ? ORDER BY added_at", [id])
      .map((r) => r.root);
  }
  listMotifs(): Doc[] {
    return this.db
      .query<{ id: string; name: string; note: string; created_at: number; updated_at: number }>(
        "SELECT * FROM motifs ORDER BY updated_at DESC",
      )
      .map((m) => ({
        id: m.id, name: m.name, note: m.note,
        roots: this.motifRoots(m.id), createdAt: m.created_at, updatedAt: m.updated_at,
      }));
  }
  motifsForRoot(root: string): Doc[] {
    return this.db
      .query<{ id: string; name: string; note: string; created_at: number; updated_at: number }>(
        `SELECT m.* FROM motifs m JOIN motif_roots mr ON mr.motif_id = m.id
         WHERE mr.root = ? ORDER BY m.name`,
        [root],
      )
      .map((m) => ({ id: m.id, name: m.name, note: m.note, roots: this.motifRoots(m.id), createdAt: m.created_at, updatedAt: m.updated_at }));
  }
  saveMotif(doc: Doc): Doc {
    const t = now();
    const id = doc.id;
    this.db.run(
      `INSERT INTO motifs (id, name, note, created_at, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, note=excluded.note, updated_at=excluded.updated_at`,
      [id, doc.name ?? "", doc.note ?? "", doc.createdAt ?? t, t],
    );
    return { id, name: doc.name ?? "", note: doc.note ?? "", roots: this.motifRoots(id), updatedAt: t };
  }
  deleteMotif(id: string): boolean {
    this.db.run("DELETE FROM motif_roots WHERE motif_id = ?", [id]);
    return Number(this.db.run("DELETE FROM motifs WHERE id = ?", [id]).changes) > 0;
  }
  addMotifRoot(id: string, root: string): void {
    this.db.run(
      "INSERT INTO motif_roots (motif_id, root, added_at) VALUES (?,?,?) ON CONFLICT DO NOTHING",
      [id, root, now()],
    );
    this.db.run("UPDATE motifs SET updated_at = ? WHERE id = ?", [now(), id]);
  }
  removeMotifRoot(id: string, root: string): void {
    this.db.run("DELETE FROM motif_roots WHERE motif_id = ? AND root = ?", [id, root]);
    this.db.run("UPDATE motifs SET updated_at = ? WHERE id = ?", [now(), id]);
  }

  // -- comparisons (named, saveable boards of pinned āyāt & roots) --
  private static setRow(r: any): Doc {
    return { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, count: Number(r.count ?? 0) };
  }
  private static itemRow(r: any): Doc {
    return { id: r.id, setId: r.set_id, kind: r.kind, ref: r.ref, label: r.label ?? null, createdAt: r.created_at };
  }
  private touchCompareSet(id: string): void {
    this.db.run("UPDATE compare_sets SET updated_at = ? WHERE id = ?", [now(), id]);
  }

  /** All saved comparisons, most-recently-touched first, with member counts. */
  listCompareSets(): Doc[] {
    return this.db
      .query(
        `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
         FROM compare_sets s LEFT JOIN compare_items c ON c.set_id = s.id
         GROUP BY s.id ORDER BY s.updated_at DESC`,
      )
      .map(ResearchStore.setRow);
  }
  getCompareSet(id: string): Doc | undefined {
    const r = this.db.one(
      `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
       FROM compare_sets s LEFT JOIN compare_items c ON c.set_id = s.id WHERE s.id = ? GROUP BY s.id`,
      [id],
    );
    return r ? ResearchStore.setRow(r) : undefined;
  }
  saveCompareSet(doc: Doc): Doc {
    const t = now();
    this.db.run(
      `INSERT INTO compare_sets (id, title, created_at, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      [doc.id, doc.title ?? "", doc.createdAt ?? t, t],
    );
    return this.getCompareSet(doc.id)!;
  }
  deleteCompareSet(id: string): boolean {
    this.db.run("DELETE FROM compare_items WHERE set_id = ?", [id]);
    return Number(this.db.run("DELETE FROM compare_sets WHERE id = ?", [id]).changes) > 0;
  }
  listCompareItems(setId: string): Doc[] {
    return this.db
      .query("SELECT * FROM compare_items WHERE set_id = ? ORDER BY created_at", [setId])
      .map(ResearchStore.itemRow);
  }
  addCompareItem(setId: string, doc: Doc): Doc {
    this.db.run(
      `INSERT INTO compare_items (id, set_id, kind, ref, label, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(set_id, kind, ref) DO NOTHING`,
      [doc.id, setId, doc.kind, doc.ref, doc.label ?? null, doc.createdAt ?? now()],
    );
    this.touchCompareSet(setId);
    // return the row that now holds this (set,kind,ref) — its own id or the pre-existing one
    const r = this.db.one("SELECT * FROM compare_items WHERE set_id = ? AND kind = ? AND ref = ?", [setId, doc.kind, doc.ref]);
    return ResearchStore.itemRow(r);
  }
  removeCompareItem(setId: string, itemId: string): boolean {
    const changed = Number(this.db.run("DELETE FROM compare_items WHERE id = ? AND set_id = ?", [itemId, setId]).changes) > 0;
    if (changed) this.touchCompareSet(setId);
    return changed;
  }
  clearCompareItems(setId: string): void {
    this.db.run("DELETE FROM compare_items WHERE set_id = ?", [setId]);
    this.touchCompareSet(setId);
  }

  // -- word indications: meanings anchored at the ROOT (one primary per root), each
  //    carrying per-FORM refinements. A word's gloss = its form's refinement of
  //    the root's primary indication, else that indication's text. Words with no root keep
  //    standalone lemman indications. --
  private static indicationRow(r: any): Doc {
    return {
      id: r.id, root: r.root ?? null, lemma: r.lemma ?? null,
      scope: r.scope ?? "lemma", parentId: r.parent_id ?? null,
      label: r.label ?? "", meaning: r.meaning ?? "",
      primary: !!r.is_primary, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  getIndication(id: string): Doc | undefined {
    const r = this.db.one("SELECT * FROM word_indications WHERE id = ?", [id]);
    return r ? ResearchStore.indicationRow(r) : undefined;
  }
  /** The indications of a root, primary first. */
  rootIndications(root: string): Doc[] {
    return this.db
      .query("SELECT * FROM word_indications WHERE scope='root' AND root=? ORDER BY is_primary DESC, created_at", [root])
      .map(ResearchStore.indicationRow);
  }
  /** Standalone lemman indications (words with no root). */
  lemmaIndications(lemma: string): Doc[] {
    return this.db
      .query("SELECT * FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=? ORDER BY is_primary DESC, created_at", [lemma])
      .map(ResearchStore.indicationRow);
  }
  /** A root indication's refinement for one form (lemma), if written. */
  refinementFor(parentId: string, lemma: string): Doc | null {
    const r = this.db.one("SELECT * FROM word_indications WHERE parent_id=? AND lemma=? LIMIT 1", [parentId, lemma]);
    return r ? ResearchStore.indicationRow(r) : null;
  }
  refinementsForParent(parentId: string): Doc[] {
    return this.db.query("SELECT * FROM word_indications WHERE parent_id=? ORDER BY created_at", [parentId]).map(ResearchStore.indicationRow);
  }

  /** Everything the word menu needs: the word's root indications (each with THIS
   *  form's refinement) and, for rootless words, standalone lemman indications. */
  indicationsForWord(lemma: string | null, root: string | null): Doc {
    const rootIndications = root
      ? this.rootIndications(root).map((s) => ({
          ...s,
          refinement: lemma ? this.refinementFor(s.id, lemma) : null,
          refinedCount: this.refinementsForParent(s.id).length, // how many forms are done
        }))
      : [];
    const lemmaIndications = (!root && lemma) ? this.lemmaIndications(lemma) : [];
    return { root, lemma, rootIndications, lemmaIndications };
  }

  private clearRootPrimary(root: string, exceptId?: string): void {
    this.db.run(
      `UPDATE word_indications SET is_primary=0 WHERE scope='root' AND root=?${exceptId ? " AND id!=?" : ""}`,
      exceptId ? [root, exceptId] : [root]);
  }
  private clearLemmaPrimary(lemma: string, exceptId?: string): void {
    this.db.run(
      `UPDATE word_indications SET is_primary=0 WHERE scope='lemma' AND parent_id IS NULL AND lemma=?${exceptId ? " AND id!=?" : ""}`,
      exceptId ? [lemma, exceptId] : [lemma]);
  }

  /** Create/update a root indication (root set) OR a standalone lemman indication (rootless). */
  saveIndication(doc: Doc): Doc {
    const t = now();
    const existing = this.getIndication(doc.id);
    const root = doc.root ?? existing?.root ?? null;
    const lemma = doc.lemma ?? existing?.lemma ?? null;
    const scope = doc.scope ?? existing?.scope ?? (root ? "root" : "lemma");
    const had = scope === "root"
      ? this.db.scalar<number>("SELECT COUNT(*) FROM word_indications WHERE scope='root' AND root=?", [root]) ?? 0
      : this.db.scalar<number>("SELECT COUNT(*) FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=?", [lemma]) ?? 0;
    const primary = doc.primary ?? existing?.primary ?? had === 0;
    this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, created_at, updated_at)
       VALUES (?,?,?,?,NULL,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET root=excluded.root, lemma=excluded.lemma, scope=excluded.scope,
         label=excluded.label, meaning=excluded.meaning, is_primary=excluded.is_primary, updated_at=excluded.updated_at`,
      [doc.id, root, lemma, scope, doc.label ?? "", doc.meaning ?? "", primary ? 1 : 0, existing?.createdAt ?? t, t],
    );
    if (primary) { if (scope === "root" && root) this.clearRootPrimary(root, doc.id); else if (lemma) this.clearLemmaPrimary(lemma, doc.id); }
    return this.getIndication(doc.id)!;
  }

  /** Create/update a per-form refinement of a root indication (upsert by parent+lemma). */
  saveRefinement(doc: Doc): Doc | undefined {
    const parent = this.getIndication(doc.parentId);
    if (!parent || parent.scope !== "root") return undefined;
    const t = now();
    const existing = this.refinementFor(doc.parentId, doc.lemma);
    const id = existing?.id ?? doc.id;
    this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, created_at, updated_at)
       VALUES (?,?,?, 'lemma', ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [id, parent.root, doc.lemma, doc.parentId, doc.label ?? "", doc.meaning ?? "", existing?.createdAt ?? t, t],
    );
    return this.getIndication(id);
  }

  deleteIndication(id: string): boolean {
    const s = this.getIndication(id);
    if (!s) return false;
    // deleting a root indication removes its refinements too
    this.db.run("DELETE FROM word_indications WHERE id=? OR parent_id=?", [id, id]);
    if (s.primary && s.scope === "root" && s.root) {
      const next = this.db.one<{ id: string }>("SELECT id FROM word_indications WHERE scope='root' AND root=? ORDER BY created_at LIMIT 1", [s.root]);
      if (next) this.db.run("UPDATE word_indications SET is_primary=1 WHERE id=?", [next.id]);
    } else if (s.primary && s.scope === "lemma" && !s.parentId && s.lemma) {
      const next = this.db.one<{ id: string }>("SELECT id FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND lemma=? ORDER BY created_at LIMIT 1", [s.lemma]);
      if (next) this.db.run("UPDATE word_indications SET is_primary=1 WHERE id=?", [next.id]);
    }
    return true;
  }

  /** Make a root indication (or a standalone lemman indication) the primary in its group. */
  setPrimaryIndication(id: string): Doc | undefined {
    const s = this.getIndication(id);
    if (!s) return undefined;
    if (s.scope === "root" && s.root) this.clearRootPrimary(s.root);
    else if (s.scope === "lemma" && !s.parentId && s.lemma) this.clearLemmaPrimary(s.lemma);
    else return s; // refinements have no primary
    this.db.run("UPDATE word_indications SET is_primary=1, updated_at=? WHERE id=?", [now(), id]);
    return this.getIndication(id);
  }

  /** Reader gloss data: for each root with a PRIMARY indication, its base text and
   *  per-form refinement texts; plus rootless lemma primaries. */
  glossData(): Doc {
    const primaries = this.db.query("SELECT * FROM word_indications WHERE scope='root' AND is_primary=1").map(ResearchStore.indicationRow);
    const roots = primaries
      .map((p) => ({ root: p.root, text: p.label || p.meaning }))
      .filter((x) => x.text);
    const refinements: Doc[] = [];
    for (const p of primaries) {
      for (const r of this.refinementsForParent(p.id)) {
        const text = r.label || r.meaning;
        if (text) refinements.push({ root: p.root, lemma: r.lemma, text });
      }
    }
    const lemmas = this.db
      .query("SELECT * FROM word_indications WHERE scope='lemma' AND parent_id IS NULL AND is_primary=1")
      .map(ResearchStore.indicationRow)
      .map((s) => ({ lemma: s.lemma, text: s.label || s.meaning }))
      .filter((x) => x.text);
    return { roots, refinements, lemmas };
  }
}
