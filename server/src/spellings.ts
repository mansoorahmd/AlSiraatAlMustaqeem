// Rasm (orthography) variants: the same word + inflection written differently
// across the mushaf — e.g. إبراهيم full-yāʾ vs superscript small-yāʾ, رَأَىٰ vs
// رَءَا. Ported from the mobile app's data/spellings.ts (word-level part).

import type { Db } from "./db.js";

export interface SpellingVariant {
  surface: string;
  count: number;
  verses: string[];
}

// RASM key: keep only base rasm letters + dagger-alif + wasla + small wāw/yāʾ.
export const rasmKey = (s: string) => (s || '').replace(/[^\u0621-\u064A\u0670\u0671\u06E5\u06E6]/g, '');

// SKELETON: collapse hamza seats (→ ء) and long-a letters (→ ا), small yāʾ/wāw,
// then squash runs — so the same word written two ways still groups together.
const SKEL: Record<string, string> = {
  "ء": "ء", "أ": "ء", "إ": "ء", "ؤ": "ء", "ئ": "ء", "ٱ": "ا",
  "آ": "ا", "ا": "ا", "ى": "ا", "ٰ": "ا",
  "ۦ": "ي", "ۥ": "و",
};
export const skeleton = (rk: string) => {
  let out = "";
  let prev = "";
  for (const ch of rk) {
    const m = SKEL[ch] ?? ch;
    if (m !== prev) out += m;
    prev = m;
  }
  return out;
};

interface StemRow { verse_key: string; word_position: number; form_arabic: string | null; segment_number: number; raw_features: string | null }

function stemSurfaces(rows: StemRow[]): Map<string, { vk: string; surface: string; raw: string }> {
  const per = new Map<string, { vk: string; surface: string; raw: string }>();
  for (const r of rows) {
    const k = `${r.verse_key}#${r.word_position}`;
    const cur = per.get(k);
    per.set(k, { vk: r.verse_key, surface: (cur?.surface ?? "") + (r.form_arabic ?? ""), raw: r.raw_features ?? cur?.raw ?? "" });
  }
  return per;
}

/** Distinct spellings of the exact word (same raw_features + skeleton) the
 *  tapped occurrence is. Returns a single entry when there's no variation. */
export function spellingVariantsForWord(db: Db, verseKey: string, wordPosition: number): SpellingVariant[] {
  const lb = db.scalar<string>(
    `SELECT lemma_buckwalter FROM word_segments
     WHERE verse_key = ? AND word_position = ? AND segment_type = 'STEM' AND lemma_buckwalter IS NOT NULL
     LIMIT 1`,
    [verseKey, wordPosition],
  );
  if (!lb) return [];

  const rows = db.query<StemRow>(
    `SELECT verse_key, word_position, form_arabic, segment_number, raw_features FROM word_segments
     WHERE lemma_buckwalter = ? AND segment_type = 'STEM'
     ORDER BY verse_key, word_position, segment_number`,
    [lb],
  );
  const per = stemSurfaces(rows);
  const self = per.get(`${verseKey}#${wordPosition}`);
  if (!self) return [];
  const targetRaw = self.raw;
  const targetSkel = skeleton(rasmKey(self.surface));

  const groups = new Map<string, { surface: string; count: number; verses: string[] }>();
  for (const { vk, surface, raw } of per.values()) {
    const rk = rasmKey(surface);
    if (raw !== targetRaw || skeleton(rk) !== targetSkel) continue;
    let g = groups.get(rk);
    if (!g) { g = { surface, count: 0, verses: [] }; groups.set(rk, g); }
    g.count++;
    if (g.verses.length < 100) g.verses.push(vk);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

// ---- exact-word index: every place a word is written the same way -------------
// "Follow this exact word" walks the written surface (rasm), not the root, so it
// works for particles and proper names that have no root at all. Vowel marks are
// ignored, so the same word in a different case still matches. Built once and
// cached: unlike the variant index this spans ALL segments, since prefixes like
// وَ and ٱل are part of the written word.

export interface WordOccurrence { verse_key: string; word_position: number }

export class WordFormIndex {
  private byRasm = new Map<string, WordOccurrence[]>();
  private built = false;

  constructor(private db: Db) {}

  build(): this {
    if (this.built) return this;
    const rows = this.db.query<{ verse_key: string; word_position: number; form_arabic: string | null }>(
      `SELECT ws.verse_key, ws.word_position, ws.form_arabic
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );
    // assemble each word's full written surface in mushaf order
    const per = new Map<string, string>();
    const order: string[] = [];
    for (const r of rows) {
      const k = `${r.verse_key}#${r.word_position}`;
      if (!per.has(k)) order.push(k);
      per.set(k, (per.get(k) ?? "") + (r.form_arabic ?? ""));
    }
    for (const k of order) {
      const rk = rasmKey(per.get(k)!);
      if (!rk) continue;
      const hash = k.indexOf("#");
      const occ = { verse_key: k.slice(0, hash), word_position: Number(k.slice(hash + 1)) };
      const list = this.byRasm.get(rk);
      if (list) list.push(occ);
      else this.byRasm.set(rk, [occ]);
    }
    this.built = true;
    return this;
  }

  /** Every occurrence of the exact written word, in mushaf order. */
  occurrences(surface: string, limit = 3000): WordOccurrence[] {
    this.build();
    const rk = rasmKey(surface);
    if (!rk) return [];
    return (this.byRasm.get(rk) ?? []).slice(0, limit);
  }
}

// ---- chapter-level index: which words carry a rasm variant --------------------
// A word occurrence is a "variant" when its (lemma | raw_features | skeleton)
// group is written ≥2 distinct ways across the mushaf. Built once and cached so
// the reader can mark āyāt cheaply.

export class SpellingIndex {
  private byVerse = new Map<string, Set<number>>(); // verse_key → variant word positions
  private meta = new Map<string, [number, number]>(); // verse_key → [chapter, verseNo]
  private groupOf = new Map<string, string>();       // "verse#pos" → group key
  private groupVariants = new Map<string, SpellingVariant[]>(); // group key → variants
  private built = false;

  constructor(private db: Db) {}

  build(): this {
    if (this.built) return this;
    const rows = this.db.query<{
      verse_key: string; word_position: number; form_arabic: string | null;
      raw_features: string | null; lemma_buckwalter: string | null;
      chapter_id: number; verse_number: number;
    }>(
      `SELECT ws.verse_key, ws.word_position, ws.form_arabic, ws.raw_features, ws.lemma_buckwalter,
              v.chapter_id, v.verse_number
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       WHERE ws.segment_type = 'STEM'
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );
    // reassemble each word from its STEM segments (surface + first lemma/raw,
    // and the set of distinct stem-lemmas so compounds can be excluded)
    const per = new Map<string, { vk: string; pos: number; surface: string; raw: string; lemma: string; lemmas: Set<string> }>();
    for (const r of rows) {
      const k = `${r.verse_key}#${r.word_position}`;
      let e = per.get(k);
      if (!e) { e = { vk: r.verse_key, pos: r.word_position, surface: "", raw: "", lemma: "", lemmas: new Set() }; per.set(k, e); }
      e.surface += r.form_arabic ?? "";
      if (!e.raw && r.raw_features) e.raw = r.raw_features;
      if (!e.lemma && r.lemma_buckwalter) e.lemma = r.lemma_buckwalter;
      if (r.lemma_buckwalter) e.lemmas.add(r.lemma_buckwalter);
      if (!this.meta.has(r.verse_key)) this.meta.set(r.verse_key, [r.chapter_id, r.verse_number]);
    }
    // group by (lemma | raw | skeleton); track each rasm's surface/count/verses
    const groups = new Map<string, {
      rasm: Map<string, { surface: string; count: number; verses: string[] }>;
      words: { vk: string; pos: number; rasm: string }[];
    }>();
    for (const w of per.values()) {
      // skip compounds/assimilations (مِمَّا = مِن+مَا): not simple spelling variants
      if (!w.lemma || w.lemmas.size > 1) continue;
      const rk = rasmKey(w.surface);
      const gk = `${w.lemma}|${w.raw}|${skeleton(rk)}`;
      let g = groups.get(gk);
      if (!g) { g = { rasm: new Map(), words: [] }; groups.set(gk, g); }
      let e = g.rasm.get(rk);
      if (!e) { e = { surface: w.surface, count: 0, verses: [] }; g.rasm.set(rk, e); }
      e.count++;
      if (e.verses.length < 100) e.verses.push(w.vk);
      g.words.push({ vk: w.vk, pos: w.pos, rasm: rk });
    }
    for (const [gk, g] of groups) {
      if (g.rasm.size < 2) continue; // no variation
      const variants = [...g.rasm.values()].sort((a, b) => b.count - a.count);
      this.groupVariants.set(gk, variants);
      const majorityRasm = [...g.rasm.entries()].sort((a, b) => b[1].count - a[1].count)[0]![0];
      for (const { vk, pos, rasm } of g.words) {
        this.groupOf.set(`${vk}#${pos}`, gk);
        // flag only the MINORITY spellings (the word written unusually here)
        if (rasm === majorityRasm) continue;
        let s = this.byVerse.get(vk);
        if (!s) { s = new Set(); this.byVerse.set(vk, s); }
        s.add(pos);
      }
    }
    this.built = true;
    return this;
  }

  /** The rasm variants of the word at (verseKey, wordPosition), from the same
   *  grouping the ✍ marks use — so the two always agree. [] when no variation. */
  variantsForWord(verseKey: string, wordPosition: number): SpellingVariant[] {
    this.build();
    const gk = this.groupOf.get(`${verseKey}#${wordPosition}`);
    return gk ? this.groupVariants.get(gk) ?? [] : [];
  }

  /** Verses in a chapter that contain variant words + those word positions. */
  chapterVariants(chapterId: number): { verse_key: string; positions: number[] }[] {
    this.build();
    const out: { verse_key: string; positions: number[] }[] = [];
    for (const [vk, set] of this.byVerse) {
      if (this.meta.get(vk)?.[0] === chapterId) out.push({ verse_key: vk, positions: [...set].sort((a, b) => a - b) });
    }
    out.sort((a, b) => (this.meta.get(a.verse_key)![1]) - (this.meta.get(b.verse_key)![1]));
    return out;
  }
}
