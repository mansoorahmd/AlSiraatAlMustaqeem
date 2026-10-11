// Lexical similarity — on-device port of server/src/similarity/lexical.ts.
// TF-IDF cosine over a verse's root/lemma bag + an order-aware phrase score.

import type { Db } from "../data/db";

export const DEFAULT_LEX_WEIGHTS = { overlap: 0.6, phrase: 0.4 };

export function round4(x: number): number {
  return Math.round((x + Number.EPSILON) * 1e4) / 1e4;
}

export class LexicalSimilarity {
  unit: "root" | "lemma";
  seq = new Map<string, string[]>();
  meta = new Map<string, [number, number, string | null]>();
  ar = new Map<string, string>();
  idf = new Map<string, number>();
  postings = new Map<string, Set<string>>();
  private built = false;

  constructor(private db: Db, unit: "root" | "lemma" = "root") {
    this.unit = unit;
  }

  build(): this {
    if (this.built) return this;
    const col = this.unit === "root" ? "root_buckwalter" : "lemma_buckwalter";
    const arCol = this.unit === "root" ? "root_arabic" : "lemma_arabic";
    const rows = this.db.query<{
      verse_key: string; tok: string; tok_ar: string | null;
      chapter_id: number; verse_number: number; text: string | null;
    }>(
      `SELECT wo.verse_key, wo.${col} AS tok, wo.${arCol} AS tok_ar,
              wo.chapter_id, wo.verse_number, v.text_uthmani AS text
       FROM word_occurrences wo
       LEFT JOIN verses v ON v.verse_key = wo.verse_key
       WHERE wo.${col} IS NOT NULL
       ORDER BY wo.chapter_id, wo.verse_number, wo.word_position`,
    );
    for (const r of rows) {
      const vk = r.verse_key;
      let s = this.seq.get(vk);
      if (!s) { s = []; this.seq.set(vk, s); }
      s.push(r.tok);
      if (!this.meta.has(vk)) this.meta.set(vk, [r.chapter_id, r.verse_number, r.text]);
      if (!this.ar.has(r.tok) && r.tok_ar) this.ar.set(r.tok, r.tok_ar);
      let p = this.postings.get(r.tok);
      if (!p) { p = new Set(); this.postings.set(r.tok, p); }
      p.add(vk);
    }
    const n = this.seq.size || 1;
    for (const [tok, verses] of this.postings) this.idf.set(tok, Math.log(n / verses.size) + 1.0);
    this.built = true;
    return this;
  }

  weightedVec(seq: Iterable<string>): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of seq) tf.set(t, (tf.get(t) ?? 0) + 1);
    const out = new Map<string, number>();
    for (const [t, c] of tf) out.set(t, c * (this.idf.get(t) ?? 1.0));
    return out;
  }

  static cosine(a: Map<string, number>, b: Map<string, number>): number {
    if (a.size === 0 || b.size === 0) return 0.0;
    if (a.size > b.size) [a, b] = [b, a];
    let dot = 0;
    for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
    if (dot === 0) return 0.0;
    let na = 0; for (const v of a.values()) na += v * v;
    let nb = 0; for (const v of b.values()) nb += v * v;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  static phraseScore(q: string[], c: string[]): number {
    if (!q.length || !c.length) return 0.0;
    const qb: string[] = [];
    for (let i = 0; i + 1 < q.length; i++) qb.push(q[i]! + " " + q[i + 1]!);
    const cb = new Set<string>();
    for (let i = 0; i + 1 < c.length; i++) cb.add(c[i]! + " " + c[i + 1]!);
    const bigramRatio = qb.length ? qb.filter((g) => cb.has(g)).length / qb.length : 0.0;
    const run = longestCommonRun(q, c);
    const runRatio = run / q.length;
    return 0.5 * bigramRatio + 0.5 * runRatio;
  }

  sequenceFor(verseKey: string): string[] {
    this.build();
    return [...(this.seq.get(verseKey) ?? [])];
  }
}

export function longestCommonRun(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      if (ai === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

export function longestCommonRunSlice(a: string[], b: string[]): string[] {
  if (!a.length || !b.length) return [];
  let prev = new Array(b.length + 1).fill(0);
  let best = 0;
  let endI = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      if (ai === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) { best = cur[j]; endI = i; }
      }
    }
    prev = cur;
  }
  return best ? a.slice(endI - best, endI) : [];
}
