// Composite similarity — on-device port of server/src/similarity/compose.ts.
// total = w_overlap*overlap + w_phrase*phrase + w_morphology*morphology, over
// candidates sharing >= minShared roots/lemmas with the query.

import type { Db } from "../data/db";
import type { CompositeMatch } from "../types";
import { LexicalSimilarity, longestCommonRunSlice, round4 } from "./lexical";
import { MorphologySimilarity } from "./morphology";

export const DEFAULT_WEIGHTS = { overlap: 0.45, phrase: 0.3, morphology: 0.25 };

export class SimilarityEngine {
  lex: LexicalSimilarity;
  morph: MorphologySimilarity;
  private built = false;

  constructor(db: Db, unit: "root" | "lemma" = "root", posLevel: "class" | "tag" = "class") {
    this.lex = new LexicalSimilarity(db, unit);
    this.morph = new MorphologySimilarity(db, posLevel);
  }

  build(): this {
    if (!this.built) {
      this.lex.build();
      this.morph.build();
      this.built = true;
    }
    return this;
  }

  private rank(
    lexSeq: string[],
    posSeq: string[],
    opts: { topK: number; weights?: Partial<typeof DEFAULT_WEIGHTS>; minShared: number; exclude?: string },
  ): CompositeMatch[] {
    this.build();
    const w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
    const qvec = this.lex.weightedVec(lexSeq);
    const qset = new Set(lexSeq);

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
    results.sort((a, b) =>
      b.score - a.score ||
      (a.verse_key < b.verse_key ? -1 : a.verse_key > b.verse_key ? 1 : 0),
    );
    return results.slice(0, opts.topK);
  }

  similarVerses(
    verseKey: string,
    opts: { topK?: number; weights?: Partial<typeof DEFAULT_WEIGHTS>; minShared?: number } = {},
  ): CompositeMatch[] {
    this.build();
    const lexSeq = this.lex.seq.get(verseKey);
    if (!lexSeq) return [];
    const posSeq = this.morph.seq.get(verseKey) ?? [];
    return this.rank(lexSeq, posSeq, {
      topK: opts.topK ?? 20, weights: opts.weights, minShared: opts.minShared ?? 1, exclude: verseKey,
    });
  }

  similarToTokens(
    rootSeq: string[],
    posSeq: string[] = [],
    opts: { topK?: number; weights?: Partial<typeof DEFAULT_WEIGHTS>; minShared?: number; exclude?: string } = {},
  ): CompositeMatch[] {
    this.build();
    if (!rootSeq.length) return [];
    return this.rank(rootSeq, posSeq, {
      topK: opts.topK ?? 20, weights: opts.weights, minShared: opts.minShared ?? 1, exclude: opts.exclude,
    });
  }
}
