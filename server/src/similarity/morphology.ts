// M3 — Morphology-pattern similarity. Port of similarity/morphology.py.
// IDF-weighted cosine over POS bigrams+trigrams + longest common POS run.

import type { Db } from "../db.js";
import { longestCommonRun } from "./lexical.js";

const NGRAM_WEIGHT = 0.7;
const RUN_WEIGHT = 0.3;

function ngrams(seq: string[]): string[] {
  const grams: string[] = [];
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= seq.length; i++) grams.push(seq.slice(i, i + n).join(""));
  }
  return grams;
}

export class MorphologySimilarity {
  level: "class" | "tag";
  seq = new Map<string, string[]>();
  meta = new Map<string, [number, number, string | null]>();
  private idf = new Map<string, number>();
  private built = false;

  constructor(private db: Db, level: "class" | "tag" = "class") {
    this.level = level;
  }

  build(): this {
    if (this.built) return this;
    const col = this.level === "class" ? "pos_class" : "pos";
    const rows = this.db.query<{
      verse_key: string; pos: string; chapter_id: number; verse_number: number; text: string | null;
    }>(
      `SELECT w.verse_key, w.${col} AS pos, v.chapter_id, v.verse_number,
              v.text_uthmani_simple AS text
       FROM words w
       LEFT JOIN verses v ON v.id = w.verse_id
       WHERE w.${col} IS NOT NULL
       ORDER BY w.verse_key, w.position`,
    );
    for (const r of rows) {
      const vk = r.verse_key;
      let s = this.seq.get(vk);
      if (!s) { s = []; this.seq.set(vk, s); }
      s.push(r.pos);
      if (!this.meta.has(vk)) this.meta.set(vk, [r.chapter_id, r.verse_number, r.text]);
    }
    // document frequency of each n-gram → IDF
    const df = new Map<string, number>();
    for (const s of this.seq.values()) {
      for (const g of ngrams(s)) df.set(g, (df.get(g) ?? 0) + 1);
    }
    const n = this.seq.size || 1;
    for (const [g, c] of df) this.idf.set(g, Math.log(n / c) + 1.0);
    this.built = true;
    return this;
  }

  private ngramVec(seq: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const g of ngrams(seq)) tf.set(g, (tf.get(g) ?? 0) + 1);
    const out = new Map<string, number>();
    for (const [g, c] of tf) out.set(g, c * (this.idf.get(g) ?? 1.0));
    return out;
  }

  private static cosine(a: Map<string, number>, b: Map<string, number>): number {
    if (a.size === 0 || b.size === 0) return 0.0;
    if (a.size > b.size) [a, b] = [b, a];
    let dot = 0;
    for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
    if (dot === 0) return 0.0;
    let na = 0; for (const v of a.values()) na += v * v;
    let nb = 0; for (const v of b.values()) nb += v * v;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  patternScore(q: string[], c: string[]): number {
    if (!q.length || !c.length) return 0.0;
    const ngram = MorphologySimilarity.cosine(this.ngramVec(q), this.ngramVec(c));
    const run = longestCommonRun(q, c) / q.length;
    return NGRAM_WEIGHT * ngram + RUN_WEIGHT * run;
  }

  posFor(verseKey: string): string[] {
    this.build();
    return [...(this.seq.get(verseKey) ?? [])];
  }
}
