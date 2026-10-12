// Spelling / rasm variants — new feature; validated against known variants.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { corpusTestApp } from "./corpus-app.js";
import { rasmKey } from "../src/spellings.js";

let app: Hono;
const spelling = async (key: string, pos: number) =>
  (await (await app.request(`/corpus/verses/${key}/spelling?pos=${pos}`)).json()) as {
    surface: string; count: number; verses: string[]; here?: boolean;
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

  it("a hamza seat changed only by what is attached is not a variant", async () => {
    // إِذَا after the question prefix is written أَءِذَا (13:5 w5): the same spelling
    expect(await spelling("39:71", 8)).toEqual([]);
    expect(await spelling("13:5", 5)).toEqual([]);
    // لِقَآئِهِۦ (18:105 w6) is لِقَآء with a pronoun on it, counted with لِقَآءِ (39:71 w24)
    const attached = await spelling("18:105", 6);
    expect(attached.find((v) => v.here)?.surface).toBe((await spelling("39:71", 24)).find((v) => v.here)?.surface);
    // ...but بِلِقَآئِ رَبِّهِمْ (30:8 w20), with nothing after it, is a genuine variant
    const bare = await spelling("30:8", 20);
    expect(bare.length).toBe(2);
    expect(rasmKey(bare.find((v) => v.here)!.surface)).toBe("لقائ");
  });

  it("tāʾ-marbūṭa and the long tāʾ stay variants (خَزَنَتُهَا, 39:71 w14)", async () => {
    expect((await spelling("39:71", 14)).map((v) => rasmKey(v.surface))).toEqual(["خزنت", "خزنة"]);
  });

  it("`here` marks the spelling this occurrence is written in", async () => {
    const v = await spelling("39:71", 33); // عَلَى without the small alif, before ٱلْكَٰفِرِينَ
    expect(v.filter((x) => x.here).length).toBe(1);
    expect(rasmKey(v.find((x) => x.here)!.surface)).toBe("على");
    expect(v[0]!.here).toBe(false); // the usual spelling is the other one
  });

  it("an ayah lists the word written unusually, and its other variant words apart", async () => {
    const ch = (await (await app.request("/corpus/chapters/39/variants")).json()) as
      { verse_key: string; positions: number[]; common: number[] }[];
    const v = ch.find((x) => x.verse_key === "39:71")!;
    expect(v.positions).toEqual([33]);
    expect(v.common).toEqual(expect.arrayContaining([4, 12, 14, 21, 24]));
    expect(v.common).not.toContain(8);
    expect(ch.every((x) => x.positions.length > 0)).toBe(true);
  });

  it("missing pos → 422", async () => {
    expect((await app.request("/corpus/verses/1:1/spelling")).status).toBe(422);
  });
});
