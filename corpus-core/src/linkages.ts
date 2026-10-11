// M1.5 — Root linkages (co-occurrence). Port of quran_api/linkages.py.
//
// Runs over either corpus engine (corpus-db.ts). Two things here are portable on purpose:
// root_arabic is GROUPed alongside root_buckwalter (Postgres refuses a bare column; each
// Buckwalter root has exactly one Arabic spelling, so the groups are unchanged), and the shared-
// verse walk keeps MUSHAF order before its limit (DISTINCT alone has no order on Postgres).

import type { CorpusDb } from "./corpus-db.js";
import { once } from "./corpus-db.js";
import { normalizeRoot } from "./text/normalize.js";
import { round4 } from "./similarity/lexical.js";
import { SCRIPTS } from "./content.js";

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
  private df = new Map<string, number>();
  private occ = new Map<string, number>();
  private nVerses = 0;
  private ensure: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.ensure = once(async () => {
      for (const r of await this.db.query<{ root_buckwalter: string; df: number }>(
        `SELECT root_buckwalter, COUNT(DISTINCT verse_key) AS df
         FROM word_occurrences WHERE root_buckwalter IS NOT NULL
         GROUP BY root_buckwalter`,
      )) this.df.set(r.root_buckwalter, r.df);
      for (const r of await this.db.query<{ root_buckwalter: string; n: number }>(
        `SELECT root_buckwalter, COUNT(*) AS n
         FROM word_occurrences WHERE root_buckwalter IS NOT NULL
         GROUP BY root_buckwalter`,
      )) this.occ.set(r.root_buckwalter, r.n);
      this.nVerses = (await this.db.scalar<number>(
        `SELECT COUNT(DISTINCT verse_key) FROM word_occurrences WHERE root_buckwalter IS NOT NULL`,
      ))!;
    });
  }

  async coOccurringRoots(
    root: string,
    opts: { scope?: "ayah" | "adjacent"; window?: number; minCount?: number; limit?: number | null; sortBy?: "score" | "count" } = {},
  ): Promise<Linkage[]> {
    await this.ensure();
    const scope = opts.scope ?? "ayah";
    const sortBy = opts.sortBy ?? "score";
    const minCount = opts.minCount ?? 2;
    const bw = normalizeRoot(root);
    const links = scope === "ayah"
      ? await this.ayahLinks(bw, minCount)
      : await this.adjacentLinks(bw, opts.window ?? 1, minCount);

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

  private async ayahLinks(bw: string, minCount: number): Promise<Linkage[]> {
    const dfA = this.df.get(bw);
    if (!dfA) return [];
    const N = this.nVerses;
    const rows = await this.db.query<{ bw: string; ar: string; co: number }>(
      `SELECT wo.root_buckwalter AS bw, wo.root_arabic AS ar,
              COUNT(DISTINCT wo.verse_key) AS co
       FROM word_occurrences wo
       JOIN (SELECT DISTINCT verse_key FROM word_occurrences
             WHERE root_buckwalter = ?) t ON t.verse_key = wo.verse_key
       WHERE wo.root_buckwalter IS NOT NULL AND wo.root_buckwalter != ?
       GROUP BY wo.root_buckwalter, wo.root_arabic`,
      [bw, bw],
    );
    const out: Linkage[] = [];
    for (const r of rows) {
      if (r.co < minCount) continue;
      const dfB = this.df.get(r.bw) ?? 0;
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

  /** The āyāt where two roots BOTH occur, in mushaf order — the evidence behind
   *  a collocation, so "keeps company with" can be read rather than trusted.
   *
   *  Intersects in JS on purpose. Doing it in SQL against the word_occurrences
   *  VIEW (either correlated EXISTS or `IN (… INTERSECT …)`) made node:sqlite
   *  plan a pathological nested loop and hang, though the same SQL is instant in
   *  other SQLite builds. Two indexed lookups over word_segments are predictable.
   *  Each list is in mushaf order (first segment id), so the limit keeps the SAME verses on
   *  both engines.
   */
  async sharedVerses(a: string, b: string, script = "uthmani", limit = 300): Promise<{
    verse_key: string; chapter_id: number; verse_number: number; text: string | null;
  }[]> {
    const keysFor = async (root: string) =>
      (await this.db.query<{ verse_key: string }>(
        `SELECT verse_key FROM word_segments WHERE root_buckwalter = ? AND segment_type = 'STEM'
         GROUP BY verse_key ORDER BY MIN(id)`,
        [root],
      )).map((r) => r.verse_key);

    const inB = new Set(await keysFor(b));
    const shared = (await keysFor(a)).filter((k) => inB.has(k)).slice(0, limit);
    if (shared.length === 0) return [];

    const col = SCRIPTS[script] ?? "text_uthmani";
    const holes = shared.map(() => "?").join(",");
    return this.db.query(
      `SELECT verse_key, chapter_id, verse_number, ${col} AS text
       FROM verses WHERE verse_key IN (${holes})
       ORDER BY chapter_id, verse_number`,
      shared,
    );
  }

  private async adjacentLinks(bw: string, window: number, minCount: number): Promise<Linkage[]> {
    const occA = this.occ.get(bw);
    if (!occA) return [];
    const rows = await this.db.query<{ bw: string; ar: string; co: number }>(
      `SELECT b.root_buckwalter AS bw, b.root_arabic AS ar, COUNT(*) AS co
       FROM word_occurrences a
       JOIN word_occurrences b
         ON a.verse_key = b.verse_key
        AND b.word_position BETWEEN a.word_position - ? AND a.word_position + ?
        AND b.word_position != a.word_position
       WHERE a.root_buckwalter = ? AND b.root_buckwalter IS NOT NULL AND b.root_buckwalter != ?
       GROUP BY b.root_buckwalter, b.root_arabic`,
      [window, window, bw, bw],
    );
    let totalOcc = 0;
    for (const v of this.occ.values()) totalOcc += v;
    const out: Linkage[] = [];
    for (const r of rows) {
      if (r.co < minCount) continue;
      const occB = this.occ.get(r.bw) ?? 0;
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
