// Opening and close: the roots a sūrah's first `n` āyāt share with its last `n`. Only words that
// have a root count. For each shared root: its places at each end, how close the match is (the
// same written word at both ends, the same lemma, or only the root) and how often the root occurs
// in the whole Book; the rarest first. The āyāt are the corpus's (the basmala is an āyah only in
// al-Fātiḥah). It finds and counts; what the two ends share in meaning is for the reader.

import type { CorpusDb } from "./corpus-db.js";
import { rasmKey } from "./spellings.js";

export interface FramePlace { verseKey: string; word: number; text: string; lemma: string }
export interface FrameShare {
  /** the shared root, in Arabic letters */
  root: string;
  /** how many times (words) the root occurs in the whole Book */
  inBook: number;
  /** how close the match is: the same written word at both ends, the same lemma, or only the root */
  level: "form" | "lemma" | "root";
  opening: FramePlace[];
  close: FramePlace[];
}
export interface SurahFrame {
  chapter: number;
  verses: number;
  /** how many āyāt each end takes (never so many that the two ends overlap) */
  n: number;
  opening: string[];
  close: string[];
  /** the root rarest in the Book first */
  shares: FrameShare[];
}

export const FRAME_DEFAULT_N = 3;
export const FRAME_MAX_N = 10;

interface Seg {
  verse_key: string; verse_number: number; word_position: number; segment_type: string | null;
  form_arabic: string | null; lemma_arabic: string | null; root_arabic: string | null;
}
interface Word { verseKey: string; pos: number; text: string; lemma: string; root: string }

/** What the first `n` āyāt of a sūrah share with its last `n`; null for a chapter that isn't one. */
export async function surahFrame(db: CorpusDb, chapter: number, asked = FRAME_DEFAULT_N): Promise<SurahFrame | null> {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 114) return null;
  const verses = await db.scalar<number>("SELECT COUNT(*) FROM verses WHERE chapter_id = ?", [chapter]);
  if (!verses) return null;
  const count = Number(verses);
  const n = Math.max(1, Math.min(Math.trunc(asked) || FRAME_DEFAULT_N, FRAME_MAX_N, Math.floor(count / 2)));
  const segs = await db.query<Seg>(
    `SELECT ws.verse_key, v.verse_number, ws.word_position, ws.segment_type, ws.form_arabic, ws.lemma_arabic, ws.root_arabic
     FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
     WHERE v.chapter_id = ? AND (v.verse_number <= ? OR v.verse_number > ?)
     ORDER BY v.verse_number, ws.word_position, ws.segment_number`,
    [chapter, n, count - n],
  );
  // words, each with its whole written form and the root and lemma of its stem
  const ends = { opening: [] as Word[], close: [] as Word[] };
  let cur: (Word & { end: "opening" | "close" }) | null = null;
  const flush = () => { if (cur && cur.root) ends[cur.end].push(cur); };
  for (const s of segs) {
    if (!cur || cur.verseKey !== s.verse_key || cur.pos !== s.word_position) {
      flush();
      cur = { verseKey: s.verse_key, pos: s.word_position, text: "", lemma: "", root: "", end: s.verse_number <= n ? "opening" : "close" };
    }
    cur.text += s.form_arabic ?? "";
    if (s.segment_type === "STEM" && s.root_arabic && !cur.root) { cur.root = s.root_arabic; cur.lemma = s.lemma_arabic ?? ""; }
  }
  flush();

  const byRoot = (ws: Word[]) => {
    const m = new Map<string, Word[]>();
    for (const w of ws) { const l = m.get(w.root); if (l) l.push(w); else m.set(w.root, [w]); }
    return m;
  };
  const open = byRoot(ends.opening);
  const close = byRoot(ends.close);
  const shared = [...open.keys()].filter((r) => close.has(r));
  const inBook = new Map<string, number>();
  if (shared.length) {
    const rows = await db.query<{ root_arabic: string; n: number }>(
      `SELECT t.root_arabic, COUNT(*) AS n FROM (
         SELECT root_arabic, verse_key, word_position FROM word_segments
         WHERE root_arabic IN (${shared.map(() => "?").join(", ")})
         GROUP BY root_arabic, verse_key, word_position
       ) t GROUP BY t.root_arabic`,
      shared,
    );
    for (const r of rows) inBook.set(r.root_arabic, Number(r.n));
  }
  const place = (w: Word): FramePlace => ({ verseKey: w.verseKey, word: w.pos, text: w.text, lemma: w.lemma });
  const shares: FrameShare[] = shared.map((root) => {
    const a = open.get(root)!;
    const b = close.get(root)!;
    const forms = new Set(a.map((w) => rasmKey(w.text)));
    const lemmas = new Set(a.map((w) => w.lemma));
    const level = b.some((w) => forms.has(rasmKey(w.text))) ? "form" : b.some((w) => lemmas.has(w.lemma)) ? "lemma" : "root";
    return { root, inBook: inBook.get(root) ?? 0, level, opening: a.map(place), close: b.map(place) };
  });
  // rarest first; then in the order the opening first uses them
  shares.sort((x, y) => x.inBook - y.inBook);
  return {
    chapter, verses: count, n,
    opening: Array.from({ length: n }, (_, i) => `${chapter}:${i + 1}`),
    close: Array.from({ length: n }, (_, i) => `${chapter}:${count - n + i + 1}`),
    shares,
  };
}
