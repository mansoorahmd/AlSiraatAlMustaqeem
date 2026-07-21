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
}
