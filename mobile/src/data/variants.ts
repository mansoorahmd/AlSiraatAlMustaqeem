// Precomputed index of āyāt that contain a word written with more than one rasm
// somewhere in the mushaf — powers the subtle ✍ reader mark. Same grouping the
// word-menu spelling panel uses (lemma + raw_features + skeleton → distinct rasm
// keys), built once over the whole corpus and cached. `warmup()` builds it off
// the main thread (async read + chunked processing) so the reader never freezes.
//
// Two important rules keep the mark honest:
//  • Compounds/assimilations (مِمَّا = مِن+مَا) carry >1 stem-lemma; they are NOT
//    simple spelling variants, so they're excluded entirely.
//  • Only the MINORITY spelling of a word is marked — the unusual writing here —
//    not every occurrence of a word that happens to vary somewhere.
// The word-menu panel reads variants from this same index (variantsForWord), so
// a marked word always shows its spellings and an unmarked one never does.

import type { Db } from "./db";
import { rasmKey, skeleton, type SpellingVariant } from "./spellings";

type Row = {
  verse_key: string; word_position: number; form_arabic: string | null;
  segment_number: number; raw_features: string | null; lemma_buckwalter: string | null;
};
const SQL = `SELECT verse_key, word_position, form_arabic, segment_number, raw_features, lemma_buckwalter
  FROM word_segments WHERE segment_type = 'STEM'
  ORDER BY verse_key, word_position, segment_number`;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

type Word = { vk: string; pos: number; surface: string; raw: string; lemma: string; lemmas: Set<string> };

export class VariantIndex {
  private verses = new Set<string>();        // verse keys containing a minority-spelled word
  private wordKeys = new Set<string>();      // "verse#position" of the minority-spelled words
  private groupOf = new Map<string, string>();          // "verse#pos" → group key
  private groupVariants = new Map<string, SpellingVariant[]>(); // group key → variants
  private per: Map<string, Word> | null = null;
  private built = false;
  private warming: Promise<void> | null = null;

  constructor(private db: Db) {}

  private ingest(r: Row): void {
    const k = `${r.verse_key}#${r.word_position}`;
    let e = this.per!.get(k);
    if (!e) { e = { vk: r.verse_key, pos: r.word_position, surface: "", raw: "", lemma: "", lemmas: new Set() }; this.per!.set(k, e); }
    e.surface += r.form_arabic ?? "";
    if (!e.raw && r.raw_features) e.raw = r.raw_features;
    if (!e.lemma && r.lemma_buckwalter) e.lemma = r.lemma_buckwalter;
    if (r.lemma_buckwalter) e.lemmas.add(r.lemma_buckwalter);
  }

  private finalize(): void {
    const groups = new Map<string, {
      rasm: Map<string, { surface: string; count: number; verses: string[] }>;
      words: { vk: string; pos: number; rasm: string }[];
    }>();
    for (const w of this.per!.values()) {
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
      this.groupVariants.set(gk, [...g.rasm.values()].sort((a, b) => b.count - a.count));
      const majorityRasm = [...g.rasm.entries()].sort((a, b) => b[1].count - a[1].count)[0]![0];
      for (const { vk, pos, rasm } of g.words) {
        this.groupOf.set(`${vk}#${pos}`, gk);
        if (rasm === majorityRasm) continue; // flag only the minority (unusual) spelling
        this.verses.add(vk);
        this.wordKeys.add(`${vk}#${pos}`);
      }
    }
    this.per = null;
    this.built = true;
  }

  build(): this {
    if (this.built) return this;
    this.per = new Map();
    for (const r of this.db.query<Row>(SQL)) this.ingest(r);
    this.finalize();
    return this;
  }

  /** Non-blocking build: async read + chunked processing that yields to the UI. */
  warmup(): Promise<void> {
    if (this.built) return Promise.resolve();
    if (this.warming) return this.warming;
    this.warming = (async () => {
      const rows = await this.db.queryAsync<Row>(SQL);
      this.per = new Map();
      for (let i = 0; i < rows.length; i++) {
        this.ingest(rows[i]!);
        if ((i & 1023) === 0) await tick();
      }
      this.finalize();
    })();
    return this.warming;
  }

  versesInChapter(chapterId: number): Set<string> {
    this.build();
    const pfx = `${chapterId}:`;
    const out = new Set<string>();
    for (const v of this.verses) if (v.startsWith(pfx)) out.add(v);
    return out;
  }

  /** Word positions in a verse written with a minority rasm (the ✍-marked ones). */
  wordsInVerse(verseKey: string): number[] {
    this.build();
    const pfx = `${verseKey}#`;
    const out: number[] = [];
    for (const k of this.wordKeys) if (k.startsWith(pfx)) out.push(Number(k.slice(pfx.length)));
    return out.sort((a, b) => a - b);
  }

  /** The rasm variants of the word at (verseKey, wordPosition), from the same
   *  grouping the ✍ marks use — so the two always agree. [] when no variation. */
  variantsForWord(verseKey: string, wordPosition: number): SpellingVariant[] {
    this.build();
    const gk = this.groupOf.get(`${verseKey}#${wordPosition}`);
    return gk ? this.groupVariants.get(gk) ?? [] : [];
  }
}
