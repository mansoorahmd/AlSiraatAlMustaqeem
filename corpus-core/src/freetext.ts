// M4 — Free-text Arabic query. Port of quran_api/freetext.py.
// Resolve each Arabic word to its most common Quranic root + POS, then route
// the root/POS sequences through the composite similarity engine.

import type { CorpusDb } from "./corpus-db.js";
import { once } from "./corpus-db.js";
import { foldArabic, affixTrials, tokenizeArabic } from "./text/normalize.js";
import { SimilarityEngine, type CompositeMatch, type DEFAULT_WEIGHTS } from "./similarity/compose.js";

export interface ResolvedWord {
  token: string;
  folded: string;
  root_buckwalter: string | null;
  root_arabic: string | null;
  pos_class: string | null;
  via: string | null;
}

export interface FreeTextResultDict {
  query: string;
  resolved: { token: string; root: string | null; pos: string | null }[];
  unresolved: string[];
  matches: CompositeMatch[];
}

type CountMap = Map<string, Map<string, number>>;

class FreeTextResolver {
  private root: CountMap = new Map();
  private pos: CountMap = new Map();
  private rootSk: CountMap = new Map();
  private posSk: CountMap = new Map();
  private ar = new Map<string, string>();
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.build = once(() => this.load());
  }

  private static skeleton(folded: string): string {
    return folded.replaceAll("ا", "");
  }

  private async load(): Promise<void> {
    // "first seen wins" below depends on row order, so it is pinned: ORDER BY id is the order
    // SQLite always returned (rowid) and Postgres otherwise wouldn't promise.
    const rows = await this.db.query<{ lemma_arabic: string; root_buckwalter: string; root_arabic: string | null; pos_class: string | null }>(
      `SELECT lemma_arabic, root_buckwalter, root_arabic, pos_class
       FROM words WHERE root_buckwalter IS NOT NULL AND lemma_arabic IS NOT NULL
       ORDER BY id`,
    );
    const bump = (m: CountMap, key: string, val: string) => {
      let inner = m.get(key);
      if (!inner) { inner = new Map(); m.set(key, inner); }
      inner.set(val, (inner.get(val) ?? 0) + 1);
    };
    for (const r of rows) {
      const f = foldArabic(r.lemma_arabic);
      const sk = FreeTextResolver.skeleton(f);
      const rb = r.root_buckwalter;
      const pc = r.pos_class;
      for (const [rootIdx, posIdx, key] of [
        [this.root, this.pos, f] as const,
        [this.rootSk, this.posSk, sk] as const,
      ]) {
        bump(rootIdx, key, rb);
        if (pc) bump(posIdx, key, pc);
      }
      if (!this.ar.has(rb) && r.root_arabic) this.ar.set(rb, r.root_arabic);
    }
  }

  private static best(rootIdx: CountMap, posIdx: CountMap, key: string): [string, string | null] {
    const rootCounts = rootIdx.get(key)!;
    // argmax by count (first-seen wins ties, matching Python max stability)
    let rb = "";
    let bestC = -Infinity;
    for (const [k, c] of rootCounts) if (c > bestC) { bestC = c; rb = k; }
    const posCounts = posIdx.get(key);
    let pos: string | null = null;
    if (posCounts) {
      let bp = -Infinity;
      for (const [k, c] of posCounts) if (c > bp) { bp = c; pos = k; }
    }
    return [rb, pos || null];
  }

  /** Pure lookup over the built index — call build() first. */
  resolveToken(token: string): ResolvedWord {
    const folded = foldArabic(token);
    const trials = affixTrials(folded);
    for (const trial of trials) {
      if (this.root.has(trial)) {
        const [rb, pos] = FreeTextResolver.best(this.root, this.pos, trial);
        return { token, folded, root_buckwalter: rb, root_arabic: this.ar.get(rb) ?? null, pos_class: pos, via: trial };
      }
    }
    for (const trial of trials) {
      const sk = FreeTextResolver.skeleton(trial);
      if (sk.length >= 2 && this.rootSk.has(sk)) {
        const [rb, pos] = FreeTextResolver.best(this.rootSk, this.posSk, sk);
        return { token, folded, root_buckwalter: rb, root_arabic: this.ar.get(rb) ?? null, pos_class: pos, via: `~${sk}` };
      }
    }
    return { token, folded, root_buckwalter: null, root_arabic: null, pos_class: null, via: null };
  }

  resolve(text: string): ResolvedWord[] {
    return tokenizeArabic(text).map((t) => this.resolveToken(t));
  }
}

export class FreeTextSearch {
  private resolver: FreeTextResolver;
  private engine: SimilarityEngine;

  constructor(db: CorpusDb, unit: "root" | "lemma" = "root", posLevel: "class" | "tag" = "class") {
    this.resolver = new FreeTextResolver(db);
    this.engine = new SimilarityEngine(db, unit, posLevel);
  }

  async build(): Promise<void> {
    await Promise.all([this.resolver.build(), this.engine.build()]);
  }

  async search(
    text: string,
    opts: { topK?: number; weights?: Partial<typeof DEFAULT_WEIGHTS>; minShared?: number } = {},
  ): Promise<FreeTextResultDict> {
    await this.build();
    const resolved = this.resolver.resolve(text);
    const rootSeq = resolved.filter((w) => w.root_buckwalter).map((w) => w.root_buckwalter!);
    const posSeq = resolved.filter((w) => w.root_buckwalter && w.pos_class).map((w) => w.pos_class!);
    const matches = await this.engine.similarToTokens(rootSeq, posSeq, {
      topK: opts.topK ?? 20, weights: opts.weights, minShared: opts.minShared ?? 1,
    });
    return {
      query: text,
      resolved: resolved.filter((w) => w.root_buckwalter).map((w) => ({ token: w.token, root: w.root_arabic, pos: w.pos_class })),
      unresolved: resolved.filter((w) => !w.root_buckwalter).map((w) => w.token),
      matches,
    };
  }
}
