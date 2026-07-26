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
export interface UserRootMeaning {
  root_buckwalter: string;
  meaning: string;
  updated_at: string;
}

export function listUserRootMeanings(db: Db): UserRootMeaning[] {
  return db.query<UserRootMeaning>("SELECT * FROM user_root_meanings ORDER BY updated_at DESC");
}

export function userRootMeaningCount(db: Db): number {
  return db.scalar<number>("SELECT COUNT(*) FROM user_root_meanings") ?? 0;
}

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

// -- compare tray (pin āyāt & roots to view side by side) --
export interface CompareItem {
  id: number;
  kind: "ayah" | "root";
  ref: string;
  label: string | null;
  created_at: string;
}

export function listCompare(db: Db): CompareItem[] {
  return db.query<CompareItem>("SELECT * FROM compare ORDER BY created_at");
}
export function addCompare(db: Db, kind: "ayah" | "root", ref: string, label: string | null): void {
  db.run("INSERT OR IGNORE INTO compare (kind, ref, label) VALUES (?, ?, ?)", [kind, ref, label]);
}
export function removeCompare(db: Db, id: number): void {
  db.run("DELETE FROM compare WHERE id = ?", [id]);
}
export function clearCompare(db: Db): void {
  db.run("DELETE FROM compare", []);
}
export function compareCount(db: Db): number {
  return db.scalar<number>("SELECT COUNT(*) FROM compare") ?? 0;
}
export function isCompared(db: Db, kind: "ayah" | "root", ref: string): boolean {
  return (db.scalar<number>("SELECT 1 FROM compare WHERE kind = ? AND ref = ?", [kind, ref]) ?? 0) === 1;
}

// -- motifs (reader-defined groupings of roots sharing a linguistic theme) --
export interface Motif {
  id: number;
  name: string;
  created_at: string;
  count?: number;
}

export function listMotifs(db: Db): Motif[] {
  return db.query<Motif>(
    `SELECT m.id, m.name, m.created_at, COUNT(mr.root_buckwalter) AS count
     FROM motifs m LEFT JOIN motif_roots mr ON mr.motif_id = m.id
     GROUP BY m.id ORDER BY m.name`,
  );
}

export function createMotif(db: Db, name: string): number {
  db.run("INSERT INTO motifs (name) VALUES (?)", [name]);
  return db.scalar<number>("SELECT last_insert_rowid()") ?? 0;
}

export function renameMotif(db: Db, id: number, name: string): void {
  db.run("UPDATE motifs SET name = ? WHERE id = ?", [name, id]);
}

export function deleteMotif(db: Db, id: number): void {
  db.run("DELETE FROM motif_roots WHERE motif_id = ?", [id]);
  db.run("DELETE FROM motifs WHERE id = ?", [id]);
}

export function motifMembers(db: Db, id: number): { root_buckwalter: string; root_arabic: string | null }[] {
  return db.query("SELECT root_buckwalter, root_arabic FROM motif_roots WHERE motif_id = ? ORDER BY root_arabic", [id]);
}

/** Motifs that already contain this root (for showing ticks in the picker). */
export function motifsForRoot(db: Db, rootBuckwalter: string): number[] {
  return db.query<{ motif_id: number }>(
    "SELECT motif_id FROM motif_roots WHERE root_buckwalter = ?", [rootBuckwalter],
  ).map((r) => r.motif_id);
}

export function addRootToMotif(db: Db, motifId: number, bw: string, ar: string | null): void {
  db.run(
    "INSERT OR IGNORE INTO motif_roots (motif_id, root_buckwalter, root_arabic) VALUES (?, ?, ?)",
    [motifId, bw, ar],
  );
}

export function removeRootFromMotif(db: Db, motifId: number, bw: string): void {
  db.run("DELETE FROM motif_roots WHERE motif_id = ? AND root_buckwalter = ?", [motifId, bw]);
}

// -- recent searches (device-local, capped) --
export function getRecentSearches(db: Db): string[] {
  try { return JSON.parse(getPref(db, "recentSearches") ?? "[]"); } catch { return []; }
}

export function pushRecentSearch(db: Db, q: string): void {
  const query = q.trim();
  if (!query) return;
  const next = [query, ...getRecentSearches(db).filter((x) => x !== query)].slice(0, 8);
  setPref(db, "recentSearches", JSON.stringify(next));
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
