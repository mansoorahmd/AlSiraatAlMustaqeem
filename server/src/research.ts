// Research store — the reader's own scholarship: cases (+ form_research/revisions), trails,
// notes, root meanings, motifs, indications, comparisons, settings, and the outbox of what they
// have published. Port of quran_api/research.py.
//
// Written once, async, against ResearchDb (research-db.ts), so the same code runs over a
// research.db FILE (SQLite: the local server, tests, import/export) and over the signed-in
// user's own Postgres SCHEMA on the research server. Every visible ordering is total (ids as the
// last key), so both engines return the same rows in the same order.

import { randomUUID } from "node:crypto";
import { ownerIdFor, normalizeEmail } from "./identity.js";
import type { ResearchDb } from "./research-db.js";

// User-authored top-level records get an author + origin stamp (Phase 1). `author_id`
// is the account-independent identity (see ensureLocalId); `origin` is 'local'
// for anything the reader (or their AI) makes here, vs 'remote' for pulled peer work.
// Child rows (form_research, motif_roots, compare_items) inherit authorship from their
// parent and are not stamped.
export const STAMPED_TABLES = [
  "cases", "notes", "trails", "motifs", "user_root_meanings", "word_indications", "compare_sets",
];

/** The research.db file's schema (SQLite). The Postgres twin is remote/src/research/schema.ts. */
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
-- source indexes are created in migrateSqlite, AFTER the migration adds the column

-- the reader's own meaning for a root, saved alongside the dictionary lexicons
CREATE TABLE IF NOT EXISTS user_root_meanings (
    root TEXT PRIMARY KEY, meaning TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);

-- motifs (بيوت): reader-defined collections that group roots by a linguistic motif
CREATE TABLE IF NOT EXISTS motifs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'me',   -- 'me' = the reader; 'ai' = proposed via the MCP server
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

-- Which readings this reader has PROPOSED to the community (the claim spine's outbox). Like
-- derived_submissions, it exists only so the UI can tell "not proposed" from "proposed" from
-- "changed since I proposed it" — the claim itself lives on the remote. content_hash covers
-- the whole reading (root meaning + every form refinement), so editing any part shows as a
-- pending update. Drop-safe: losing it costs a re-propose, never research.
CREATE TABLE IF NOT EXISTS derived_proposed_claims (
    subject_kind TEXT NOT NULL,          -- 'form' | 'root'
    subject_value TEXT NOT NULL,
    content_hash TEXT NOT NULL,          -- hash of the reading as proposed
    proposed_at INTEGER NOT NULL,
    PRIMARY KEY (subject_kind, subject_value)
);

-- (Removed with monetization: the group's readings are no longer MIRRORED into local derived
-- tables. Community data is read LIVE from the remote and gated. Only derived_submissions /
-- derived_proposed_claims remain: they record YOUR OWN outbound actions, not anyone else's work.)
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
type MotifRow = { id: string; name: string; note: string; source?: string; created_at: number; updated_at: number };

export class ResearchStore {
  /** The identity every row this reader creates is stamped with (the owner's uuid once claimed). */
  localId = "";

  private constructor(private db: ResearchDb) {}

  /**
   * Open a research store. A research.db FILE migrates itself here (old files gain columns as the
   * schema grew). A Postgres schema is created and upgraded by the research server before it gets
   * here (remote/src/research/schema.ts), so there is nothing to migrate.
   */
  static async open(db: ResearchDb): Promise<ResearchStore> {
    const store = new ResearchStore(db);
    if (db.dialect === "sqlite") await store.migrateSqlite();
    // Phase 1 — local identity: a stable id every authored row is stamped with.
    store.localId = await store.ensureLocalId();
    if (db.dialect === "sqlite") for (const table of STAMPED_TABLES) await store.stampTable(table);
    return store;
  }

  private async migrateSqlite(): Promise<void> {
    const db = this.db;
    const cols = async (t: string) =>
      new Set((await db.query<{ name: string }>(`PRAGMA table_info(${t})`)).map((r) => r.name));
    await db.exec("PRAGMA journal_mode = WAL");
    await db.exec(SCHEMA);
    const have = await cols("notes");
    for (const [col, decl] of NOTE_MIGRATIONS) {
      if (!have.has(col)) await db.exec(`ALTER TABLE notes ADD COLUMN ${col} ${decl}`);
    }
    await db.exec("CREATE INDEX IF NOT EXISTS idx_notes_lemma ON notes(lemma)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_notes_root ON notes(root)");
    // "senses" were renamed to "indications". The old tables are dropped rather
    // than migrated: the feature was still being shaped and its data was scratch.
    await db.exec("DROP TABLE IF EXISTS word_senses");
    await db.exec("DROP TABLE IF EXISTS sense_assignments");
    // the owner record gained a name after it shipped with just an email
    const ownerCols = await cols("owner");
    if (ownerCols.size && !ownerCols.has("name")) {
      await db.exec("ALTER TABLE owner ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    }
    // provenance: records proposed by an AI through the MCP server are tagged
    const indCols = await cols("word_indications");
    if (indCols.size && !indCols.has("source")) {
      await db.exec("ALTER TABLE word_indications ADD COLUMN source TEXT NOT NULL DEFAULT 'me'");
    }
    // motifs gained a source flag so AI-proposed groupings are distinguishable from the reader's
    const motifCols = await cols("motifs");
    if (motifCols.size && !motifCols.has("source")) {
      await db.exec("ALTER TABLE motifs ADD COLUMN source TEXT NOT NULL DEFAULT 'me'");
    }
    await db.exec("CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_word_indications_source ON word_indications(source)");
  }

  /**
   * The id this database's work is attributed to. Once an owner is set it is their derived
   * uuid — stable for that person on any machine. Before that (or in tests) a random one is
   * minted so nothing is ever un-attributed.
   */
  private async ensureLocalId(): Promise<string> {
    const owner = await this.getOwner();
    if (owner) return owner.uuid as string;
    const cur = await this.getSetting("local_id");
    if (typeof cur === "string" && cur) return cur;
    const id = randomUUID();
    await this.setSetting("local_id", id);
    return id;
  }

  // ---- owner: whose research this is ---------------------------------------------
  /** Who this research belongs to, or undefined if nobody has claimed it yet. */
  async getOwner(): Promise<Doc | undefined> {
    try {
      const r = await this.db.one<{ name: string; email: string; uuid: string; claimed_at: number; updated_at: number }>(
        "SELECT name, email, uuid, claimed_at, updated_at FROM owner WHERE id = 1");
      return r
        ? { name: r.name ?? "", email: r.email, uuid: r.uuid, claimedAt: r.claimed_at, updatedAt: r.updated_at }
        : undefined;
    } catch { return undefined; } // table not present on a very old file
  }

  /**
   * Claim this research for `email`, or re-assign it (you hold the file, so you may correct a
   * typo or hand it on). The uuid is re-derived, and local_id follows it so newly authored rows
   * carry the right author.
   */
  async setOwner(email: string, name?: string): Promise<Doc> {
    const clean = normalizeEmail(email);
    if (!clean.includes("@")) throw new Error("a valid email is required");
    const uuid = ownerIdFor(clean);
    const t = now();
    // keep the existing name when one isn't supplied (e.g. correcting only the email)
    const label = (name ?? ((await this.getOwner())?.name as string | undefined) ?? "").trim().slice(0, 120);
    await this.db.run(
      `INSERT INTO owner (id, name, email, uuid, claimed_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email,
         uuid = excluded.uuid, updated_at = excluded.updated_at`,
      [label, clean, uuid, t, t],
    );
    await this.setSetting("local_id", uuid);
    this.localId = uuid;
    return (await this.getOwner())!;
  }

  /** Add author_id + origin to `table` if missing, and stamp any rows that predate them (SQLite). */
  private async stampTable(table: string): Promise<void> {
    const cols = new Set((await this.db.query<{ name: string }>(`PRAGMA table_info(${table})`)).map((r) => r.name));
    if (cols.size === 0) return; // table not present
    if (!cols.has("author_id")) await this.db.exec(`ALTER TABLE ${table} ADD COLUMN author_id TEXT`);
    if (!cols.has("origin")) await this.db.exec(`ALTER TABLE ${table} ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'`);
    await this.db.run(
      `UPDATE ${table} SET author_id = ? WHERE author_id IS NULL OR author_id = ''`,
      [this.localId],
    );
  }

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
    const subject = doc.subject ?? {};
    await this.db.run(
      `INSERT INTO cases (id, subject_type, subject_value, title, status, verdict, spark_verse_key, doc, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET subject_type=excluded.subject_type, subject_value=excluded.subject_value,
         title=excluded.title, status=excluded.status, verdict=excluded.verdict,
         spark_verse_key=excluded.spark_verse_key, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, subject.type ?? "root", subject.value ?? "", doc.title ?? "", doc.status ?? "open",
       doc.verdict ?? "", subject.sparkVerseKey ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
    );
    await this.reconcileFormResearch(doc);
    return doc;
  }
  async deleteCase(id: string): Promise<boolean> {
    const cur = await this.db.run("DELETE FROM cases WHERE id = ?", [id]);
    await this.db.run("DELETE FROM form_research WHERE case_id = ?", [id]);
    return cur.changes > 0;
  }

  /**
   * Keep form_research in step with the case document. NOTHING to do with remote sync — the
   * case board is the source, and this is the reader's own act. (Named "sync…" once, which
   * tripped the write-boundary test; the boundary is about what a PULL may write.)
   */
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
        await this.db.run("INSERT INTO form_revisions (case_id, lemma, meaning, replaced_at) VALUES (?,?,?,?)",
          [caseId, lemma, prev.meaning, t]);
      }
      await this.db.run(
        `INSERT INTO form_research (case_id, root, lemma, status, meaning, established_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(case_id, lemma) DO UPDATE SET root=excluded.root, status=excluded.status,
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
  async revisions(caseId: string, lemma: string): Promise<Doc[]> {
    return this.db.query(
      "SELECT meaning, replaced_at FROM form_revisions WHERE case_id = ? AND lemma = ? ORDER BY replaced_at DESC, id DESC",
      [caseId, lemma],
    );
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
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, subject=excluded.subject, doc=excluded.doc, updated_at=excluded.updated_at`,
      [doc.id, doc.name ?? "", doc.subject ?? null, JSON.stringify(doc), doc.createdAt, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
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
    if (!text) {
      await this.db.run("DELETE FROM user_root_meanings WHERE root = ?", [root]);
      return { root, meaning: "", updatedAt: t };
    }
    await this.db.run(
      `INSERT INTO user_root_meanings (root, meaning, updated_at, author_id, origin) VALUES (?,?,?,?,?)
       ON CONFLICT(root) DO UPDATE SET meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [root, text, t, this.localId, "local"],
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
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, note=excluded.note, updated_at=excluded.updated_at`,
      [id, doc.name ?? "", doc.note ?? "", doc.source === "ai" ? "ai" : existing?.source ?? "me",
       doc.createdAt ?? t, t, doc.authorId ?? this.localId, doc.origin ?? "local"],
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
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      [doc.id, doc.title ?? "", doc.createdAt ?? t, t, doc.authorId ?? this.localId, doc.origin ?? "local"],
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
       ON CONFLICT(set_id, kind, ref) DO NOTHING`,
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

  // -- provenance: what an AI proposed through the MCP server ------------------
  /** Everything tagged source='ai', for the reader to review. */
  async listProposed(): Promise<Doc> {
    return {
      notes: (await this.db.query("SELECT * FROM notes WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.noteRow),
      indications: (await this.db.query("SELECT * FROM word_indications WHERE source = 'ai' ORDER BY created_at DESC, id"))
        .map(ResearchStore.indicationRow),
    };
  }
  /** Accept a proposal: it becomes the reader's own record. */
  async acceptProposed(kind: "note" | "indication", id: string): Promise<boolean> {
    const table = kind === "note" ? "notes" : "word_indications";
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
      // The community's readings are not served from here: the app reads them live from the
      // research server (GET /community/readings, gated) and merges them in.
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
    await this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET root=excluded.root, lemma=excluded.lemma, scope=excluded.scope,
         label=excluded.label, meaning=excluded.meaning, is_primary=excluded.is_primary, updated_at=excluded.updated_at`,
      [doc.id, root, lemma, scope, doc.label ?? "", doc.meaning ?? "", primary ? 1 : 0,
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
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
    await this.db.run(
      `INSERT INTO word_indications (id, root, lemma, scope, parent_id, label, meaning, is_primary, source, created_at, updated_at, author_id, origin)
       VALUES (?,?,?, 'lemma', ?, ?, ?, 0, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, meaning=excluded.meaning, updated_at=excluded.updated_at`,
      [id, parent.root, doc.lemma, doc.parentId, doc.label ?? "", doc.meaning ?? "",
       doc.source === "ai" ? "ai" : existing?.source ?? "me", existing?.createdAt ?? t, t,
       doc.authorId ?? this.localId, doc.origin ?? "local"],
    );
    return this.getIndication(id);
  }

  async deleteIndication(id: string): Promise<boolean> {
    const s = await this.getIndication(id);
    if (!s) return false;
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

  /** What was submitted for this local record, if anything. */
  async getSubmissionFor(localRef: string): Promise<Doc | undefined> {
    const r = await this.db.one<any>("SELECT * FROM derived_submissions WHERE local_ref = ?", [localRef]);
    return r ? ResearchStore.submissionRow(r) : undefined;
  }

  async listSubmissionLog(): Promise<Doc[]> {
    return (await this.db.query<any>("SELECT * FROM derived_submissions ORDER BY submitted_at DESC, local_ref"))
      .map(ResearchStore.submissionRow);
  }

  /** Record (or replace) what was submitted for a local record. */
  async recordSubmission(doc: Doc): Promise<Doc> {
    const t = now();
    await this.db.run(
      `INSERT INTO derived_submissions (local_ref, submission_id, content_hash, kind, status, submitted_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(local_ref) DO UPDATE SET submission_id=excluded.submission_id,
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
       ON CONFLICT(subject_kind, subject_value)
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
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value ?? null), now()],
    );
  }
}
