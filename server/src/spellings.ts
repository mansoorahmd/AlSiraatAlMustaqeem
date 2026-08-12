// Rasm (orthography) variants: the same word + inflection written differently
// across the mushaf — e.g. إبراهيم full-yāʾ vs superscript small-yāʾ, رَأَىٰ vs
// رَءَا. Ported from the mobile app's data/spellings.ts (word-level part).

import type { Db } from "./db.js";
import { foldArabic } from "./text/normalize.js";

export interface SpellingVariant {
  surface: string;
  count: number;
  verses: string[];
}

// RASM key: keep only base rasm letters + dagger-alif + wasla + small wāw/yāʾ.
// U+0640 TATWEEL is excluded even though it falls inside the letter range: it is a
// cosmetic elongation dash, not a letter. The DISPLAYED verse text writes
// ٱلرَّحْمَـٰنِ WITH a tatweel while the morphology segments that build this index write
// it without, so keeping it made a word tapped in the reader unmatchable — "follow this
// word" then found nothing and showed only the tapped occurrence.
export const rasmKey = (s: string) =>
  (s || '').replace(/\u0640/g, '').replace(/[^\u0621-\u064A\u0670\u0671\u06E5\u06E6]/g, '');

// SKELETON: collapse the letters that carry the same word's long-ā across the two
// mushaf spellings, so the same word written two ways still lands in one group:
//   • hamza seats → ء
//   • every long-ā carrier → ا: alif, alif-maqṣūra ى, dagger-alif ٰ, waṣla ٱ, madda آ,
//     AND the mater-lectionis wāw و / superscript wāw ۥ (the archaic ā, as in
//     ٱلصَّلَوٰة, ٱلزَّكَوٰة, ٱلْحَيَوٰة — written with wāw where imlāʾī uses alif)
//   • tāʾ-marbūṭa ة → open tāʾ ت (رَحْمَت vs رَحْمَة, نِعْمَت vs نِعْمَة …)
// then squash runs. This only ever merges within one lemma + full morphological
// analysis (both are in the group key), so it unifies one word-form's spellings and
// never conflates different words. The distinct rasm spellings are still tracked
// separately inside the group, so each variant is counted and shown.
const SKEL: Record<string, string> = {
  "ء": "ء", "أ": "ء", "إ": "ء", "ؤ": "ء", "ئ": "ء", "ٱ": "ا",
  "آ": "ا", "ا": "ا", "ى": "ا", "ٰ": "ا", "و": "ا", "ۥ": "ا",
  "ة": "ت", "ۦ": "ي",
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

// ---- exact-word index: every place a word is written the same way -------------
// "Follow this exact word" walks the written surface (rasm), not the root, so it
// works for particles and proper names that have no root at all. Vowel marks are
// ignored, so the same word in a different case still matches. Built once and
// cached: unlike the variant index this spans ALL segments, since prefixes like
// وَ and ٱل are part of the written word.

export interface WordOccurrence { verse_key: string; word_position: number; surface?: string }

/** A written form that CONTAINS the traced rasm — the same word carrying prefixes or
 *  suffixes (ٱلصَّلَوٰة for صلوٰة). Reported so an exact trace can't be mistaken for the
 *  word's total frequency. */
export interface RelatedForm { surface: string; count: number }

export class WordFormIndex {
  private byRasm = new Map<string, WordOccurrence[]>();
  /** Secondary index on the FOLDED rasm (waṣla/madda/hamza-alif/dagger-alif → ا,
   *  alif-maqṣūra → ي, tāʾ-marbūṭa → ه). The index is built from the Uthmani
   *  morphology, but the reader can display imlāʾī / indopak / simplified text, where
   *  the same word is written الرحمن rather than ٱلرَّحْمَٰنِ. Without this fallback,
   *  tapping a word in any non-Uthmani script matched nothing. */
  private byFolded = new Map<string, WordOccurrence[]>();
  /** first surface seen for each rasm, to name it in results */
  private sample = new Map<string, string>();
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
      const full = per.get(k)!;
      const rk = rasmKey(full);
      if (!rk) continue;
      const hash = k.indexOf("#");
      const occ = {
        verse_key: k.slice(0, hash),
        word_position: Number(k.slice(hash + 1)),
        surface: full,
      };
      const list = this.byRasm.get(rk);
      if (list) list.push(occ);
      else this.byRasm.set(rk, [occ]);
      if (!this.sample.has(rk)) this.sample.set(rk, full);
      const fk = foldArabic(rk);
      const flist = this.byFolded.get(fk);
      if (flist) flist.push(occ);
      else this.byFolded.set(fk, [occ]);
    }
    this.built = true;
    return this;
  }

  /** Resolve a query to the occurrence list: exact rasm first, then the folded index
   *  so a word tapped in a non-Uthmani script still matches. `mode` says which hit. */
  lookup(surface: string): { key: string; mode: "rasm" | "folded"; list: WordOccurrence[] } {
    this.build();
    const rk = rasmKey(surface);
    if (!rk) return { key: "", mode: "rasm", list: [] };
    const exact = this.byRasm.get(rk);
    if (exact?.length) return { key: rk, mode: "rasm", list: exact };
    return { key: foldArabic(rk), mode: "folded", list: this.byFolded.get(foldArabic(rk)) ?? [] };
  }

  /** Every occurrence of the exact written word, in mushaf order. */
  occurrences(surface: string, limit = 3000): WordOccurrence[] {
    return this.lookup(surface).list.slice(0, limit);
  }

  /** How many times this written form occurs — the total, before any limit. */
  total(surface: string): number {
    return this.lookup(surface).list.length;
  }

  /** Other written forms that contain this one, i.e. the same word with ٱل / و / بِ
   *  attached, or with a pronoun suffix. Without this, tracing صلوٰة reports 2 — the
   *  bare form — while 65 occurrences sit inside ٱلصَّلَوٰةَ and look like they do not
   *  exist. Sorted by frequency. */
  relatedForms(surface: string, limit = 12): RelatedForm[] {
    const { key, mode } = this.lookup(surface);
    if (!key) return [];
    const index = mode === "rasm" ? this.byRasm : this.byFolded;
    const out: RelatedForm[] = [];
    for (const [k, list] of index) {
      if (k === key || !k.includes(key)) continue;
      out.push({ surface: this.sample.get(k) ?? list[0]?.surface ?? k, count: list.length });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, limit);
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
