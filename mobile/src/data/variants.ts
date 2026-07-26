// Precomputed index of āyāt that contain a word written with more than one rasm
// somewhere in the mushaf — powers the subtle ✍ reader mark. Same grouping as
// spellingVariantsForWord (raw_features + skeleton → distinct rasm keys), built
// once over the whole corpus and cached. `warmup()` builds it off the main
// thread (async read + chunked processing) so the reader never freezes.

import type { Db } from "./db";
import { rasmKey, skeleton } from "./spellings";

type Row = { verse_key: string; word_position: number; form_arabic: string | null; segment_number: number; raw_features: string | null };
const SQL = `SELECT verse_key, word_position, form_arabic, segment_number, raw_features
  FROM word_segments WHERE segment_type = 'STEM' AND raw_features IS NOT NULL
  ORDER BY verse_key, word_position, segment_number`;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class VariantIndex {
  private verses = new Set<string>();   // verse keys containing a variant-spelled word
  private wordKeys = new Set<string>(); // "verse#position" of the variant words
  private per: Map<string, { vk: string; surface: string; raw: string }> | null = null;
  private built = false;
  private warming: Promise<void> | null = null;

  constructor(private db: Db) {}

  private ingest(r: Row): void {
    const k = `${r.verse_key}#${r.word_position}`;
    const cur = this.per!.get(k);
    this.per!.set(k, {
      vk: r.verse_key,
      surface: (cur?.surface ?? "") + (r.form_arabic ?? ""),
      raw: r.raw_features ?? cur?.raw ?? "",
    });
  }

  private finalize(): void {
    const groups = new Map<string, { rasms: Set<string>; members: string[] }>();
    for (const [k, { surface, raw }] of this.per!) {
      const rk = rasmKey(surface);
      const gk = `${raw}${skeleton(rk)}`;
      let g = groups.get(gk);
      if (!g) { g = { rasms: new Set(), members: [] }; groups.set(gk, g); }
      g.rasms.add(rk);
      g.members.push(k);
    }
    for (const g of groups.values()) {
      if (g.rasms.size > 1) {
        for (const k of g.members) {
          this.verses.add(k.split("#")[0]!);
          this.wordKeys.add(k);
        }
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

  /** Word positions in a verse that are written with more than one rasm. */
  wordsInVerse(verseKey: string): number[] {
    this.build();
    const pfx = `${verseKey}#`;
    const out: number[] = [];
    for (const k of this.wordKeys) if (k.startsWith(pfx)) out.push(Number(k.slice(pfx.length)));
    return out.sort((a, b) => a - b);
  }
}
