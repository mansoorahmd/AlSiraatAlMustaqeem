// Root spread: where a set of roots occurs, by sūrah and by page of the muṣḥaf. It counts words
// (places) and āyāt, zeros included, and nothing more. An āyah that holds two of the roots counts
// once in `ayahs`; a word is one place whichever of the roots it carries. A word's page is its
// āyah's page (verses.page_number).

import type { CorpusDb } from "./corpus-db.js";
import { buckToArabic } from "./text/normalize.js";
import { rootLetters } from "./voices.js";

export interface SpreadChapter { chapter: number; places: number; ayahs: number; /** āyāt in the sūrah */ verses: number }
export interface SpreadPage { page: number; places: number; ayahs: number }
export interface RootSpread {
  /** the roots counted, in Arabic letters */
  roots: string[];
  /** roots that were asked for and are not in the Book */
  unknown: string[];
  total: number;
  ayahs: number;
  /** all 114 sūrahs in order, zeros included */
  chapters: SpreadChapter[];
  /** every page of the muṣḥaf in order, zeros included */
  pages: SpreadPage[];
  emptyChapters: number;
  emptyPages: number;
}

export const MAX_SPREAD_ROOTS = 60;

/** A request the route answers 422 with this message. */
export class SpreadRequestError extends Error {}

/** Check `{ roots }` and return the roots as given (trimmed, empty ones dropped). */
export function parseSpreadRequest(body: unknown): string[] {
  const roots = body && typeof body === "object" && !Array.isArray(body) ? (body as { roots?: unknown }).roots : undefined;
  if (!Array.isArray(roots) || roots.some((r) => typeof r !== "string")) {
    throw new SpreadRequestError("the body must be a JSON object with `roots`, a list of roots (Arabic letters or Buckwalter)");
  }
  const out = (roots as string[]).map((r) => r.trim()).filter(Boolean);
  if (out.length < 1 || out.length > MAX_SPREAD_ROOTS) throw new SpreadRequestError(`give 1 to ${MAX_SPREAD_ROOTS} roots`);
  return out;
}

// the corpus writes a root's hamza as ا (امن, اله)
const hamzaAsAlif = (s: string) => s.replace(/[ءأإآؤئ]/g, "ا");

/** Where these roots (Arabic letters, spaced or not, or Buckwalter) occur. */
export async function rootSpread(db: CorpusDb, asked: string[]): Promise<RootSpread> {
  const known = await db.query<{ root_arabic: string; root_buckwalter: string }>(
    "SELECT root_arabic, root_buckwalter FROM roots ORDER BY id",
  );
  const byArabic = new Map<string, string>();
  const byBuck = new Map<string, string>();
  for (const r of known) {
    if (!byArabic.has(r.root_arabic)) byArabic.set(r.root_arabic, r.root_arabic);
    const h = hamzaAsAlif(r.root_arabic);
    if (!byArabic.has(h)) byArabic.set(h, r.root_arabic);
    byBuck.set(r.root_buckwalter, r.root_arabic);
  }
  const roots: string[] = [];
  const unknown: string[] = [];
  for (const a of asked) {
    const letters = rootLetters(a);
    const found = letters
      ? byArabic.get(letters) ?? byArabic.get(hamzaAsAlif(letters))
      : byBuck.get(a.replace(/\s+/g, "")) ?? byArabic.get(rootLetters(buckToArabic(a.replace(/\s+/g, ""))));
    if (!found) { if (!unknown.includes(a)) unknown.push(a); }
    else if (!roots.includes(found)) roots.push(found);
  }

  const chapterRows = await db.query<{ id: number; verses_count: number }>("SELECT id, verses_count FROM chapters ORDER BY id");
  const pageRows = await db.query<{ page_number: number }>(
    "SELECT page_number FROM verses WHERE page_number IS NOT NULL GROUP BY page_number ORDER BY page_number",
  );
  const words = roots.length
    ? await db.query<{ verse_key: string; chapter_id: number; page_number: number | null }>(
      `SELECT ws.verse_key, v.chapter_id, v.page_number
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       WHERE ws.root_arabic IN (${roots.map(() => "?").join(", ")})
       GROUP BY ws.verse_key, ws.word_position, v.chapter_id, v.page_number`,
      roots,
    )
    : [];

  const chPlaces = new Map<number, number>();
  const chAyahs = new Map<number, Set<string>>();
  const pgPlaces = new Map<number, number>();
  const pgAyahs = new Map<number, Set<string>>();
  const ayahs = new Set<string>();
  for (const w of words) {
    ayahs.add(w.verse_key);
    chPlaces.set(w.chapter_id, (chPlaces.get(w.chapter_id) ?? 0) + 1);
    let s = chAyahs.get(w.chapter_id);
    if (!s) { s = new Set(); chAyahs.set(w.chapter_id, s); }
    s.add(w.verse_key);
    if (w.page_number !== null) {
      pgPlaces.set(w.page_number, (pgPlaces.get(w.page_number) ?? 0) + 1);
      let p = pgAyahs.get(w.page_number);
      if (!p) { p = new Set(); pgAyahs.set(w.page_number, p); }
      p.add(w.verse_key);
    }
  }
  const chapters = chapterRows.map((c) => ({
    chapter: c.id, places: chPlaces.get(c.id) ?? 0, ayahs: chAyahs.get(c.id)?.size ?? 0, verses: c.verses_count,
  }));
  const pages = pageRows.map((p) => ({
    page: p.page_number, places: pgPlaces.get(p.page_number) ?? 0, ayahs: pgAyahs.get(p.page_number)?.size ?? 0,
  }));
  return {
    roots, unknown, total: words.length, ayahs: ayahs.size, chapters, pages,
    emptyChapters: chapters.filter((c) => c.places === 0).length,
    emptyPages: pages.filter((p) => p.places === 0).length,
  };
}
