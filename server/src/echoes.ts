// V10 — Verbatim echoes. Finds contiguous phrases that recur word-for-word
// across the Quran (refrains, recurring formulas, the basmala).
//
// A cheap 3-gram index over folded surface words tells us which verses contain
// *some* repeated phrase; the maximal repeated phrase(s) in a given verse are
// computed on demand by extending a shared 3-gram against the verses that
// share it.

import type { Db } from "./db.js";
import { foldArabic } from "./text/normalize.js";

const MIN_WORDS = 3; // shortest phrase considered an "echo"

export interface Echo {
  /** the repeated phrase, folded surface words joined by spaces */
  phrase: string;
  words: string[];
  /** 1-based word index where the phrase starts in the queried verse */
  start: number;
  length: number;
  /** other places the phrase occurs: verse key + 1-based start word index */
  occurrences: { verseKey: string; start: number }[];
  /** total occurrences across the Book (including this verse) */
  count: number;
}

const cnum = (k: string) => parseInt(k.split(":")[0] ?? "", 10) || 0;

export class EchoIndex {
  private words = new Map<string, string[]>();      // verse_key -> folded words
  private meta = new Map<string, [number, number]>(); // verse_key -> [chapter, verseNo]
  private gram3 = new Map<string, string[]>();       // 3-gram -> verse keys (≥2), sorted
  private withEcho = new Set<string>();              // verses containing any echo
  private built = false;

  constructor(private db: Db) {}

  build(): this {
    if (this.built) return this;
    const rows = this.db.query<{ verse_key: string; chapter_id: number; verse_number: number; t: string | null }>(
      `SELECT verse_key, chapter_id, verse_number, text_imlaei_simple AS t
       FROM verses ORDER BY chapter_id, verse_number`,
    );
    const tmp = new Map<string, Set<string>>();
    for (const r of rows) {
      const w = foldArabic(r.t ?? "").split(/\s+/).filter(Boolean);
      this.words.set(r.verse_key, w);
      this.meta.set(r.verse_key, [r.chapter_id, r.verse_number]);
      for (let i = 0; i + MIN_WORDS <= w.length; i++) {
        const g = w.slice(i, i + MIN_WORDS).join(" ");
        let s = tmp.get(g);
        if (!s) { s = new Set(); tmp.set(g, s); }
        s.add(r.verse_key);
      }
    }
    // keep only 3-grams shared by ≥2 distinct verses
    for (const [g, set] of tmp) {
      if (set.size >= 2) {
        const keys = [...set];
        this.gram3.set(g, keys);
        for (const k of keys) this.withEcho.add(k);
      }
    }
    this.built = true;
    return this;
  }

  /** Verse keys in a chapter that contain at least one repeated phrase. */
  chapterEchoes(chapterId: number): string[] {
    this.build();
    const out: string[] = [];
    for (const k of this.withEcho) if (cnum(k) === chapterId) out.push(k);
    out.sort((a, b) => (this.meta.get(a)![1]) - (this.meta.get(b)![1]));
    return out;
  }

  /** occurrences of an exact word-phrase across candidate verses (+ this verse) */
  private occurrences(phrase: string[], candidates: string[], self: string): { verse: string; pos: number }[] {
    const hits: { verse: string; pos: number }[] = [];
    const scan = (vk: string) => {
      const w = this.words.get(vk);
      if (!w) return;
      for (let i = 0; i + phrase.length <= w.length; i++) {
        let ok = true;
        for (let j = 0; j < phrase.length; j++) if (w[i + j] !== phrase[j]) { ok = false; break; }
        if (ok) hits.push({ verse: vk, pos: i });
      }
    };
    const seen = new Set<string>();
    for (const c of candidates) { if (!seen.has(c)) { seen.add(c); scan(c); } }
    if (!seen.has(self)) scan(self);
    return hits;
  }

  /** The maximal repeated phrases contained in a verse. */
  echoesForVerse(verseKey: string): Echo[] {
    this.build();
    const w = this.words.get(verseKey);
    if (!w) return [];
    const found: Echo[] = [];
    for (let s = 0; s + MIN_WORDS <= w.length; s++) {
      const base = w.slice(s, s + MIN_WORDS).join(" ");
      const cands = this.gram3.get(base);
      if (!cands) continue; // this 3-gram isn't repeated anywhere
      // extend while the phrase still occurs somewhere other than (verseKey, s)
      let len = MIN_WORDS;
      let bestOcc = this.occurrences(w.slice(s, s + len), cands, verseKey);
      while (s + len + 1 <= w.length) {
        const longer = this.occurrences(w.slice(s, s + len + 1), cands, verseKey);
        const others = longer.filter((h) => !(h.verse === verseKey && h.pos === s));
        if (others.length === 0) break;
        len += 1;
        bestOcc = longer;
      }
      const others = bestOcc.filter((h) => !(h.verse === verseKey && h.pos === s));
      if (others.length === 0) continue;
      // one entry per verse (its earliest position), so each chip jumps cleanly
      const byVerse = new Map<string, number>();
      for (const h of others) {
        const cur = byVerse.get(h.verse);
        if (cur == null || h.pos + 1 < cur) byVerse.set(h.verse, h.pos + 1);
      }
      const occurrences = [...byVerse.entries()]
        .map(([verseKey, start]) => ({ verseKey, start }))
        .sort((a, b) => cnum(a.verseKey) - cnum(b.verseKey) || this.meta.get(a.verseKey)![1] - this.meta.get(b.verseKey)![1]);
      found.push({
        phrase: w.slice(s, s + len).join(" "),
        words: w.slice(s, s + len),
        start: s + 1,
        length: len,
        occurrences,
        count: bestOcc.length,
      });
    }
    // drop phrases whose word-range is fully inside a longer kept phrase
    found.sort((a, b) => b.length - a.length);
    const kept: Echo[] = [];
    for (const e of found) {
      const a1 = e.start, a2 = e.start + e.length - 1;
      const covered = kept.some((k) => k.start <= a1 && k.start + k.length - 1 >= a2);
      if (!covered) kept.push(e);
    }
    kept.sort((a, b) => a.start - b.start);
    return kept;
  }
}
