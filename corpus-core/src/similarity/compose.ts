// Composite similarity — port of similarity/compose.py.
// total = w_overlap*overlap + w_phrase*phrase + w_morphology*morphology,
// over candidates sharing >= min_shared roots/lemmas with the query.

import type { CorpusDb } from "../corpus-db.js";
import { LexicalSimilarity, longestCommonRunSlice, round4 } from "./lexical.js";
import { MorphologySimilarity } from "./morphology.js";

export const DEFAULT_WEIGHTS = { overlap: 0.45, phrase: 0.3, morphology: 0.25 };

export interface CompositeMatch {
  verse_key: string;
  chapter_id: number;
  verse_number: number;
  text: string | null;
  score: number;
  overlap: number;
  phrase: number;
  morphology: number;
  shared: string[];
  pattern: string[];
  phrase_run: string[];
}

export class SimilarityEngine {
  lex: LexicalSimilarity;
  morph: MorphologySimilarity;

  constructor(db: CorpusDb, unit: "root" | "lemma" = "root", posLevel: "class" | "tag" = "class") {
    this.lex = new LexicalSimilarity(db, unit);
    this.morph = new MorphologySimilarity(db, posLevel);
  }

  /** Both indexes, built once each (their builds are memoised and share concurrent callers). */
  async build(): Promise<void> {
    await Promise.all([this.lex.build(), this.morph.build()]);
  }

  /** Pure ranking over the built indexes — call build() first. */
  private rank(
    lexSeq: string[],
    posSeq: string[],
    opts: { topK: number; weights?: Partial<typeof DEFAULT_WEIGHTS>; minShared: number; exclude?: string },
  ): CompositeMatch[] {
    const w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
    const qvec = this.lex.weightedVec(lexSeq);
    const qset = new Set(lexSeq);

    // candidate verses: share >= minShared lexical tokens with the query
    const candCounts = new Map<string, number>();
    for (const tok of qset) {
      for (const vk of this.lex.postings.get(tok) ?? []) {
        candCounts.set(vk, (candCounts.get(vk) ?? 0) + 1);
      }
    }
    const candidates: string[] = [];
    for (const [vk, c] of candCounts) if (c >= opts.minShared) candidates.push(vk);

    const results: CompositeMatch[] = [];
    for (const vk of candidates) {
      if (opts.exclude != null && vk === opts.exclude) continue;
      const cseq = this.lex.seq.get(vk)!;
      const overlap = LexicalSimilarity.cosine(qvec, this.lex.weightedVec(cseq));
      const phrase = LexicalSimilarity.phraseScore(lexSeq, cseq);
      const cpos = this.morph.seq.get(vk) ?? [];
      const morph = posSeq.length ? this.morph.patternScore(posSeq, cpos) : 0.0;
      const total = w.overlap * overlap + w.phrase * phrase + w.morphology * morph;
      if (total <= 0) continue;
      const cset = new Set(cseq);
      const shared: string[] = [];
      for (const t of qset) if (cset.has(t)) shared.push(this.lex.ar.get(t) ?? t);
      const run = longestCommonRunSlice(lexSeq, cseq);
      const phraseRun = run.map((t) => this.lex.ar.get(t) ?? t);
      const [ch, vn, text] = this.lex.meta.get(vk)!;
      results.push({
        verse_key: vk, chapter_id: ch, verse_number: vn, text,
        score: round4(total), overlap: round4(overlap), phrase: round4(phrase),
        morphology: round4(morph), shared, pattern: [...cpos], phrase_run: phraseRun,
      });
    }
    // score desc, then verse_key asc as a deterministic tiebreaker so the
    // output is stable regardless of candidate iteration order.
    results.sort((a, b) =>
      b.score - a.score ||
      (a.verse_key < b.verse_key ? -1 : a.verse_key > b.verse_key ? 1 : 0),
    );
    return results.slice(0, opts.topK);
  }

  async similarVerses(
    verseKey: string,
    opts: { topK?: number; weights?: Partial<typeof DEFAULT_WEIGHTS>; minShared?: number } = {},
  ): Promise<CompositeMatch[]> {
    await this.build();
    const lexSeq = this.lex.seq.get(verseKey);
    if (!lexSeq) return [];
    const posSeq = this.morph.seq.get(verseKey) ?? [];
    return this.rank(lexSeq, posSeq, {
      topK: opts.topK ?? 20, weights: opts.weights, minShared: opts.minShared ?? 1, exclude: verseKey,
    });
  }

  async similarToTokens(
    rootSeq: string[],
    posSeq: string[] = [],
    opts: { topK?: number; weights?: Partial<typeof DEFAULT_WEIGHTS>; minShared?: number; exclude?: string } = {},
  ): Promise<CompositeMatch[]> {
    await this.build();
    if (!rootSeq.length) return [];
    return this.rank(rootSeq, posSeq, {
      topK: opts.topK ?? 20, weights: opts.weights, minShared: opts.minShared ?? 1, exclude: opts.exclude,
    });
  }
}
