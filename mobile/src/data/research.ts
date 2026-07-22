// Read/write research store (the reader's own notes, questions, and personal
// root meanings) backed by the device-local research.db.

import type { Db } from "./db";

export interface Note {
  id: number;
  kind: "note" | "question";
  verse_key: string | null;
  word_position: number | null;
  lemma: string | null;
  root: string | null;
  text: string;
  answer: string | null;
  created_at: string;
  updated_at: string;
}

export function notesForVerse(db: Db, verseKey: string): Note[] {
  return db.query<Note>("SELECT * FROM notes WHERE verse_key = ? ORDER BY created_at", [verseKey]);
}

export function notesForRoot(db: Db, root: string): Note[] {
  return db.query<Note>("SELECT * FROM notes WHERE root = ? ORDER BY created_at", [root]);
}

export function openQuestionCount(db: Db): number {
  return db.scalar<number>("SELECT COUNT(*) FROM notes WHERE kind = 'question' AND (answer IS NULL OR answer = '')") ?? 0;
}

export function addNote(
  db: Db,
  n: { kind?: "note" | "question"; verseKey?: string | null; wordPosition?: number | null; lemma?: string | null; root?: string | null; text: string },
): void {
  db.run(
    `INSERT INTO notes (kind, verse_key, word_position, lemma, root, text)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [n.kind ?? "note", n.verseKey ?? null, n.wordPosition ?? null, n.lemma ?? null, n.root ?? null, n.text],
  );
}

export function answerNote(db: Db, id: number, answer: string): void {
  db.run("UPDATE notes SET answer = ?, updated_at = datetime('now') WHERE id = ?", [answer, id]);
}

export function reopenNote(db: Db, id: number): void {
  db.run("UPDATE notes SET answer = NULL, updated_at = datetime('now') WHERE id = ?", [id]);
}

export function editNote(db: Db, id: number, text: string): void {
  db.run("UPDATE notes SET text = ?, updated_at = datetime('now') WHERE id = ?", [text, id]);
}

export function deleteNote(db: Db, id: number): void {
  db.run("DELETE FROM notes WHERE id = ?", [id]);
}

/** All notes attached anywhere in a chapter (for reader markers). */
export function notesForChapter(db: Db, chapterId: number): Note[] {
  return db.query<Note>(
    "SELECT * FROM notes WHERE verse_key LIKE ? ORDER BY verse_key, word_position",
    [`${chapterId}:%`],
  );
}

/** Every unresolved question across the Book (for the Open Questions view). */
export function allOpenQuestions(db: Db): Note[] {
  return db.query<Note>(
    "SELECT * FROM notes WHERE kind = 'question' AND (answer IS NULL OR answer = '') ORDER BY verse_key, word_position",
  );
}

// -- personal root meanings --
export function userRootMeaning(db: Db, rootBuckwalter: string): string | null {
  return db.scalar<string>("SELECT meaning FROM user_root_meanings WHERE root_buckwalter = ?", [rootBuckwalter]) ?? null;
}

// -- trails (expeditions through a root's occurrences) --
export interface TrailHop {
  verseKey: string;
  wordPosition: number | null;
}
export interface Trail {
  id: number;
  name: string | null;
  root_buckwalter: string | null;
  root_arabic: string | null;
  hops: string; // JSON TrailHop[]
  pos: number;
  created_at: string;
  updated_at: string;
}

export function createTrail(
  db: Db,
  t: { name?: string | null; rootBuckwalter?: string | null; rootArabic?: string | null; hops: TrailHop[]; pos?: number },
): number {
  db.run(
    `INSERT INTO trails (name, root_buckwalter, root_arabic, hops, pos)
     VALUES (?, ?, ?, ?, ?)`,
    [t.name ?? null, t.rootBuckwalter ?? null, t.rootArabic ?? null, JSON.stringify(t.hops), t.pos ?? 0],
  );
  return db.scalar<number>("SELECT last_insert_rowid()") ?? 0;
}

export function listTrails(db: Db): Trail[] {
  return db.query<Trail>("SELECT * FROM trails ORDER BY updated_at DESC");
}

export function getTrail(db: Db, id: number): Trail | undefined {
  return db.one<Trail>("SELECT * FROM trails WHERE id = ?", [id]);
}

export function updateTrailPos(db: Db, id: number, pos: number): void {
  db.run("UPDATE trails SET pos = ?, updated_at = datetime('now') WHERE id = ?", [pos, id]);
}

export function renameTrail(db: Db, id: number, name: string): void {
  db.run("UPDATE trails SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, id]);
}

export function deleteTrail(db: Db, id: number): void {
  db.run("DELETE FROM trails WHERE id = ?", [id]);
}

export function setUserRootMeaning(db: Db, rootBuckwalter: string, meaning: string): void {
  db.run(
    `INSERT INTO user_root_meanings (root_buckwalter, meaning, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(root_buckwalter) DO UPDATE SET meaning = excluded.meaning, updated_at = datetime('now')`,
    [rootBuckwalter, meaning],
  );
}

// -- device-local preferences (reading settings, last position, …) --
export function getPref(db: Db, key: string): string | null {
  return db.scalar<string>("SELECT value FROM prefs WHERE key = ?", [key]) ?? null;
}

export function setPref(db: Db, key: string, value: string): void {
  db.run(
    `INSERT INTO prefs (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
