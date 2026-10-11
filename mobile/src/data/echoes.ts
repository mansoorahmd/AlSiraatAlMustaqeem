// Verbatim echoes — on-device port of server/src/echoes.ts (V10). Finds
// contiguous phrases that recur word-for-word across the Quran (refrains,
// recurring formulas, the basmala). Same algorithm as the server.

import type { Db } from "./db";
import type { Echo } from "../types";
import { foldArabic } from "../text/normalize";

const MIN_WORDS = 3; // shortest phrase considered an "echo"
const cnum = (k: string) => parseInt(k.split(":")[0] ?? "", 10) || 0;

type Row = { verse_key: string; chapter_id: number; verse_number: number; t: string | null };
const SQL = `SELECT verse_key, chapter_id, verse_number, text_imlaei_simple AS t FROM verses ORDER BY chapter_id, verse_number`;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export class EchoIndex {
  private words = new Map<string, string[]>();
  private meta = new Map<string, [number, number]>();
  private gram3 = new Map<string, string[]>();
  private withEcho = new Set<string>();
  private tmp: Map<string, Set<string>> | null = null;
  private built = false;
  private warming: Promise<void> | null = null;

  constructor(private db: Db) {}

  private ingest(r: Row): void {
    const w = foldArabic(r.t ?? "").split(/\s+/).filter(Boolean);
    this.words.set(r.verse_key, w);
    this.meta.set(r.verse_key, [r.chapter_id, r.verse_number]);
    const tmp = this.tmp!;
    for (let i = 0; i + MIN_WORDS <= w.length; i++) {
      const g = w.slice(i, i + MIN_WORDS).join(" ");
      let s = tmp.get(g);
      if (!s) { s = new Set(); tmp.set(g, s); }
      s.add(r.verse_key);
    }
  }

  private finalize(): void {
    for (const [g, set] of this.tmp!) {
      if (set.size >= 2) {
        const keys = [...set];
        this.gram3.set(g, keys);
        for (const k of keys) this.withEcho.add(k);
      }
    }
    this.tmp = null;
    this.built = true;
  }

  build(): this {
    if (this.built) return this;
    this.tmp = new Map();
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
      this.tmp = new Map();
      for (let i = 0; i < rows.length; i++) {
        this.ingest(rows[i]!);
        if ((i & 511) === 0) await tick();
      }
      this.finalize();
    })();
    return this.warming;
  }

  chapterEchoes(chapterId: number): string[] {
    this.build();
    const out: string[] = [];
    for (const k of this.withEcho) if (cnum(k) === chapterId) out.push(k);
    out.sort((a, b) => this.meta.get(a)![1] - this.meta.get(b)![1]);
    return out;
  }

  private occurrences(phrase: string[], candidates: string[], self: string): { verse: string; pos: number }[] {
    const hits: { verse: string; pos: number }[] = [];
    const scan = (vk: string) => {
      const w = this.words.get(vk);
      if (!w) return;
      for (let i = 0; i + phrase.length <= w.length; i++) {
        let ok = true;
        for (let j = 0; j < phrase.length; j++) if (w[i + j] !== phrase[j]) { ok = false; break; }
        if (ok) hits.push({ verse: vk, pos: i });
      }
    };
    const seen = new Set<string>();
    for (const c of candidates) { if (!seen.has(c)) { seen.add(c); scan(c); } }
    if (!seen.has(self)) scan(self);
    return hits;
  }

  echoesForVerse(verseKey: string): Echo[] {
    this.build();
    const w = this.words.get(verseKey);
    if (!w) return [];
    const found: Echo[] = [];
    for (let s = 0; s + MIN_WORDS <= w.length; s++) {
      const base = w.slice(s, s + MIN_WORDS).join(" ");
      const cands = this.gram3.get(base);
      if (!cands) continue;
      let len = MIN_WORDS;
      let bestOcc = this.occurrences(w.slice(s, s + len), cands, verseKey);
      while (s + len + 1 <= w.length) {
        const longer = this.occurrences(w.slice(s, s + len + 1), cands, verseKey);
        const others = longer.filter((h) => !(h.verse === verseKey && h.pos === s));
        if (others.length === 0) break;
        len += 1;
        bestOcc = longer;
      }
      const others = bestOcc.filter((h) => !(h.verse === verseKey && h.pos === s));
      if (others.length === 0) continue;
      const byVerse = new Map<string, number>();
      for (const h of others) {
        const cur = byVerse.get(h.verse);
        if (cur == null || h.pos + 1 < cur) byVerse.set(h.verse, h.pos + 1);
      }
      const occurrences = [...byVerse.entries()]
        .map(([vk, start]) => ({ verseKey: vk, start }))
        .sort((a, b) => cnum(a.verseKey) - cnum(b.verseKey) || this.meta.get(a.verseKey)![1] - this.meta.get(b.verseKey)![1]);
      found.push({
        phrase: w.slice(s, s + len).join(" "),
        words: w.slice(s, s + len),
        start: s + 1,
        length: len,
        occurrences,
        count: bestOcc.length,
      });
    }
    found.sort((a, b) => b.length - a.length);
    const kept: Echo[] = [];
    for (const e of found) {
      const a1 = e.start, a2 = e.start + e.length - 1;
      const covered = kept.some((k) => k.start <= a1 && k.start + k.length - 1 >= a2);
      if (!covered) kept.push(e);
    }
    kept.sort((a, b) => a.start - b.start);
    return kept;
  }
}
