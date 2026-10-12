// Rasm (orthography) variants: the same word + inflection written differently
// across the mushaf — e.g. إبراهيم full-yāʾ vs superscript small-yāʾ, رَأَىٰ vs
// رَءَا. Ported from the mobile app's data/spellings.ts (word-level part).

import type { CorpusDb } from "./corpus-db.js";
import { once } from "./corpus-db.js";
import { foldArabic } from "./text/normalize.js";

export interface SpellingVariant {
  surface: string;
  count: number;
  verses: string[];
  /** this is the spelling the asked-about occurrence is written in */
  here?: boolean;
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
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.build = once(() => this.load());
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{ verse_key: string; word_position: number; form_arabic: string | null }>(
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
  }

  /** Resolve a query to the occurrence list: exact rasm first, then the folded index
   *  so a word tapped in a non-Uthmani script still matches. `mode` says which hit. */
  async lookup(surface: string): Promise<{ key: string; mode: "rasm" | "folded"; list: WordOccurrence[] }> {
    await this.build();
    const rk = rasmKey(surface);
    if (!rk) return { key: "", mode: "rasm", list: [] };
    const exact = this.byRasm.get(rk);
    if (exact?.length) return { key: rk, mode: "rasm", list: exact };
    return { key: foldArabic(rk), mode: "folded", list: this.byFolded.get(foldArabic(rk)) ?? [] };
  }

  /** Every occurrence of the exact written word, in mushaf order. */
  async occurrences(surface: string, limit = 3000): Promise<WordOccurrence[]> {
    return (await this.lookup(surface)).list.slice(0, limit);
  }

  /** How many times this written form occurs — the total, before any limit. */
  async total(surface: string): Promise<number> {
    return (await this.lookup(surface)).list.length;
  }

  /** Other written forms that contain this one, i.e. the same word with ٱل / و / بِ
   *  attached, or with a pronoun suffix. Without this, tracing صلوٰة reports 2 — the
   *  bare form — while 65 occurrences sit inside ٱلصَّلَوٰةَ and look like they do not
   *  exist. Sorted by frequency. */
  async relatedForms(surface: string, limit = 12): Promise<RelatedForm[]> {
    const { key, mode } = await this.lookup(surface);
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
//
// Case (NOM/ACC/GEN) is left out of the group: it is a vowel mark, never a rasm
// letter, so it can't make a spelling variant — keeping it split one word's
// spellings by case, and the counts read as totals when they weren't (قَهَّار: ×1
// dagger-alif + ×3 full, when the full alif is ×5 once its two genitives count).
const CASES = new Set(["NOM", "ACC", "GEN"]);
const caseless = (raw: string) => raw.split("|").filter((t) => !CASES.has(t)).join("|");

// A hamza's seat is decided by what is ATTACHED to the stem, not by how the word is spelled:
// it follows its new neighbour (لِقَآء, لِقَآئِهِ; إِذَا, أَءِذَا). That is a rule of the script,
// so it is not a spelling variant. A stem with a suffix has its last hamza, and a stem with a
// prefix its first, read as the word's bare spelling: the commonest seat its group shows where
// nothing is attached on that side. A seat that differs with nothing attached (بِلِقَآئِ رَبِّهِمْ,
// 30:8) is a genuine variant and stays. Tāʾ-marbūṭa and the long tāʾ (ة, ت) are deliberately
// left alone: both are kept as variants.
const CONTEXTUAL = [new Set(["ء", "أ", "إ", "ؤ", "ئ"])];
const classOf = (ch: string | undefined) => (ch ? CONTEXTUAL.find((c) => c.has(ch)) : undefined);

interface StemWord {
  vk: string; pos: number; surface: string; raw: string; lemma: string; lemmas: Set<string>;
  prefixed: boolean; suffixed: boolean;
}
type Spelled = { w: StemWord; rk: string };

/** The commonest first (or last) letter, within `cls`, among the group's words with nothing
 *  attached on that side. */
function bareLetter(words: Spelled[], side: "first" | "last", cls: Set<string>): string | undefined {
  const n = new Map<string, number>();
  for (const { w, rk } of words) {
    if (side === "first" ? w.prefixed : w.suffixed) continue;
    const ch = side === "first" ? rk[0] : rk[rk.length - 1];
    if (ch && cls.has(ch)) n.set(ch, (n.get(ch) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** A word's rasm with the attachment-decided letters read as its bare spelling. */
function bareRasm({ w, rk }: Spelled, words: Spelled[]): string {
  let out = rk;
  const last = classOf(out[out.length - 1]);
  if (w.suffixed && last) {
    const ch = bareLetter(words, "last", last);
    if (ch) out = out.slice(0, -1) + ch;
  }
  const first = classOf(out[0]);
  if (w.prefixed && first) {
    const ch = bareLetter(words, "first", first);
    if (ch) out = ch + out.slice(1);
  }
  return out;
}

/** An āyah's variant words: written the unusual way here (`positions`), and having other
 *  spellings elsewhere while written the usual way here (`common`). */
export interface VerseVariants { verse_key: string; positions: number[]; common: number[] }

export class SpellingIndex {
  private unusual = new Map<string, Set<number>>(); // verse_key → words written the minority way
  private usual = new Map<string, Set<number>>();   // verse_key → variant words written the majority way
  private meta = new Map<string, [number, number]>(); // verse_key → [chapter, verseNo]
  private groupOf = new Map<string, [string, string]>(); // "verse#pos" → [group key, its spelling's key]
  private groupVariants = new Map<string, { key: string; variant: SpellingVariant }[]>(); // group key → variants
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.build = once(() => this.load());
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{
      verse_key: string; word_position: number; segment_type: string; form_arabic: string | null;
      raw_features: string | null; lemma_buckwalter: string | null;
      chapter_id: number; verse_number: number;
    }>(
      `SELECT ws.verse_key, ws.word_position, ws.segment_type, ws.form_arabic, ws.raw_features,
              ws.lemma_buckwalter, v.chapter_id, v.verse_number
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );
    // reassemble each word from its STEM segments (surface + first lemma/raw, and the set
    // of distinct stem-lemmas so compounds can be excluded), noting what is attached
    const per = new Map<string, StemWord>();
    for (const r of rows) {
      const k = `${r.verse_key}#${r.word_position}`;
      let e = per.get(k);
      if (!e) {
        e = { vk: r.verse_key, pos: r.word_position, surface: "", raw: "", lemma: "", lemmas: new Set(), prefixed: false, suffixed: false };
        per.set(k, e);
      }
      if (!this.meta.has(r.verse_key)) this.meta.set(r.verse_key, [r.chapter_id, r.verse_number]);
      if (r.segment_type === "PREFIX") { if (!e.surface) e.prefixed = true; continue; }
      if (r.segment_type === "SUFFIX") { if (e.surface) e.suffixed = true; continue; }
      if (r.segment_type !== "STEM") continue;
      e.surface += r.form_arabic ?? "";
      if (!e.raw && r.raw_features) e.raw = r.raw_features;
      if (!e.lemma && r.lemma_buckwalter) e.lemma = r.lemma_buckwalter;
      if (r.lemma_buckwalter) e.lemmas.add(r.lemma_buckwalter);
    }
    // group by (lemma | raw | skeleton)
    const groups = new Map<string, Spelled[]>();
    for (const w of per.values()) {
      // skip compounds/assimilations (مِمَّا = مِن+مَا): not simple spelling variants
      if (!w.surface || !w.lemma || w.lemmas.size > 1) continue;
      const rk = rasmKey(w.surface);
      const gk = `${w.lemma}|${caseless(w.raw)}|${skeleton(rk)}`;
      const g = groups.get(gk);
      if (g) g.push({ w, rk });
      else groups.set(gk, [{ w, rk }]);
    }
    for (const [gk, words] of groups) {
      // each distinct bare spelling, shown as a word written exactly that way when one exists
      const rasm = new Map<string, { surface: string; count: number; verses: string[]; asWritten: boolean }>();
      const keyed = words.map((sp) => {
        const key = bareRasm(sp, words);
        let e = rasm.get(key);
        if (!e) { e = { surface: sp.w.surface, count: 0, verses: [], asWritten: key === sp.rk }; rasm.set(key, e); }
        else if (!e.asWritten && key === sp.rk) { e.surface = sp.w.surface; e.asWritten = true; }
        e.count++;
        if (e.verses.length < 100) e.verses.push(sp.w.vk);
        return { w: sp.w, key };
      });
      if (rasm.size < 2) continue; // no variation
      const ranked = [...rasm.entries()].sort((a, b) => b[1].count - a[1].count);
      this.groupVariants.set(gk, ranked.map(([key, { surface, count, verses }]) => ({ key, variant: { surface, count, verses } })));
      const majority = ranked[0]![0];
      for (const { w, key } of keyed) {
        this.groupOf.set(`${w.vk}#${w.pos}`, [gk, key]);
        // the MINORITY spellings are the word written unusually here
        const into = key === majority ? this.usual : this.unusual;
        let s = into.get(w.vk);
        if (!s) { s = new Set(); into.set(w.vk, s); }
        s.add(w.pos);
      }
    }
  }

  /** The rasm variants of the word at (verseKey, wordPosition), from the same
   *  grouping the ✍ marks use — so the two always agree. [] when no variation. `here`
   *  marks the spelling this occurrence is written in. */
  async variantsForWord(verseKey: string, wordPosition: number): Promise<SpellingVariant[]> {
    await this.build();
    const at = this.groupOf.get(`${verseKey}#${wordPosition}`);
    if (!at) return [];
    return (this.groupVariants.get(at[0]) ?? []).map(({ key, variant }) => ({ ...variant, here: key === at[1] }));
  }

  /** Verses in a chapter with a word written unusually, plus their words that have other
   *  spellings but are written the usual way here. A verse whose variant words are all
   *  written the usual way isn't listed: nearly every āyah has one (إِلَىٰ, قَالَ), and the
   *  ✍ mark would stop meaning anything. */
  async chapterVariants(chapterId: number): Promise<VerseVariants[]> {
    await this.build();
    const sorted = (s: Set<number> | undefined) => [...(s ?? [])].sort((a, b) => a - b);
    const out: VerseVariants[] = [];
    for (const [vk, set] of this.unusual) {
      if (this.meta.get(vk)?.[0] === chapterId) out.push({ verse_key: vk, positions: sorted(set), common: sorted(this.usual.get(vk)) });
    }
    out.sort((a, b) => (this.meta.get(a.verse_key)![1]) - (this.meta.get(b.verse_key)![1]));
    return out;
  }
}
