// Research store — the reader's own scholarship in research.db (read-write).
// Port of quran_api/research.py: cases (+ form_research/revisions), trails, notes.

import { randomUUID } from "node:crypto";
import { ownerIdFor, normalizeEmail } from "./identity.js";
import type { Db } from "./db.js";

// User-authored top-level records get an author + origin stamp (Phase 1). `author_id`
// is the account-independent local identity (see ensureLocalId); `origin` is 'local'
// for anything the reader (or their AI) makes here, vs 'remote' for pulled peer work.
// Child rows (form_research, motif_roots, compare_items) inherit authorship from their
// parent and are not stamped.
const STAMPED_TABLES = [
  "cases", "notes", "trails", "motifs", "user_root_meanings", "word_indications", "compare_sets",
];

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
    lemma TEXT, root TEXT, source TEXT NOT NULL DEFAULT 'me',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_verse ON notes(verse_key);
-- source indexes are created in the constructor, AFTER the migration adds the column

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

-- device-independent UI settings (reading prefs, active comparison): a small
-- key -> JSON value store, so they persist with the reader's data rather than in the
-- browser's per-origin IndexedDB (which reset when the desktop shell changed port).
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);

-- indications: the reader's own meanings for a word, anchored at the ROOT
-- (scope='root', parent_id NULL, one primary per root). Each root indication has
-- per-FORM refinements (scope='lemma', parent_id = the root indication, one per
-- lemma). Words with no root keep standalone lemma indications.
CREATE TABLE IF NOT EXISTS word_indications (
    id TEXT PRIMARY KEY, lemma TEXT, root TEXT,
    scope TEXT NOT NULL DEFAULT 'lemma',   -- 'root' | 'lemma'
    parent_id TEXT,                        -- refinement -> its root indication; else NULL
    label TEXT NOT NULL DEFAULT '', meaning TEXT NOT NULL DEFAULT '',
    is_primary INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'me',
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

-- Who this database belongs to. Kept INSIDE the file, so the file is self-describing: copy it
-- to another machine, rename it, or hand it to a colleague and it still knows whose research it
-- is. uuid is derived from the email (uuidv5), so the same person always gets the same id — it
-- is what a remote account binds to. Exactly one row.
CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    uuid TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Outbound submission ledger (SHARED_RESEARCH_SCHEMA.md section 2, derived_submissions): what
-- this reader has offered upstream, so the app can tell "already shared" from "changed since I
-- shared it" and chain a re-submission via supersedes instead of orphaning a duplicate.
-- Drop-safe: the underlying work lives in the reader's own tables, so losing this costs a
-- re-submit, not data. local_ref + content_hash are additions to the frozen shape — they map
-- a submission back to the local record it came from.
CREATE TABLE IF NOT EXISTS derived_submissions (
    local_ref TEXT PRIMARY KEY,          -- the local record's id (note/question/…)
    submission_id TEXT NOT NULL,         -- sub_… returned by the remote
    content_hash TEXT NOT NULL,          -- hash of the payload as submitted
    kind TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'submitted',
    submitted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_derived_submissions_sub ON derived_submissions(submission_id);

-- The group's established readings, pulled from the remote (SHARED_RESEARCH_SCHEMA.md section 2).
-- DERIVED: sync writes only these, they are drop-safe, and a full resync rebuilds them. Your own
-- established meanings live in form_research and are never touched by a pull — the two coexist,
-- and where they differ is exactly what the reader is shown.
CREATE TABLE IF NOT EXISTS derived_global_forms (
    subject_kind TEXT NOT NULL,          -- 'form' (lemma) | 'root'
    subject_value TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    meaning TEXT NOT NULL DEFAULT '',    -- pulled out of the payload for a fast gloss
    author_id TEXT NOT NULL,
    established_at INTEGER NOT NULL,
    payload TEXT NOT NULL,               -- the whole thing, unknown fields preserved verbatim
    schema_version INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (subject_kind, subject_value)
);

-- The ledger of disagreement against those readings. Carries its own payload, so it stands
-- alone even if what it objected to is later redacted.
CREATE TABLE IF NOT EXISTS derived_dissents (
    id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    claim_version INTEGER NOT NULL,
    author_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_derived_dissents_claim ON derived_dissents(claim_id, claim_version);

-- The community's indications: every reading anyone holds for a form or a root, whether or not
-- it won the global slot. These sit ALONGSIDE the reader's own word_indications rather than
-- against them — you keep as many readings as you find useful, and the group's are simply more
-- of them, marked as theirs. Being derived, they are read-only here and drop-safe: sync may
-- never write word_indications, so nothing pulled can ever masquerade as your own work.
CREATE TABLE IF NOT EXISTS derived_peer_indications (
    claim_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    author_id TEXT NOT NULL,
    subject_kind TEXT NOT NULL,          -- 'form' (lemma) | 'root'
    subject_value TEXT NOT NULL,
    status TEXT NOT NULL,                -- 'proposed' | 'established' | 'superseded'
    label TEXT NOT NULL DEFAULT '',
    meaning TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,               -- unknown fields preserved verbatim
    created_at INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    PRIMARY KEY (claim_id, version)
);
CREATE INDEX IF NOT EXISTS idx_derived_peer_ind_subject
    ON derived_peer_indications(subject_kind, subject_value);

-- How far each pull has got. Reset to 0 for a full resync — always safe.
CREATE TABLE IF NOT EXISTS derived_sync_state (
    stream TEXT PRIMARY KEY,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
`;

const NOTE_MIGRATIONS: [string, string][] = [
  ["answer", "TEXT NOT NULL DEFAULT ''"],
  ["lemma", "TEXT"],
  ["root", "TEXT"],
  // who wrote it: 'me' (the reader) or 'ai' (proposed via the MCP server)
  ["source", "TEXT NOT NULL DEFAULT 'me'"],
];

const now = () => Date.now();
type Doc = Record<string, any>;

export class ResearchStore {
  /** The identity every row this reader creates is stamped with (the owner's uuid once claimed). */
  localId: string;

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
    // provenance: records proposed by an AI through the MCP server are tagged,
    // so the reader can always tell them apart and review them
    // the owner record gained a name after it shipped with just an email
    const ownerCols = new Set(db.query<{ name: string }>("PRAGMA table_info(owner)").map((r) => r.name));
    if (ownerCols.size && !ownerCols.has("name")) {
      db.exec("ALTER TABLE owner ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    }
    const indCols = new Set(db.query<{ name: string }>("PRAGMA table_info(word_indications)").map((r) => r.name));
    if (indCols.size && !indCols.has("source")) {
      db.exec("ALTER TABLE word_indications ADD COLUMN source TEXT NOT NULL DEFAULT 'me'");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_word_indications_source ON word_indications(source)");

    // Phase 1 — local identity. Mint a stable local_id, add author_id/origin columns to the
    // user-authored tables, and backfill pre-existing rows so nothing is left un-attributed.
    this.localId = this.ensureLocalId();
    for (const table of STAMPED_TABLES) this.stampTable(table);
  }

  /**
   * The id this database's work is attributed to. Once an owner is set it is their derived
   * uuid — stable for that person on any machine. Before that (or in tests) a random one is
   * minted so nothing is ever un-attributed.
   */
  private ensureLocalId(): string {
    const owner = this.getOwner();
    if (owner) return owner.uuid as string;
    const cur = this.getSetting("local_id");
    if (typeof cur === "string" && cur) return cur;
    const id = randomUUID();
    this.setSetting("local_id", id);
    return id;
  }

  // ---- owner: whose research this file is ---------------------------------------
  /** Who this database belongs to, or undefined if nobody has claimed it yet. */
  getOwner(): Doc | undefined {
    try {
      const r = this.db.one<{ name: string; email: string; uuid: string; claimed_at: number; updated_at: number }>(
        "SELECT name, email, uuid, claimed_at, updated_at FROM owner WHERE id = 1");
      return r
        ? { name: r.name ?? "", email: r.email, uuid: r.uuid, claimedAt: r.claimed_at, updatedAt: r.updated_at }
        : undefined;
    } catch { return undefined; } // table not present on a very old file
  }

  /**
   * Claim this database for `email`, or re-assign it (you hold the file, so you may correct a
   * typo or hand it on). The uuid is re-derived, and local_id follows it so newly authored rows
   * carry the right author.
   */
  setOwner(email: string, name?: string): Doc {
    const clean = normalizeEmail(email);
    if (!clean.includes("@")) throw new Error("a valid email is required");
    const uuid = ownerIdFor(clean);
    const t = now();
    // keep the existing name when one isn't supplied (e.g. correcting only the email)
    const label = (name ?? (this.getOwner()?.name as string | undefined) ?? "").trim().slice(0, 120);
    this.db.run(
      `INSERT INTO owner (id, name, email, uuid, claimed_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email,
         uuid = excluded.uuid, updated_at = excluded.updated_at`,
      [label, clean, uuid, t, t],
    );
    this.setSetting("local_id", uuid);
    this.localId = uuid;
    return this.getOwner()!;
  }

  /** Add author_id + origin to `table` if missing, and stamp any rows that predate them. */
  private stampTable(table: string): void {
    const cols = new Set(this.db.query<{ name: string }>(`PRAGMA table_info(${table})`).map((r) => r.name));
    if (cols.size === 0) return; // table not present
    if (!cols.has("author_id")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN author_id TEXT`);
    if (!cols.has("origin")) this.db.exec(`ALTER TABLE ${table} ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'`);
    this.db.run(
      `UPDATE ${table} SET author_id = ? WHERE author_id IS NULL OR author_id = ''`,
      [this.localId],
    );
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
      `INSERT INTO cases (id, subject_type, subject_value, title, status, verdict, spark_verse_key, doc, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET subject_type=excluded.subject_type, subject_value=excluded.subject_value,
         title=excluded.title, status=excluded.status, verdict=excluded.verdict,
         spark_verse_key=excluded.spark_verse_key, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, subject.type ?? "root", subject.value ?? "", doc.title ?? "", doc.status ?? "open",
       doc.verdict ?? "", subject.sparkVerseKey ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
    );
    this.reconcileFormResearch(doc);
    return doc;
  }
  deleteCase(id: string): boolean {
    const cur = this.db.run("DELETE FROM cases WHERE id = ?", [id]);
    this.db.run("DELETE FROM form_research WHERE case_id = ?", [id]);
    return Number(cur.changes) > 0;
  }

  /**
   * Keep form_research in step with the case document. NOTHING to do with remote sync — the
   * case board is the source, and this is the reader's own act. (Named "sync…" once, which
   * tripped the write-boundary test; the boundary is about what a PULL may write.)
   */
  private reconcileFormResearch(doc: Doc): void {
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
      `INSERT INTO trails (id, name, subject, doc, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, subject=excluded.subject, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, doc.name ?? "", doc.subject ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
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
      lemma: r.lemma ?? null, root: r.root ?? null, source: r.source ?? "me",
      authorId: r.author_id ?? null, origin: r.origin ?? "local",
      createdAt: r.created_at, updatedAt: r.updated_at,
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
      `INSERT INTO notes (id, verse_key, word_position, kind, text, answer, resolved, lemma, root, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET verse_key=excluded.verse_key, word_position=excluded.word_position,
         kind=excluded.kind, text=excluded.text, answer=excluded.answer, resolved=excluded.resolved,
         lemma=excluded.lemma, root=excluded.root, updated_at=excluded.updated_at`,
      [doc.id, doc.verseKey, doc.wordPosition ?? null, doc.kind ?? "note", doc.text ?? "",
       doc.answer ?? "", doc.resolved ? 1 : 0, doc.lemma ?? null, doc.root ?? null,
       doc.source === "ai" ? "ai" : "me", doc.createdAt, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
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
      `INSERT INTO user_root_meanings (root, meaning, updated_at, author_id, origin) VALUES (?,?,?,?,?)
       ON CONFLICT(root) DO UPDATE SET meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [root, text, t, this.localId, "local"],
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
      `INSERT INTO motifs (id, name, note, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, note=excluded.note, updated_at=excluded.updated_at`,
      [id, doc.name ?? "", doc.note ?? "", doc.createdAt ?? t, t, doc.authorId ?? this.localId, doc.origin ?? "local"],
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
      `INSERT INTO compare_sets (id, title, created_at, updated_at, author_id, origin) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      [doc.id, doc.title ?? "", doc.createdAt ?? t, t, doc.authorId ?? this.localId, doc.origin ?? "local"],
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

  // -- provenance: what an AI proposed through the MCP server ------------------
  /** Everything tagged source='ai', for the reader to review. */
  listProposed(): Doc {
    return {
      notes: this.db
        .query("SELECT * FROM notes WHERE source = 'ai' ORDER BY created_at DESC")
        .map(ResearchStore.noteRow),
      indications: this.db
        .query("SELECT * FROM word_indications WHERE source = 'ai' ORDER BY created_at DESC")
        .map(ResearchStore.indicationRow),
    };
  }
  /** Accept a proposal: it becomes the reader's own record. */
  acceptProposed(kind: "note" | "indication", id: string): boolean {
    const table = kind === "note" ? "notes" : "word_indications";
    return Number(
      this.db.run(`UPDATE ${table} SET source = 'me' WHERE id = ? AND source = 'ai'`, [id]).changes,
    ) > 0;
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
  /** Standalone lemma indications (words with no root). */
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
   *  form's refinement) and, for rootless words, standalone lemma indications. */
  indicationsForWord(lemma: string | null, root: string | null): Doc {
    const rootIndications = root
      ? this.rootIndications(root).map((s) => ({
          ...s,
          refinement: lemma ? this.refinementFor(s.id, lemma) : null,
          refinedCount: this.refinementsForParent(s.id).length, // how many forms are done
        }))
      : [];
    const lemmaIndications = (!root && lemma) ? this.lemmaIndications(lemma) : [];
    return {
      root, lemma, rootIndications, lemmaIndications,
      // The community's readings ride in SEPARATE arrays, never merged into the two above.
      // The UI shows them in the same list, but the boundary stays visible in the data: these
      // came from derived_peer_indications and cannot be edited or made primary.
      communityRoot: root ? this.peerIndications("root", root) : [],
      communityLemma: lemma ? this.peerIndications("form", lemma) : [],
    };
  }

  /**
   * The community's readings of one subject, best first.
   *
   * Ordered established → proposed → superseded, because that is the order a reader wants to
   * meet them in: what the group settled on, what is still being argued, what someone has
   * since moved on from. None of them is deleted — a superseded reading is still a reading.
   */
  peerIndications(subjectKind: string, subjectValue: string): Doc[] {
    return this.db
      .query<Doc>(
        `SELECT * FROM derived_peer_indications
          WHERE subject_kind = ? AND subject_value = ?
          ORDER BY CASE status WHEN 'established' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END,
                   created_at DESC`,
        [subjectKind, subjectValue])
      .map((r) => this.peerRow(r));
  }

  /**
   * The community's FORM readings for a set of lemmas, keyed by lemma.
   *
   * A community root reading has no refinements of its own — the group states form-level
   * readings as separate form claims. So the per-form view of a community root reading is
   * assembled here: each form of the root, matched to whatever the community has said about
   * that exact form. Best reading per lemma (established first).
   */
  peerFormReadings(lemmas: string[]): Record<string, Doc> {
    const out: Record<string, Doc> = {};
    if (lemmas.length === 0) return out;
    const marks = lemmas.map(() => "?").join(",");
    for (const r of this.db.query<Doc>(
      `SELECT * FROM derived_peer_indications
        WHERE subject_kind = 'form' AND subject_value IN (${marks})
        ORDER BY CASE status WHEN 'established' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END,
                 created_at DESC`, lemmas)) {
      if (!out[r.subject_value]) out[r.subject_value] = this.peerRow(r); // first = best
    }
    return out;
  }

  private peerRow(r: Doc): Doc {
    return {
      id: `peer:${r.claim_id}@${r.version}`,
      claimId: r.claim_id, version: r.version, authorId: r.author_id,
      scope: r.subject_kind === "root" ? "root" : "lemma",
      root: r.subject_kind === "root" ? r.subject_value : null,
      lemma: r.subject_kind === "form" ? r.subject_value : null,
      status: r.status, label: r.label, meaning: r.meaning,
      createdAt: r.created_at,
      origin: "remote", source: "community",
      dissents: this.db.scalar<number>(
        "SELECT COUNT(*) FROM derived_dissents WHERE claim_id = ? AND claim_version = ?",
        [r.claim_id, r.version]) ?? 0,
    };
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

  /** Create/update a root indication (root set) OR a standalone lemma indication (rootless). */
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
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET root=excluded.root, lemma=excluded.lemma, scope=excluded.scope,
         label=excluded.label, meaning=excluded.meaning, is_primary=excluded.is_primary, updated_at=excluded.updated_at`,
      [doc.id, root, lemma, scope, doc.label ?? "", doc.meaning ?? "", primary ? 1 : 0,
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
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
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?, 'lemma', ?, ?, ?, 0, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [id, parent.root, doc.lemma, doc.parentId, doc.label ?? "", doc.meaning ?? "",
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
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

  /** Make a root indication (or a standalone lemma indication) the primary in its group. */
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

  // ---- outbound submission ledger (what I've offered upstream) ------------------
  /** What was submitted for this local record, if anything. */
  getSubmissionFor(localRef: string): Doc | undefined {
    const r = this.db.one<{
      local_ref: string; submission_id: string; content_hash: string;
      kind: string; status: string; submitted_at: number;
    }>("SELECT * FROM derived_submissions WHERE local_ref = ?", [localRef]);
    return r ? {
      localRef: r.local_ref, submissionId: r.submission_id, contentHash: r.content_hash,
      kind: r.kind, status: r.status, submittedAt: r.submitted_at,
    } : undefined;
  }

  listSubmissionLog(): Doc[] {
    return this.db
      .query<{ local_ref: string; submission_id: string; content_hash: string; kind: string; status: string; submitted_at: number }>(
        "SELECT * FROM derived_submissions ORDER BY submitted_at DESC")
      .map((r) => ({
        localRef: r.local_ref, submissionId: r.submission_id, contentHash: r.content_hash,
        kind: r.kind, status: r.status, submittedAt: r.submitted_at,
      }));
  }

  /** Record (or replace) what was submitted for a local record. */
  recordSubmission(doc: Doc): Doc {
    const t = now();
    this.db.run(
      `INSERT INTO derived_submissions (local_ref, submission_id, content_hash, kind, status, submitted_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(local_ref) DO UPDATE SET submission_id=excluded.submission_id,
         content_hash=excluded.content_hash, kind=excluded.kind,
         status=excluded.status, submitted_at=excluded.submitted_at`,
      [doc.localRef, doc.submissionId, doc.contentHash, doc.kind ?? "",
       doc.status ?? "submitted", t],
    );
    return this.getSubmissionFor(doc.localRef)!;
  }

  // ---- the group's readings, pulled from the remote (Phase 6) -------------------
  //
  // Everything here writes ONLY derived_* tables. Nothing in this section may touch cases,
  // form_research, notes, indications, trails or motifs — that is the write boundary
  // (SHARED_RESEARCH.md §8), and sync-boundary.test.ts checks it holds.

  syncPosition(stream: string): number {
    const row = this.db.one<{ position: number }>(
      "SELECT position FROM derived_sync_state WHERE stream = ?", [stream]);
    return row?.position ?? 0;
  }

  /**
   * Where each stream has got to, as the remote expects it back.
   *
   * Streams are listed explicitly rather than read from the table, so a stream that has never
   * been pulled reports 0 (a full resync of that stream) instead of being absent — the remote
   * would then default it to 0 anyway, but a caller reading this shouldn't have to know that.
   */
  syncCursors(): Record<string, number> {
    return {
      globalForms: this.syncPosition("globalForms"),
      dissents: this.syncPosition("dissents"),
      peerIndications: this.syncPosition("peerIndications"),
    };
  }

  setSyncPosition(stream: string, position: number): void {
    this.db.run(
      `INSERT INTO derived_sync_state (stream, position, updated_at) VALUES (?,?,?)
       ON CONFLICT(stream) DO UPDATE SET position = excluded.position, updated_at = excluded.updated_at`,
      [stream, position, now()],
    );
  }

  /**
   * Apply a pulled page. Idempotent: rows upsert by primary key, so re-delivering a row (which
   * the cursor deliberately allows) changes nothing. Unknown payload fields are kept verbatim —
   * an old client must not silently drop what a newer one wrote.
   */
  applyPull(page: {
    globalForms?: Doc[]; dissents?: Doc[]; peerIndications?: Doc[];
    cursors?: Record<string, number>;
  }): Doc {
    let forms = 0, dissents = 0, peerIndications = 0;
    for (const g of page.globalForms ?? []) {
      this.db.run(
        `INSERT INTO derived_global_forms
           (subject_kind, subject_value, claim_id, version, meaning, author_id,
            established_at, payload, schema_version, seq)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(subject_kind, subject_value) DO UPDATE SET
           claim_id=excluded.claim_id, version=excluded.version, meaning=excluded.meaning,
           author_id=excluded.author_id, established_at=excluded.established_at,
           payload=excluded.payload, schema_version=excluded.schema_version, seq=excluded.seq`,
        [g.subjectKind, g.subjectValue, g.claimId, g.version, g.meaning ?? "", g.authorId,
         Date.parse(g.establishedAt) || now(), JSON.stringify(g.payload ?? null),
         g.schemaVersion ?? 1, g.seq ?? 0],
      );
      forms++;
    }
    for (const d of page.dissents ?? []) {
      this.db.run(
        `INSERT INTO derived_dissents
           (id, claim_id, claim_version, author_id, payload, created_at, schema_version, seq)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, seq=excluded.seq`,
        [d.id, d.claimId, d.claimVersion, d.authorId, JSON.stringify(d.payload ?? null),
         Date.parse(d.createdAt) || now(), d.schemaVersion ?? 1, d.seq ?? 0],
      );
      dissents++;
    }
    // Status is re-sent on every pull rather than being computed here: a reading that loses
    // the global slot must stop calling itself established, and only the remote knows that.
    for (const p of page.peerIndications ?? []) {
      this.db.run(
        `INSERT INTO derived_peer_indications
           (claim_id, version, author_id, subject_kind, subject_value, status,
            label, meaning, payload, created_at, schema_version, seq)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(claim_id, version) DO UPDATE SET
           status=excluded.status, label=excluded.label, meaning=excluded.meaning,
           payload=excluded.payload, schema_version=excluded.schema_version, seq=excluded.seq`,
        [p.claimId, p.version, p.authorId, p.subjectKind, p.subjectValue,
         p.status ?? "proposed", p.label ?? "", p.meaning ?? "",
         JSON.stringify(p.payload ?? null), Date.parse(p.createdAt) || now(),
         p.schemaVersion ?? 1, p.seq ?? 0],
      );
      peerIndications++;
    }
    // One position per stream. The remote's tables each have their own sequence, so a single
    // shared cursor runs one stream ahead of another and silently skips rows.
    for (const [stream, at] of Object.entries(page.cursors ?? {})) {
      if (typeof at === "number") this.setSyncPosition(stream, at);
    }
    return { globalForms: forms, dissents, peerIndications, cursors: this.syncCursors() };
  }

  /** The group's reading of a form or root, if they have one. */
  groupReading(subjectKind: string, subjectValue: string): Doc | undefined {
    const r = this.db.one<Doc>(
      "SELECT * FROM derived_global_forms WHERE subject_kind = ? AND subject_value = ?",
      [subjectKind, subjectValue]);
    return r ? {
      subjectKind: r.subject_kind, subjectValue: r.subject_value,
      claimId: r.claim_id, version: r.version, meaning: r.meaning, authorId: r.author_id,
      establishedAt: r.established_at,
      dissents: this.db.scalar<number>(
        "SELECT COUNT(*) FROM derived_dissents WHERE claim_id = ? AND claim_version = ?",
        [r.claim_id, r.version]) ?? 0,
    } : undefined;
  }

  /** Every group reading, for the gloss layer. */
  groupGloss(): Doc[] {
    return this.db
      .query<Doc>("SELECT subject_kind, subject_value, meaning FROM derived_global_forms WHERE meaning != ''")
      .map((r) => ({ subjectKind: r.subject_kind, subjectValue: r.subject_value, meaning: r.meaning }));
  }

  /**
   * **Where I stand apart** — forms I have established whose meaning differs from the group's.
   *
   * This is the most valuable list in the app: not a conflict to resolve, but the record of
   * where your reading and theirs genuinely part company. Neither side is changed by it.
   */
  divergences(): Doc[] {
    return this.db
      .query<Doc>(
        `SELECT fr.lemma, fr.root, fr.meaning AS mine, fr.case_id,
                g.meaning AS theirs, g.claim_id, g.version, g.author_id
           FROM form_research fr
           JOIN derived_global_forms g
             ON g.subject_kind = 'form' AND g.subject_value = fr.lemma
          WHERE fr.status = 'established'
            AND TRIM(LOWER(fr.meaning)) != TRIM(LOWER(g.meaning))
          ORDER BY fr.lemma`,
      )
      .map((r) => ({
        lemma: r.lemma, root: r.root, caseId: r.case_id,
        mine: r.mine, theirs: r.theirs,
        claimId: r.claim_id, version: r.version, authorId: r.author_id,
        dissents: this.db.scalar<number>(
          "SELECT COUNT(*) FROM derived_dissents WHERE claim_id = ? AND claim_version = ?",
          [r.claim_id, r.version]) ?? 0,
      }));
  }

  /**
   * The three numbers that explain an empty divergence list.
   *
   * "Nothing here" has three quite different causes and the reader deserves to know which:
   * you have never pulled, the group holds nothing on words you've settled, or you genuinely
   * agree. Without these counts the screen can only say "nothing", which reads as breakage.
   */
  divergenceContext(): { mine: number; theirs: number; overlap: number } {
    const one = (sql: string) => this.db.scalar<number>(sql) ?? 0;
    return {
      mine: one("SELECT COUNT(*) FROM form_research WHERE status = 'established'"),
      theirs: one("SELECT COUNT(*) FROM derived_global_forms"),
      overlap: one(
        `SELECT COUNT(*) FROM form_research fr
           JOIN derived_global_forms g
             ON g.subject_kind = 'form' AND g.subject_value = fr.lemma
          WHERE fr.status = 'established'`),
    };
  }

  /** Drop everything pulled. Always safe — a resync rebuilds it, and no research is lost. */
  resetPulled(): void {
    this.db.exec("DELETE FROM derived_global_forms");
    this.db.exec("DELETE FROM derived_dissents");
    this.db.exec("DELETE FROM derived_peer_indications");
    this.db.exec("DELETE FROM derived_sync_state");
  }

  // ---- settings: device-independent key -> JSON value --------------------------
  getSetting(key: string): unknown {
    const row = this.db.one<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
    if (!row) return undefined;
    try { return JSON.parse(row.value); } catch { return undefined; }
  }

  setSetting(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value ?? null), now()],
    );
  }
}
