// Spelling / rasm variants — new feature; validated against known variants.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { corpusTestApp } from "./corpus-app.js";
import { rasmKey } from "../src/spellings.js";

let app: Hono;
const spelling = async (key: string, pos: number) =>
  (await (await app.request(`/corpus/verses/${key}/spelling?pos=${pos}`)).json()) as {
    surface: string; count: number; verses: string[];
  }[];

beforeAll(async () => { app = corpusTestApp(); });

describe("spelling variants", () => {
  it("ʿalā (2:5 w2) is written with and without the dagger-alif", async () => {
    const v = await spelling("2:5", 2);
    expect(v.length).toBeGreaterThan(1);
    // most-common first, counts present
    expect(v[0]!.count).toBeGreaterThanOrEqual(v[1]!.count);
    expect(v[0]!.verses.length).toBeGreaterThan(0);
  });

  it("ṣalāh: the archaic wāw spelling صلوٰة and the long-alif صلات are one variant group", async () => {
    // ص ل و + dagger-alif(U+0670) + tāʾ-marbūṭa  vs  ص ل ا ت (open tāʾ)
    const WAW = "صلوٰة";
    const ALIF = "صلات";
    // 13:22 w7 is standalone ٱلصَّلَوٰة (wāw); 23:2 w4 is صَلَاتِ (long alif)
    const fromWaw = await spelling("13:22", 7);
    expect(fromWaw.length).toBeGreaterThanOrEqual(2);
    expect(fromWaw.map((v) => rasmKey(v.surface))).toEqual(expect.arrayContaining([WAW, ALIF]));
    // the alif occurrence reports the same group (the two always agree)
    const fromAlif = await spelling("23:2", 4);
    expect(fromAlif.map((v) => rasmKey(v.surface))).toEqual(expect.arrayContaining([WAW, ALIF]));
  });

  it("qahhār: one group across cases — ×1 dagger-alif (13:16), ×5 full alif", async () => {
    // 13:16 w45 is nominative قَهَّٰرُ; 14:48 w10 is genitive قَهَّارِ — the same word
    for (const [key, pos] of [["13:16", 45], ["14:48", 10]] as const) {
      const v = await spelling(key, pos);
      expect(v.map((x) => [rasmKey(x.surface), x.count])).toEqual([["قهار", 5], ["قهٰر", 1]]);
      expect(v[1]!.verses).toEqual(["13:16"]);
    }
  });

  it("a word with no variation returns no variants", async () => {
    const v = await spelling("1:1", 1); // bism — one spelling only
    expect(v.length).toBe(0);
  });

  it("a compound (مِمَّا, 2:3 w6) is not treated as a spelling variant", async () => {
    expect((await spelling("2:3", 6)).length).toBe(0);
  });

  it("missing pos → 422", async () => {
    expect((await app.request("/corpus/verses/1:1/spelling")).status).toBe(422);
  });
});
