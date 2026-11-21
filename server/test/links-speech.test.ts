// Saved links and speaker tags (migration 0016): the reader's own records of what ties two places
// in the Book together, and of who speaks to whom. Private like the rest of the research; an AI
// may only propose them.

import { describe, it, expect, beforeAll } from "vitest";
import { researchHarness, client } from "./research-harness.js";
import { featureForResearch } from "../src/plan-features.js";

const AMINA = { id: "11111111-1111-4111-8111-111111111111", email: "amina@example.org", name: "Amina" };
const BILAL = { id: "22222222-2222-4222-8222-222222222222", email: "bilal@example.org", name: "Bilal" };
const B = "/research";
let h: Awaited<ReturnType<typeof researchHarness>>;
let a: ReturnType<typeof client>;
let b: ReturnType<typeof client>;
let ai: ReturnType<typeof client>;

beforeAll(async () => {
  h = await researchHarness();
  await h.addUser(AMINA);
  await h.addUser(BILAL);
  a = client(h.as(AMINA));
  b = client(h.as(BILAL));
  ai = client(h.as(AMINA, "token"));
});

const hafiyy = {
  id: "l1",
  a: { verseKey: "19:47", word: 10, words: 1 },
  b: { verseKey: "7:187", word: 26, words: 1 },
  kind: "same-wording", marker: { kind: "lemma", key: "حَفِيّ", text: "حَفِيّ" },
  label: "", note: "the word occurs only in these two",
};

describe("saved links", () => {
  it("a link keeps both ends, what they share, its kind, label and note", async () => {
    const saved = await (await a.put(`${B}/links/l1`, hafiyy)).json();
    expect(saved).toMatchObject({ ...hafiyy, status: "kept", source: "me", authorId: AMINA.id });
    expect(await a.get(`${B}/links/l1`)).toMatchObject(hafiyy);
  });

  it("is found from either end, by sūrah, by what it shares, and by kind", async () => {
    for (const q of ["verse=19:47", "verse=7:187", "chapter=19", "chapter=7", "kind=same-wording",
      `marker_key=${encodeURIComponent("حَفِيّ")}`, `marker_kind=lemma&marker_key=${encodeURIComponent("حَفِيّ")}`]) {
      expect((await a.get(`${B}/links?${q}`)).map((l: any) => l.id), q).toEqual(["l1"]);
    }
    for (const q of ["verse=19:48", "chapter=1", "chapter=9", "kind=image", "marker_kind=root&marker_key=x"]) {
      expect(await a.get(`${B}/links?${q}`), q).toEqual([]);
    }
  });

  it("a link with one end is a lead, and becomes kept when its other end is found", async () => {
    const lead = { id: "l2", a: { verseKey: "12:21", word: 1, words: 4 }, note: "who is this?" };
    expect(await (await a.put(`${B}/links/l2`, lead)).json()).toMatchObject({ b: null, status: "lead" });
    expect((await a.get(`${B}/links?status=lead`)).map((l: any) => l.id)).toEqual(["l2"]);
    expect((await a.get(`${B}/links?status=kept`)).map((l: any) => l.id)).toEqual(["l1"]);
    const found = await (await a.put(`${B}/links/l2`, { ...lead, b: { verseKey: "28:9", word: 1, words: 3 }, kind: "refers" })).json() as Record<string, unknown>;
    expect(found).toMatchObject({ status: "kept", kind: "refers", b: { verseKey: "28:9", word: 1, words: 3 } });
    expect(await a.get(`${B}/links?status=lead`)).toEqual([]);
    // a link with both ends can still be held back as a lead
    expect(await (await a.put(`${B}/links/l2`, { ...found, status: "lead" })).json()).toMatchObject({ status: "lead" });
    await a.put(`${B}/links/l2`, { ...found, status: "kept" });
  });

  it("a label groups links: one image, one theme", async () => {
    await a.put(`${B}/links/l3`, { id: "l3", a: { verseKey: "20:12", word: 4, words: 2 }, b: { verseKey: "19:47", word: 10, words: 1 }, kind: "same-image", label: "welcome" });
    await a.put(`${B}/links/l4`, { id: "l4", a: { verseKey: "54:11", word: 2, words: 1 }, b: { verseKey: "38:50", word: 5, words: 1 }, kind: "same-image", label: "gateways" });
    await a.put(`${B}/links/l5`, { id: "l5", a: { verseKey: "12:23", word: 9, words: 1 }, b: { verseKey: "38:50", word: 5, words: 1 }, kind: "same-image", label: "gateways" });
    expect(await a.get(`${B}/links/labels`)).toEqual([{ label: "gateways", count: 2 }, { label: "welcome", count: 1 }]);
    expect((await a.get(`${B}/links?label=gateways`)).map((l: any) => l.id)).toEqual(["l4", "l5"]);
  });

  it("coverage lists, per sūrah, the āyāt that are an end of a kept link, and those with only a lead", async () => {
    await a.put(`${B}/links/l6`, { id: "l6", a: { verseKey: "18:63", word: 2, words: 1 } });
    const cover = await a.get(`${B}/links/coverage`);
    const of = (ch: number) => cover.find((c: any) => c.chapter === ch);
    expect(of(19)).toEqual({ chapter: 19, linked: ["19:47"], leads: [] });
    expect(of(12)).toEqual({ chapter: 12, linked: ["12:21", "12:23"], leads: [] });
    expect(of(18)).toEqual({ chapter: 18, linked: [], leads: ["18:63"] });
    expect(cover.map((c: any) => c.chapter)).toEqual([7, 12, 18, 19, 20, 28, 38, 54]);
  });

  it("refuses an end that is not a place in the Book, and an id that is not the URL's", async () => {
    for (const bad of [
      { id: "x", a: { verseKey: "nope" } },
      { id: "x", a: { verseKey: "2:255", word: 0 } },
      { id: "x", a: { verseKey: "2:255", word: 1.5 } },
      { id: "x", a: { verseKey: "2:255" }, b: { verseKey: "2:" } },
      { id: "x" },
    ]) expect((await a.put(`${B}/links/x`, bad)).status, JSON.stringify(bad)).toBe(422);
    expect((await a.put(`${B}/links/x`, { id: "y", a: { verseKey: "2:255" } })).status).toBe(400);
    expect((await a.del(`${B}/links/none`)).status).toBe(404);
  });

  it("is private: another account sees none of it and cannot reach it", async () => {
    expect(await b.get(`${B}/links`)).toEqual([]);
    expect(await b.get(`${B}/links/labels`)).toEqual([]);
    expect(await b.get(`${B}/links/coverage`)).toEqual([]);
    expect((await h.as(BILAL).request(`${B}/links/l1`)).status).toBe(404);
    expect((await b.del(`${B}/links/l1`)).status).toBe(404);
    // the same id in another account is another record
    await b.put(`${B}/links/l1`, { id: "l1", a: { verseKey: "1:1" } });
    expect(await a.get(`${B}/links/l1`)).toMatchObject({ a: { verseKey: "19:47" } });
  });
});

describe("speaker tags", () => {
  it("a tag says who speaks in a span and to whom; a name lists what it speaks", async () => {
    await a.put(`${B}/speech/s1`, { id: "s1", verseKey: "19:47", word: 2, words: 9, speaker: "Ibrāhīm", addressee: "his father" });
    await a.put(`${B}/speech/s2`, { id: "s2", verseKey: "21:57", word: 1, speaker: " Ibrāhīm ", addressee: "his people" });
    await a.put(`${B}/speech/s3`, { id: "s3", verseKey: "12:85", word: 2, speaker: "the brothers", addressee: "their father", note: "tallāhi" });
    expect(await a.get(`${B}/speech?verse=19:47`)).toMatchObject([{ id: "s1", word: 2, words: 9, speaker: "Ibrāhīm", addressee: "his father", source: "me" }]);
    expect((await a.get(`${B}/speech?speaker=${encodeURIComponent("Ibrāhīm")}`)).map((s: any) => s.id)).toEqual(["s1", "s2"]); // trimmed
    expect((await a.get(`${B}/speech?chapter=12`)).map((s: any) => s.id)).toEqual(["s3"]);
    expect((await a.get(`${B}/speech?addressee=${encodeURIComponent("their father")}`)).map((s: any) => s.id)).toEqual(["s3"]);
    expect(await a.get(`${B}/speech/speakers`)).toEqual([
      { name: "Ibrāhīm", speaks: 2, addressed: 0 },
      { name: "his father", speaks: 0, addressed: 1 },
      { name: "his people", speaks: 0, addressed: 1 },
      { name: "the brothers", speaks: 1, addressed: 0 },
      { name: "their father", speaks: 0, addressed: 1 },
    ]);
  });

  it("needs a place and at least one name; is private; can be removed", async () => {
    expect((await a.put(`${B}/speech/x`, { id: "x", verseKey: "2:255" })).status).toBe(422);
    expect((await a.put(`${B}/speech/x`, { id: "x", verseKey: "bad", speaker: "s" })).status).toBe(422);
    expect((await a.put(`${B}/speech/x`, { id: "x", verseKey: "2:255", addressee: "the reader" })).status).toBe(200);
    expect(await b.get(`${B}/speech`)).toEqual([]);
    expect(await b.get(`${B}/speech/speakers`)).toEqual([]);
    expect((await a.del(`${B}/speech/x`)).status).toBe(200);
    expect((await a.del(`${B}/speech/x`)).status).toBe(404);
  });
});

describe("an AI assistant may only propose links and speaker tags", () => {
  it("what it adds is tagged as its own and listed for the reader to accept", async () => {
    const res = await ai.put(`${B}/links/ai_l1`, { id: "ai_l1", a: { verseKey: "18:63", word: 2 }, b: { verseKey: "25:43", word: 1 }, source: "me" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: "ai" });
    await ai.put(`${B}/speech/ai_s1`, { id: "ai_s1", verseKey: "18:63", word: 1, speaker: "Mūsā" });
    const proposed = await a.get(`${B}/proposed`);
    expect(proposed.links.map((l: any) => l.id)).toEqual(["ai_l1"]);
    expect(proposed.speech.map((s: any) => s.id)).toEqual(["ai_s1"]);
  });

  it("it may revise its own, but never the reader's, and never delete or accept", async () => {
    expect((await ai.put(`${B}/links/ai_l1`, { id: "ai_l1", a: { verseKey: "18:63", word: 2 }, note: "revised" })).status).toBe(200);
    expect((await ai.put(`${B}/links/l1`, { ...hafiyy, note: "rewritten by ai" })).status).toBe(403);
    expect((await ai.put(`${B}/speech/s1`, { id: "s1", verseKey: "19:47", speaker: "someone else" })).status).toBe(403);
    for (const [method, path] of [
      ["DELETE", `${B}/links/ai_l1`], ["DELETE", `${B}/links/l1`], ["DELETE", `${B}/speech/ai_s1`],
      ["PUT", `${B}/proposed/link/ai_l1/accept`], ["PUT", `${B}/proposed/speech/ai_s1/accept`],
    ] as [string, string][]) expect((await ai.send(method, path)).status, `${method} ${path}`).toBe(403);
    expect(await a.get(`${B}/links/l1`)).toMatchObject({ note: hafiyy.note, source: "me" });
  });

  it("the reader accepts a proposal and it becomes their own", async () => {
    expect((await a.put(`${B}/proposed/link/ai_l1/accept`)).status).toBe(200);
    expect((await a.put(`${B}/proposed/speech/ai_s1/accept`)).status).toBe(200);
    const proposed = await a.get(`${B}/proposed`);
    expect(proposed.links).toEqual([]);
    expect(proposed.speech).toEqual([]);
    expect(await a.get(`${B}/links/ai_l1`)).toMatchObject({ source: "me" });
    expect((await a.put(`${B}/proposed/link/ai_l1/accept`)).status).toBe(404);
  });
});

describe("the plan features behind them", () => {
  it("writes use their feature; reads are never locked", () => {
    expect(featureForResearch("GET", "/research/links")).toBeNull();
    expect(featureForResearch("GET", "/research/speech/speakers")).toBeNull();
    expect(featureForResearch("PUT", "/research/links/l1")).toBe("links");
    expect(featureForResearch("DELETE", "/research/links/l1")).toBe("links");
    expect(featureForResearch("PUT", "/research/speech/s1")).toBe("speakers");
    expect(featureForResearch("PUT", "/research/proposed/link/l1/accept")).toBe("links");
    expect(featureForResearch("PUT", "/research/proposed/speech/s1/accept")).toBe("speakers");
    expect(featureForResearch("PUT", "/research/proposed/note/n1/accept")).toBe("notes");
  });
});
