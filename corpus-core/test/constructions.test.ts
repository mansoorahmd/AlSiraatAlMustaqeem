// Construction search: āyāt found by how their words are built. Validated against known facts of
// the text (no oracle: a new feature).

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { corpusTestApp } from "./corpus-app.js";
import { CONSTRUCTION_PRESETS, presetByName } from "../src/constructions.js";
import { foldArabic } from "../src/text/normalize.js";

let app: Hono;
const search = async (body: unknown) => {
  const res = await app.request("/corpus/construction-search", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const preset = async (name: string, limit = 500) => (await search({ ...presetByName(name)!.query, limit })).body;
const keys = (r: any): string[] => r.hits.map((h: any) => h.verse_key);

beforeAll(async () => { app = corpusTestApp(); });

describe("construction presets", () => {
  it("are listed with a label, a description and a query", async () => {
    const res = await app.request("/corpus/construction-presets");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.presets.map((p: any) => p.name)).toEqual(CONSTRUCTION_PRESETS.map((p) => p.name));
    for (const p of body.presets) {
      expect(p.label && p.description).toBeTruthy();
      expect(p.query.slots.length).toBeGreaterThan(0);
    }
    expect(body.pos.V).toBe("Verb");
    expect(body.prefixes.FUT).toBeTruthy();
  });

  it("every preset finds something", async () => {
    for (const p of CONSTRUCTION_PRESETS) expect((await preset(p.name, 1)).total, p.name).toBeGreaterThan(0);
  });

  it("تَٱللَّهِ: nine āyāt, 21:57 among them with its leading وَ", async () => {
    const r = await preset("oath-ta");
    expect(r.total).toBe(9);
    expect(r.ayahs).toBe(9);
    expect(keys(r)).toEqual(expect.arrayContaining(["12:73", "12:85", "12:91", "12:95", "21:57"]));
    const h = r.hits.find((x: any) => x.verse_key === "21:57");
    expect(h.start).toBe(1);
    expect(h.length).toBe(1);
    expect(foldArabic(h.match)).toBe("وتالله");
    expect(foldArabic(h.text).startsWith("وتالله ")).toBe(true);
  });

  it("أَرَءَيْتَ and its family: 18:63 and 25:43 among them", async () => {
    const r = await preset("a-raayta");
    expect(keys(r)).toEqual(expect.arrayContaining(["18:63", "25:43"]));
    const h = r.hits.find((x: any) => x.verse_key === "18:63");
    expect(h.start).toBe(2);   // قَالَ أَرَءَيْتَ
    expect(r.hits.every((x: any) => x.length === 1)).toBe(true);
  });

  it("سَوْفَ + verb: 12:98, the match spanning both words", async () => {
    const r = await preset("sawfa-verb");
    const h = r.hits.find((x: any) => x.verse_key === "12:98");
    expect(h).toMatchObject({ start: 2, length: 2 });   // قَالَ سَوْفَ أَسْتَغْفِرُ
    expect(r.hits.every((x: any) => x.length === 2)).toBe(true);
  });

  it("سَ + verb: 19:47, and never the particle سَوْفَ", async () => {
    const r = await preset("sa-verb");
    expect(keys(r)).toContain("19:47");
    expect(keys(r)).not.toContain("12:98");
  });

  it("opening with إِذْ: every hit is the first word, with or without وَ", async () => {
    const r = await preset("idh-opening");
    expect(r.total).toBeGreaterThan(100);
    expect(r.hits.every((h: any) => h.start === 1)).toBe(true);
    const words = new Set(r.hits.map((h: any) => h.match));
    expect([...words].some((w) => (w as string).startsWith("وَ"))).toBe(true);
    expect([...words].some((w) => (w as string).startsWith("إِ"))).toBe(true);
    // 18:63 has إِذْ as its third word, so it is not an opening
    expect(keys(r)).not.toContain("18:63");
  });

  it("ٱلَّذِى + verb: every relative form, followed by a verb", async () => {
    const r = await preset("alladhi-verb");
    // the first word as written, vowels and a leading وَ / فَ set aside
    const words = new Set(r.hits.map((h: any) => foldArabic(h.match.split(" ")[0]).replace(/^[وف](?=ال)/, "")));
    for (const w of ["الذين", "الذي", "التي"]) expect(words.has(w), w).toBe(true);
  });
});

describe("building a query", () => {
  it("hits come in mushaf order and page with limit/offset", async () => {
    const all = (await search({ slots: [{ prefix: "FUT" }], limit: 500 })).body;
    const page = (await search({ slots: [{ prefix: "FUT" }], limit: 5, offset: 10 })).body;
    expect(page.total).toBe(all.total);
    expect(page.hits).toEqual(all.hits.slice(10, 15));
    const chap = (k: string) => k.split(":").map(Number);
    for (let i = 1; i < all.hits.length; i++) {
      const [a, b] = [chap(all.hits[i - 1].verse_key), chap(all.hits[i].verse_key)];
      expect(a[0]! < b[0]! || (a[0] === b[0] && a[1]! <= b[1]!)).toBe(true);
    }
  });

  it("a gap lets other words sit between the slots", async () => {
    // 2:6 … ءَأَنذَرْتَهُمْ أَمْ لَمْ تُنذِرْهُمْ: the negation لَمْ then a jussive verb
    const adjacent = (await search({ slots: [{ form: "لم" }, { verb: { mood: "JUS" } }], limit: 500 })).body;
    const gapped = (await search({ slots: [{ form: "لم" }, { verb: { mood: "JUS" }, gap: 2 }], limit: 500 })).body;
    expect(adjacent.total).toBeGreaterThan(0);
    expect(gapped.total).toBeGreaterThanOrEqual(adjacent.total);
    expect(keys(adjacent)).toContain("2:6");
  });

  it("matches a root in Arabic or Buckwalter alike", async () => {
    const ar = (await search({ slots: [{ root: "ر ء ي", prefix: "INTG" }], limit: 1 })).body;
    const bw = (await search({ slots: [{ root: "rAy", prefix: "INTG" }], limit: 1 })).body;
    expect(ar.total).toBe(bw.total);
    expect(ar.total).toBe((await preset("a-raayta", 1)).total);
  });

  it("refuses a query it can't run, saying why", async () => {
    for (const bad of [
      {}, { slots: [] }, { slots: [{}, {}, {}, {}, {}] }, { slots: [{}] },
      { slots: [{ pos: "nope" }] }, { slots: [{ prefix: "XYZ" }] }, { slots: [{ verb: { mood: "maybe" } }] },
      { slots: [{ form: "قال" }, { pos: "V", gap: 99 }] }, { slots: [{ colour: "red" }] },
    ]) {
      const r = await search(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(typeof r.body.detail).toBe("string");
    }
  });
});
