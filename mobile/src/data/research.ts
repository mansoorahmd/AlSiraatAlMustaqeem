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

// -- comparisons (named, saveable boards of pinned āyāt & roots) --
export interface CompareItem {
  id: number;
  set_id: number;
  kind: "ayah" | "root";
  ref: string;
  label: string | null;
  created_at: string;
}
export interface CompareSet {
  id: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  count: number;
}

/** All saved comparisons, most-recently-touched first, with member counts. */
export function listCompareSets(db: Db): CompareSet[] {
  return db.query<CompareSet>(
    `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
     FROM compare_sets s LEFT JOIN compare c ON c.set_id = s.id
     GROUP BY s.id ORDER BY s.updated_at DESC`,
  );
}

export function createCompareSet(db: Db, title: string | null): number {
  db.run("INSERT INTO compare_sets (title) VALUES (?)", [title ?? null]);
  return db.scalar<number>("SELECT last_insert_rowid()") ?? 0;
}

export function renameCompareSet(db: Db, id: number, title: string): void {
  db.run("UPDATE compare_sets SET title = ?, updated_at = datetime('now') WHERE id = ?", [title, id]);
}

export function deleteCompareSet(db: Db, id: number): void {
  db.run("DELETE FROM compare WHERE set_id = ?", [id]);
  db.run("DELETE FROM compare_sets WHERE id = ?", [id]);
  if (getPref(db, "activeCompareSet") === String(id)) setPref(db, "activeCompareSet", "");
}

function touchCompareSet(db: Db, id: number): void {
  db.run("UPDATE compare_sets SET updated_at = datetime('now') WHERE id = ?", [id]);
}

/** The active comparison's id — creating a first "Untitled" one if none exists
 *  or the stored active id is stale. */
export function ensureActiveCompareSet(db: Db): number {
  const stored = Number(getPref(db, "activeCompareSet"));
  if (stored) {
    const ok = db.scalar<number>("SELECT 1 FROM compare_sets WHERE id = ?", [stored]);
    if (ok) return stored;
  }
  const existing = db.scalar<number>("SELECT id FROM compare_sets ORDER BY updated_at DESC LIMIT 1");
  const id = existing ?? createCompareSet(db, null);
  setPref(db, "activeCompareSet", String(id));
  return id;
}

export function getActiveCompareSetId(db: Db): number {
  return ensureActiveCompareSet(db);
}

export function setActiveCompareSet(db: Db, id: number): void {
  setPref(db, "activeCompareSet", String(id));
}

export function getCompareSet(db: Db, id: number): CompareSet | undefined {
  return db.one<CompareSet>(
    `SELECT s.id, s.title, s.created_at, s.updated_at, COUNT(c.id) AS count
     FROM compare_sets s LEFT JOIN compare c ON c.set_id = s.id WHERE s.id = ? GROUP BY s.id`,
    [id],
  );
}

export function listCompare(db: Db, setId: number): CompareItem[] {
  return db.query<CompareItem>("SELECT * FROM compare WHERE set_id = ? ORDER BY created_at", [setId]);
}
export function addCompare(db: Db, setId: number, kind: "ayah" | "root", ref: string, label: string | null): void {
  db.run("INSERT OR IGNORE INTO compare (set_id, kind, ref, label) VALUES (?, ?, ?, ?)", [setId, kind, ref, label]);
  touchCompareSet(db, setId);
}
export function removeCompare(db: Db, id: number): void {
  const setId = db.scalar<number>("SELECT set_id FROM compare WHERE id = ?", [id]);
  db.run("DELETE FROM compare WHERE id = ?", [id]);
  if (setId) touchCompareSet(db, setId);
}
export function clearCompare(db: Db, setId: number): void {
  db.run("DELETE FROM compare WHERE set_id = ?", [setId]);
  touchCompareSet(db, setId);
}
export function compareCount(db: Db, setId: number): number {
  return db.scalar<number>("SELECT COUNT(*) FROM compare WHERE set_id = ?", [setId]) ?? 0;
}
export function isCompared(db: Db, setId: number, kind: "ayah" | "root", ref: string): boolean {
  return (db.scalar<number>("SELECT 1 FROM compare WHERE set_id = ? AND kind = ? AND ref = ?", [setId, kind, ref]) ?? 0) === 1;
}

/** Add to the active comparison from anywhere an āyah/root is shown. Returns the
 *  target comparison's display title and whether it was newly added. */
export function addToActiveCompare(
  db: Db, kind: "ayah" | "root", ref: string, label: string | null,
): { title: string; added: boolean; setId: number } {
  const setId = ensureActiveCompareSet(db);
  const already = isCompared(db, setId, kind, ref);
  if (!already) addCompare(db, setId, kind, ref, label);
  const s = getCompareSet(db, setId);
  return { title: s?.title?.trim() || "Untitled comparison", added: !already, setId };
}

// -- focus shortlist (a small, persisted set of āyāt & roots kept front-of-mind,
//    surfaced on Home; capped so it stays a shortlist, not a dumping ground) --
export const FOCUS_CAP = 5;

export interface FocusItem {
  id: number;
  kind: "ayah" | "root";
  ref: string;
  label: string | null;
  created_at: string;
}

export function listFocus(db: Db, kind?: "ayah" | "root"): FocusItem[] {
  return kind
    ? db.query<FocusItem>("SELECT * FROM focus WHERE kind = ? ORDER BY created_at DESC", [kind])
    : db.query<FocusItem>("SELECT * FROM focus ORDER BY created_at DESC");
}

export function focusCount(db: Db, kind: "ayah" | "root"): number {
  return db.scalar<number>("SELECT COUNT(*) FROM focus WHERE kind = ?", [kind]) ?? 0;
}

export function isFocused(db: Db, kind: "ayah" | "root", ref: string): boolean {
  return (db.scalar<number>("SELECT 1 FROM focus WHERE kind = ? AND ref = ?", [kind, ref]) ?? 0) === 1;
}

/** Add to the focus shortlist. Rejects (without error) once the per-kind cap is
 *  reached. Returns the outcome for a caller toast. */
export function addFocus(
  db: Db, kind: "ayah" | "root", ref: string, label: string | null,
): { ok: boolean; reason?: "full" | "exists"; count: number } {
  if (isFocused(db, kind, ref)) return { ok: false, reason: "exists", count: focusCount(db, kind) };
  const count = focusCount(db, kind);
  if (count >= FOCUS_CAP) return { ok: false, reason: "full", count };
  db.run("INSERT OR IGNORE INTO focus (kind, ref, label) VALUES (?, ?, ?)", [kind, ref, label]);
  return { ok: true, count: count + 1 };
}

export function removeFocus(db: Db, kind: "ayah" | "root", ref: string): void {
  db.run("DELETE FROM focus WHERE kind = ? AND ref = ?", [kind, ref]);
}

export function removeFocusById(db: Db, id: number): void {
  db.run("DELETE FROM focus WHERE id = ?", [id]);
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

// -- AI-share prompts & dictionary selection (device-local) --
export const DEFAULT_AI_PROMPTS = [
  "Please help me study this passage through its root vocabulary.",
  "Explain the nuance each root adds, and how its derived forms differ in meaning.",
  "Give a concise tafsir grounded in these roots and their usage across the Qur'an.",
];

export function getAiPrompts(db: Db): string[] {
  const raw = getPref(db, "aiPrompts");
  if (raw == null) return DEFAULT_AI_PROMPTS;
  try { const a = JSON.parse(raw); return Array.isArray(a) && a.length ? a : DEFAULT_AI_PROMPTS; }
  catch { return DEFAULT_AI_PROMPTS; }
}
export function addAiPrompt(db: Db, text: string): string[] {
  const t = text.trim();
  if (!t) return getAiPrompts(db);
  const next = [t, ...getAiPrompts(db).filter((p) => p !== t)].slice(0, 30);
  setPref(db, "aiPrompts", JSON.stringify(next));
  return next;
}
export function removeAiPrompt(db: Db, text: string): string[] {
  const next = getAiPrompts(db).filter((p) => p !== text);
  setPref(db, "aiPrompts", JSON.stringify(next));
  return next;
}
/** The prompt line to prepend; "" means none. Defaults to the first prompt. */
export function getAiPromptSel(db: Db): string {
  const v = getPref(db, "aiPromptSel");
  return v == null ? DEFAULT_AI_PROMPTS[0]! : v;
}
export function setAiPromptSel(db: Db, text: string): void {
  setPref(db, "aiPromptSel", text);
}
/** Whether to include the reader's translations in an āyah share. Default on. */
export function getAiIncludeTranslation(db: Db): boolean {
  return getPref(db, "aiTranslation") !== "0";
}
export function setAiIncludeTranslation(db: Db, on: boolean): void {
  setPref(db, "aiTranslation", on ? "1" : "0");
}

/** Selected dictionary sources, or null = include all. */
export function getAiDicts(db: Db): string[] | null {
  const raw = getPref(db, "aiDicts");
  if (raw == null) return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : null; }
  catch { return null; }
}
export function setAiDicts(db: Db, sources: string[]): void {
  setPref(db, "aiDicts", JSON.stringify(sources));
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
