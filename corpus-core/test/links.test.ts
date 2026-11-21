// Links: what an āyah shares with the rest of the Book, and how rare each shared thing is.
// No oracle (new feature); validated against facts anyone can check in a concordance.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { corpusTestApp } from "./corpus-app.js";

let app: Hono;
const res = (p: string) => app.request(p);
const get = async (p: string) => (await (await res(p)).json()) as any;

beforeAll(async () => { app = corpusTestApp(); });

describe("an āyah's links", () => {
  it("a word found in two āyāt ties exactly those two (حَفِيّ: 19:47 and 7:187)", async () => {
    const r = await get("/corpus/verses/19:47/links");
    const hafiyy = r.links.find((l: any) => l.kind === "lemma" && l.text === "حَفِيّ");
    expect(hafiyy).toBeTruthy();
    expect(hafiyy.ayahs).toBe(2);
    expect(hafiyy.places).toEqual([{ verseKey: "7:187", start: 26 }]);
    expect(hafiyy.positions).toEqual([10]);
    // rarest first: nothing listed before it is in more āyāt than it
    expect(r.links[0].ayahs).toBe(2);
    for (let i = 1; i < r.links.length; i++) expect(r.links[i].ayahs).toBeGreaterThanOrEqual(r.links[i - 1].ayahs);
  });

  it("a written word counts even with no root, and a leading و is set aside (تَٱللَّهِ)", async () => {
    const r = await get("/corpus/verses/21:57/links");
    const tallahi = r.links.find((l: any) => l.kind === "form" && l.key === "تالله");
    expect(tallahi).toBeTruthy();
    expect(tallahi.ayahs).toBe(9);
    expect(tallahi.positions).toEqual([1]); // وَتَٱللَّهِ here
    const keys = tallahi.places.map((p: any) => p.verseKey);
    for (const k of ["12:73", "12:85", "12:91", "12:95", "26:97"]) expect(keys).toContain(k);
    expect(keys).not.toContain("21:57");
  });

  it("a phrase of three or more words comes from the echoes index, with this āyah left out", async () => {
    const r = await get("/corpus/verses/20:12/links");
    const phrase = r.links.find((l: any) => l.kind === "phrase");
    expect(phrase).toBeTruthy();
    expect(phrase.length).toBe(3);
    expect(phrase.ayahs).toBe(2);
    expect(phrase.places).toEqual([{ verseKey: "79:16", start: 4 }]);
  });

  it("a root with one word is listed once, not again as its word and its spelling", async () => {
    const r = await get("/corpus/verses/21:57/links");
    const sanam = r.links.filter((l: any) => l.positions.includes(3) && l.length === 1);
    expect(sanam.map((l: any) => l.kind)).toEqual(["root"]);
  });

  it("what is found nowhere else is reported as only here (خلع and نعل in 20:12)", async () => {
    const r = await get("/corpus/verses/20:12/links");
    const roots = r.onlyHere.filter((o: any) => o.kind === "root").map((o: any) => o.text);
    expect(roots).toEqual(expect.arrayContaining(["خلع", "نعل"]));
  });

  it("a widespread marker is counted, not listed: the refrain of 55:13 is in 31 āyāt", async () => {
    const r = await get("/corpus/verses/55:13/links");
    expect(r.links.every((l: any) => l.ayahs <= 20)).toBe(true);
    const refrain = r.common.find((m: any) => m.kind === "phrase");
    expect(refrain.ayahs).toBe(31);
    expect(refrain.places).toBeUndefined();
    // ?max raises the line
    const wide = await get("/corpus/verses/55:13/links?max=40");
    expect(wide.links.find((l: any) => l.kind === "phrase").ayahs).toBe(31);
  });

  it("404 for an āyah that does not exist", async () => {
    expect((await res("/corpus/verses/115:1/links")).status).toBe(404);
  });
});

describe("markers carried by exactly n āyāt", () => {
  it("each item has exactly n places, in different āyāt", async () => {
    for (const kind of ["root", "lemma", "form", "phrase"]) {
      for (const n of [2, 3]) {
        const r = await get(`/corpus/links/exclusive?kind=${kind}&n=${n}&limit=500`);
        expect(r.total).toBeGreaterThan(0);
        for (const it of r.items) {
          expect(it.places.length).toBe(n);
          expect(new Set(it.places.map((p: any) => p.verseKey)).size).toBe(n);
        }
      }
    }
  });

  it("حَفِيّ is among the words in two āyāt; its root is used a third time, so it is not under roots", async () => {
    const words = await get("/corpus/links/exclusive?kind=lemma&n=2&limit=500&chapter=19");
    expect(words.items.map((i: any) => i.text)).toContain("حَفِيّ");
    const roots = await get("/corpus/links/exclusive?kind=root&n=2&limit=500");
    expect(roots.items.map((i: any) => i.text)).not.toContain("حفو");
  });

  it("a level lists only what the level above does not already say", async () => {
    const roots = await get("/corpus/links/exclusive?kind=root&n=2&limit=500");
    const words = await get("/corpus/links/exclusive?kind=lemma&n=2&limit=500");
    const pairOf = (it: any) => it.places.map((p: any) => `${p.verseKey}@${p.start}`).join(" ");
    const rootPairs = new Set(roots.items.map(pairOf));
    // رعد is a root in two āyāt (2:19, 13:13); its one word is not repeated under words
    expect(roots.items.map((i: any) => i.text)).toContain("رعد");
    expect(words.items.some((i: any) => i.text === "رَعْد")).toBe(false);
    expect(rootPairs.size).toBe(roots.items.length);
  });

  it("phrases are the longest runs, longest first, and no run is listed again from its second word", async () => {
    const r = await get("/corpus/links/exclusive?kind=phrase&n=2&limit=500");
    for (let i = 1; i < r.items.length; i++) expect(r.items[i].length).toBeLessThanOrEqual(r.items[i - 1].length);
    expect(r.items[0].length).toBeGreaterThan(10);
    // no run sits inside another run shared by the same āyāt (a long shared passage is one item)
    const all = (await get("/corpus/links/exclusive?kind=phrase&n=2&limit=500&offset=0")).items
      .concat((await get("/corpus/links/exclusive?kind=phrase&n=2&limit=500&offset=500")).items);
    const byFirstVerse = new Map<string, any[]>();
    for (const it of all) {
      const k = it.places.map((p: any) => p.verseKey).join("/");
      byFirstVerse.set(k, [...(byFirstVerse.get(k) ?? []), it]);
    }
    for (const group of byFirstVerse.values()) {
      for (const x of group) for (const y of group) {
        if (x === y) continue;
        const inside = y.places[0].start >= x.places[0].start &&
          y.places[0].start + y.length <= x.places[0].start + x.length;
        expect(inside, `${y.text} inside ${x.text}`).toBe(false);
      }
    }
    // 4:43 and 5:6 share one long passage on purification: listed once
    const purification = all.filter((it: any) => it.places[0].verseKey === "4:43" && it.places[1].verseKey === "5:6" && it.length > 10);
    expect(purification).toHaveLength(1);
  });

  it("cross keeps only markers that join different sūrahs; chapter keeps those touching one", async () => {
    const cross = await get("/corpus/links/exclusive?kind=lemma&n=2&cross=1&limit=500");
    for (const it of cross.items) {
      expect(new Set(it.places.map((p: any) => p.verseKey.split(":")[0])).size).toBeGreaterThan(1);
    }
    const yusuf = await get("/corpus/links/exclusive?kind=lemma&n=2&chapter=12&limit=500");
    expect(yusuf.total).toBeGreaterThan(0);
    for (const it of yusuf.items) expect(it.places.some((p: any) => p.verseKey.startsWith("12:"))).toBe(true);
  });

  it("paging: offset continues where limit stopped; a bad kind is a 400", async () => {
    const a = await get("/corpus/links/exclusive?kind=root&n=2&limit=10");
    const b = await get("/corpus/links/exclusive?kind=root&n=2&limit=10&offset=10");
    expect(a.items.length).toBe(10);
    expect(b.items[0].key).not.toBe(a.items[0].key);
    expect(a.total).toBe(b.total);
    expect((await res("/corpus/links/exclusive?kind=verse")).status).toBe(400);
  });
});
