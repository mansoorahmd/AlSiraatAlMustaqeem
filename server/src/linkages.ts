// M1.5 — Root linkages (co-occurrence). Port of quran_api/linkages.py.

import type { Db } from "./db.js";
import { normalizeRoot } from "./text/normalize.js";
import { round4 } from "./similarity/lexical.js";

export interface Linkage {
  root_buckwalter: string;
  root_arabic: string;
  cooccur: number;
  score: number;
  pmi: number;
  npmi: number;
  jaccard?: number;
  cosine?: number;
}

export class RootLinkages {
  private df?: Map<string, number>;
  private occ?: Map<string, number>;
  private nVerses?: number;

  constructor(private db: Db) {}

  private docFreq(): Map<string, number> {
    if (!this.df) {
      this.df = new Map();
      for (const r of this.db.query<{ root_buckwalter: string; df: number }>(
        `SELECT root_buckwalter, COUNT(DISTINCT verse_key) AS df
         FROM word_occurrences WHERE root_buckwalter IS NOT NULL
         GROUP BY root_buckwalter`,
      )) this.df.set(r.root_buckwalter, r.df);
    }
    return this.df;
  }

  private occurrences(): Map<string, number> {
    if (!this.occ) {
      this.occ = new Map();
      for (const r of this.db.query<{ root_buckwalter: string; n: number }>(
        `SELECT root_buckwalter, COUNT(*) AS n
         FROM word_occurrences WHERE root_buckwalter IS NOT NULL
         GROUP BY root_buckwalter`,
      )) this.occ.set(r.root_buckwalter, r.n);
    }
    return this.occ;
  }

  private verseCount(): number {
    if (this.nVerses == null) {
      this.nVerses = this.db.scalar<number>(
        `SELECT COUNT(DISTINCT verse_key) FROM word_occurrences WHERE root_buckwalter IS NOT NULL`,
      )!;
    }
    return this.nVerses;
  }

  coOccurringRoots(
    root: string,
    opts: { scope?: "ayah" | "adjacent"; window?: number; minCount?: number; limit?: number | null; sortBy?: "score" | "count" } = {},
  ): Linkage[] {
    const scope = opts.scope ?? "ayah";
    const sortBy = opts.sortBy ?? "score";
    const minCount = opts.minCount ?? 2;
    const bw = normalizeRoot(root);
    let links = scope === "ayah"
      ? this.ayahLinks(bw, minCount)
      : this.adjacentLinks(bw, opts.window ?? 1, minCount);

    // sort desc by (score, cooccur) or (cooccur, score); stable, tie by bw for determinism
    links.sort((a, b) => {
      const ka = sortBy === "score" ? [a.score, a.cooccur] : [a.cooccur, a.score];
      const kb = sortBy === "score" ? [b.score, b.cooccur] : [b.cooccur, b.score];
      if (kb[0]! !== ka[0]!) return kb[0]! - ka[0]!;
      if (kb[1]! !== ka[1]!) return kb[1]! - ka[1]!;
      return a.root_buckwalter < b.root_buckwalter ? -1 : a.root_buckwalter > b.root_buckwalter ? 1 : 0;
    });
    const limit = opts.limit === undefined ? 30 : opts.limit;
    return limit != null ? links.slice(0, limit) : links;
  }

  private ayahLinks(bw: string, minCount: number): Linkage[] {
    const df = this.docFreq();
    const dfA = df.get(bw);
    if (!dfA) return [];
    const N = this.verseCount();
    const rows = this.db.query<{ bw: string; ar: string; co: number }>(
      `SELECT wo.root_buckwalter AS bw, wo.root_arabic AS ar,
              COUNT(DISTINCT wo.verse_key) AS co
       FROM word_occurrences wo
       JOIN (SELECT DISTINCT verse_key FROM word_occurrences
             WHERE root_buckwalter = ?) t ON t.verse_key = wo.verse_key
       WHERE wo.root_buckwalter IS NOT NULL AND wo.root_buckwalter != ?
       GROUP BY wo.root_buckwalter`,
      [bw, bw],
    );
    const out: Linkage[] = [];
    for (const r of rows) {
      if (r.co < minCount) continue;
      const dfB = df.get(r.bw) ?? 0;
      const [pmi, npmi] = RootLinkages.pmi(r.co, dfA, dfB, N);
      const denom = dfA + dfB - r.co;
      const jac = denom ? r.co / denom : 0.0;
      out.push({
        root_buckwalter: r.bw, root_arabic: r.ar, cooccur: r.co,
        score: round4(npmi), pmi: round4(pmi), npmi: round4(npmi), jaccard: round4(jac),
      });
    }
    return out;
  }

  private adjacentLinks(bw: string, window: number, minCount: number): Linkage[] {
    const occ = this.occurrences();
    const occA = occ.get(bw);
    if (!occA) return [];
    const rows = this.db.query<{ bw: string; ar: string; co: number }>(
      `SELECT b.root_buckwalter AS bw, b.root_arabic AS ar, COUNT(*) AS co
       FROM word_occurrences a
       JOIN word_occurrences b
         ON a.verse_key = b.verse_key
        AND b.word_position BETWEEN a.word_position - ? AND a.word_position + ?
        AND b.word_position != a.word_position
       WHERE a.root_buckwalter = ? AND b.root_buckwalter IS NOT NULL AND b.root_buckwalter != ?
       GROUP BY b.root_buckwalter`,
      [window, window, bw, bw],
    );
    let totalOcc = 0;
    for (const v of occ.values()) totalOcc += v;
    const out: Linkage[] = [];
    for (const r of rows) {
      if (r.co < minCount) continue;
      const occB = occ.get(r.bw) ?? 0;
      const cos = occA && occB ? r.co / Math.sqrt(occA * occB) : 0.0;
      const [pmi, npmi] = RootLinkages.pmi(r.co, occA, occB, totalOcc);
      out.push({
        root_buckwalter: r.bw, root_arabic: r.ar, cooccur: r.co,
        score: round4(cos), pmi: round4(pmi), npmi: round4(npmi), cosine: round4(cos),
      });
    }
    return out;
  }

  private static pmi(co: number, fa: number, fb: number, N: number): [number, number] {
    if (co <= 0 || fa <= 0 || fb <= 0 || N <= 0) return [0.0, 0.0];
    const pAb = co / N;
    const pmi = Math.log2(pAb / ((fa / N) * (fb / N)));
    const npmi = pAb < 1 ? pmi / -Math.log2(pAb) : 1.0;
    return [pmi, npmi];
  }
}
