// What migration 0018 adds: the earlier texts a reader replaced (revisions), the pronoun a
// mention points at (part), and speech openers set aside. The reader's own in every case: an AI
// reads the earlier versions and files pronoun mentions as potential, nothing more.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { researchHarness, client } from "./research-harness.js";
import { featureForResearch } from "../src/plan-features.js";
import { ResearchStore } from "../src/research/store.js";

const AMINA = { id: "11111111-1111-4111-8111-111111111111", email: "amina@example.org", name: "Amina" };
const BILAL = { id: "22222222-2222-4222-8222-222222222222", email: "bilal@example.org", name: "Bilal" };
const B = "/research";
const q = encodeURIComponent;
let h: Awaited<ReturnType<typeof researchHarness>>;
let a: ReturnType<typeof client>;
let b: ReturnType<typeof client>;
let ai: ReturnType<typeof client>;
const post = (c: ReturnType<typeof client>, path: string, body: unknown = {}) => c.send("POST", path, body);
const json = async (res: Response | Promise<Response>) => (await res).json() as Promise<any>;

// the clock: a text counts as having stood once STOOD_MS has passed since it last changed
let clock = Date.UTC(2026, 10, 21, 9, 0, 0);
const HOUR = 60 * 60 * 1000;
const later = (ms: number) => { clock += ms; };

beforeAll(async () => {
  h = await researchHarness();
  await h.addUser(AMINA);
  await h.addUser(BILAL);
  a = client(h.as(AMINA));
  b = client(h.as(BILAL));
  ai = client(h.as(AMINA, "token"));
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterAll(() => { vi.restoreAllMocks(); });

const revs = (c: ReturnType<typeof client>, kind: string, target: string) =>
  c.get(`${B}/revisions?kind=${kind}&target=${q(target)}`) as Promise<any[]>;

describe("earlier versions", () => {
  const theCase = (verdict: string) => ({
    id: "k1", subject: { type: "root", value: "هدي" }, title: "guidance", status: "open", verdict,
    cards: [], slips: [], threads: [], clusters: [], formResearch: {},
  });

  it("a verdict that stood is kept when the reader replaces it", async () => {
    await a.put(`${B}/cases/k1`, theCase("to lead by the hand"));
    later(HOUR);
    const saved = await json(a.put(`${B}/cases/k1`, theCase("to show the way")));
    expect(saved.verdictAt).toBe(clock);
    expect(await revs(a, "verdict", "k1")).toEqual([
      { id: expect.any(String), kind: "verdict", target: "k1", before: "to lead by the hand", reason: "", replacedAt: clock }]);
  });

  it("typing does not flood it: text that did not stand is not kept", async () => {
    // a first verdict, and the keystrokes that follow within moments
    await a.put(`${B}/cases/k2`, { ...theCase("t"), id: "k2" });
    for (const v of ["to", "to g", "to guide"]) { later(2000); await a.put(`${B}/cases/k2`, { ...theCase(v), id: "k2" }); }
    expect(await revs(a, "verdict", "k2")).toEqual([]);
    // it stands for a day, then is retyped: the text that stood is kept once, not each keystroke
    later(24 * HOUR);
    for (const v of ["to guide t", "to guide to", "to guide to a way"]) { later(2000); await a.put(`${B}/cases/k2`, { ...theCase(v), id: "k2" }); }
    expect((await revs(a, "verdict", "k2")).map((r) => r.before)).toEqual(["to guide"]);
  });

  it("saving a case without touching the verdict keeps nothing, and keeps the verdict's date", async () => {
    const before = (await a.get(`${B}/cases/k1`)).verdictAt;
    later(HOUR);
    const saved = await json(a.put(`${B}/cases/k1`, { ...theCase("to show the way"), title: "guidance, again" }));
    expect(saved.verdictAt).toBe(before);
    expect(await revs(a, "verdict", "k1")).toHaveLength(1);
    // the date is the server's: a client cannot back-date a verdict to make a draft look settled
    const forged = await json(a.put(`${B}/cases/k1`, { ...theCase("to show the way"), verdictAt: 1 }));
    expect(forged.verdictAt).toBe(before);
  });

  it("the reader says why they changed it, and can remove an entry", async () => {
    const [rev] = await revs(a, "verdict", "k1");
    const withWhy = await json(a.put(`${B}/revisions/${rev.id}`, { reason: "  20:50 gives each thing its form, then guides  " }));
    expect(withWhy).toMatchObject({ id: rev.id, reason: "20:50 gives each thing its form, then guides" });
    expect((await revs(a, "verdict", "k1"))[0].reason).toBe("20:50 gives each thing its form, then guides");
    expect((await a.put(`${B}/revisions/${rev.id}`, { reason: 7 })).status).toBe(422);
    expect((await a.put(`${B}/revisions/999999`, { reason: "x" })).status).toBe(404);
    expect((await a.put(`${B}/revisions/abc`, { reason: "x" })).status).toBe(404);
    expect((await a.del(`${B}/revisions/${rev.id}`)).status).toBe(200);
    expect((await a.del(`${B}/revisions/${rev.id}`)).status).toBe(404);
    expect(await revs(a, "verdict", "k1")).toEqual([]);
  });

  it("the reader's own meaning for a root: the one that stood is kept, also when it is cleared", async () => {
    await a.put(`${B}/root-meanings/hdy`, { meaning: "gift" });
    later(1000);
    await a.put(`${B}/root-meanings/hdy`, { meaning: "guidance as a gift" });   // still being written
    expect(await revs(a, "root-meaning", "hdy")).toEqual([]);
    later(HOUR);
    await a.put(`${B}/root-meanings/hdy`, { meaning: "to lead gently to an end" });
    later(HOUR);
    await a.put(`${B}/root-meanings/hdy`, { meaning: "" });
    expect((await revs(a, "root-meaning", "hdy")).map((r) => r.before)).toEqual(["to lead gently to an end", "guidance as a gift"]);
  });

  it("an indication's text, and a refinement's; an AI's own proposals are not the reader's history", async () => {
    await a.put(`${B}/indications/i1`, { id: "i1", root: "هدي", label: "guide", meaning: "to guide" });
    await a.put(`${B}/refinements/f1`, { id: "f1", parentId: "i1", lemma: "هُدًى", meaning: "guidance" });
    later(HOUR);
    await a.put(`${B}/indications/i1`, { id: "i1", root: "هدي", label: "guide", meaning: "to lead to an end" });
    await a.put(`${B}/refinements/f1`, { id: "f1", parentId: "i1", lemma: "هُدًى", meaning: "the leading itself" });
    expect((await revs(a, "indication", "i1")).map((r) => r.before)).toEqual(["to guide"]);
    expect((await revs(a, "indication", "f1")).map((r) => r.before)).toEqual(["guidance"]);
    // a new label with the same text is not a new version
    later(HOUR);
    await a.put(`${B}/indications/i1`, { id: "i1", root: "هدي", label: "lead", meaning: "to lead to an end" });
    expect(await revs(a, "indication", "i1")).toHaveLength(1);

    await ai.put(`${B}/indications/i2`, { id: "i2", root: "هدي", label: "ai", meaning: "a proposal" });
    later(HOUR);
    await ai.put(`${B}/indications/i2`, { id: "i2", root: "هدي", label: "ai", meaning: "a proposal, reworded" });
    expect(await revs(a, "indication", "i2")).toEqual([]);

    // deleting an indication takes its earlier versions, and its refinements', with it
    await a.del(`${B}/indications/i1`);
    expect(await revs(a, "indication", "i1")).toEqual([]);
    expect(await revs(a, "indication", "f1")).toEqual([]);
  });

  it("a form's established meaning is kept once per edit, not once per keystroke", async () => {
    const withForm = (meaning: string) => ({ ...theCase("v"), id: "k3", formResearch: { "هُدًى": { status: "established", meaning } } });
    later(HOUR);
    await a.put(`${B}/cases/k3`, withForm("guidance"));
    for (const m of ["guidance t", "guidance to", "guidance to an end"]) { later(1500); await a.put(`${B}/cases/k3`, withForm(m)); }
    expect((await revs(a, "form", "k3|هُدًى")).map((r) => r.before)).toEqual(["guidance"]);
    await a.del(`${B}/cases/k3`);
    expect(await revs(a, "form", "k3|هُدًى")).toEqual([]);
  });

  it("asks for a kind it knows and a target", async () => {
    expect((await a.send("GET", `${B}/revisions?kind=mood&target=x`)).status).toBe(422);
    expect((await a.send("GET", `${B}/revisions?kind=verdict`)).status).toBe(422);
  });

  it("an AI may read earlier versions; it cannot give a reason or remove one", async () => {
    await a.put(`${B}/cases/k4`, { ...theCase("first"), id: "k4" });
    later(HOUR);
    await a.put(`${B}/cases/k4`, { ...theCase("second"), id: "k4" });
    const [rev] = await revs(ai, "verdict", "k4");
    expect(rev.before).toBe("first");
    expect((await ai.put(`${B}/revisions/${rev.id}`, { reason: "the AI's reason" })).status).toBe(403);
    expect((await ai.del(`${B}/revisions/${rev.id}`)).status).toBe(403);
    // and nothing an AI saves on a case can make one: the verdict stays the reader's
    later(HOUR);
    await ai.put(`${B}/cases/k4`, { ...theCase("the AI's verdict"), id: "k4" });
    expect((await a.get(`${B}/cases/k4`)).verdict).toBe("second");
    expect(await revs(a, "verdict", "k4")).toHaveLength(1);
  });

  it("another reader sees none of them and cannot touch them", async () => {
    const [rev] = await revs(a, "verdict", "k4");
    expect(await revs(b, "verdict", "k4")).toEqual([]);
    expect((await b.put(`${B}/revisions/${rev.id}`, { reason: "not mine" })).status).toBe(404);
    expect((await b.del(`${B}/revisions/${rev.id}`)).status).toBe(404);
    expect((await revs(a, "verdict", "k4"))[0].reason).toBe("");
  });

  it("the stood rule is ten minutes", () => {
    expect(ResearchStore.STOOD_MS).toBe(10 * 60 * 1000);
  });
});

describe("a slip says what kind of work it cites", () => {
  it("the kind is kept on the reader's slip and on an AI's own", async () => {
    const slip = (id: string, extra: object) => ({ id, kind: "reference", form: null, text: "says so", source: "Lisān al-ʿArab", x: 0, y: 0, rotation: 0, ...extra });
    await a.put(`${B}/cases/s1`, {
      id: "s1", subject: { type: "root", value: "رحم" }, title: "mercy", status: "open", verdict: "",
      cards: [], threads: [], clusters: [], formResearch: {}, slips: [slip("mine", { sourceKind: "lexicon" })],
    });
    const mine = await a.get(`${B}/cases/s1`);
    await ai.put(`${B}/cases/s1`, { ...mine, slips: [...mine.slips, slip("its", { sourceKind: "tafsir", author: "ai" })] });
    const after = await a.get(`${B}/cases/s1`);
    expect(after.slips.map((s: any) => [s.id, s.sourceKind])).toEqual([["mine", "lexicon"], ["its", "tafsir"]]);
  });
});

describe("a mention points at one pronoun of a word", () => {
  beforeAll(async () => {
    await a.put(`${B}/characters/we`, { id: "we", name: "the One who speaks" });
    await a.put(`${B}/characters/you`, { id: "you", name: "those addressed" });
  });

  it("the two pronouns of one word are two places, also under one character", async () => {
    // خَلَقْنَـٰكُمْ in 7:11: نا and كم
    expect(await json(a.put(`${B}/mentions`, { mentions: [
      { characterId: "we", verseKey: "7:11", word: 2, part: 1, kind: "pronoun" },
      { characterId: "you", verseKey: "7:11", word: 2, part: 2, kind: "pronoun" },
      { characterId: "we", verseKey: "7:11", word: 2, part: 2, kind: "pronoun", note: "both, to test" },
    ] }))).toEqual({ saved: 3 });
    const here = await a.get(`${B}/mentions?verse=7:11`);
    expect(here.map((m: any) => [m.id, m.part])).toEqual([
      ["we|7:11|2|1", 1], ["we|7:11|2|2", 2], ["you|7:11|2|2", 2]]);
    // the same place again is one mention still
    expect(await json(a.put(`${B}/mentions`, { mentions: [{ characterId: "we", verseKey: "7:11", word: 2, part: 1, kind: "pronoun" }] })))
      .toEqual({ saved: 0 });
  });

  it("with no part it is the word itself", async () => {
    await a.put(`${B}/mentions`, { mentions: [{ characterId: "you", verseKey: "7:11", word: 9, kind: "name" }] });
    expect((await a.get(`${B}/mentions?character=you`)).map((m: any) => [m.id, m.part])).toEqual([["you|7:11|2|2", 2], ["you|7:11|9|0", 0]]);
  });

  it("refuses a part that is not a small whole number", async () => {
    for (const part of [-1, 1.5, 21, "2"]) {
      expect((await a.put(`${B}/mentions`, { mentions: [{ characterId: "we", verseKey: "7:11", word: 2, part, kind: "pronoun" }] })).status).toBe(422);
    }
  });

  it("an AI files a pronoun as potential and leaves the reader's alone", async () => {
    await post(a, `${B}/mentions/status`, { ids: ["we|7:11|2|1"], status: "established" });
    expect(await json(ai.put(`${B}/mentions`, { mentions: [
      { characterId: "we", verseKey: "7:11", word: 2, part: 1, kind: "pronoun", note: "already the reader's" },
      { characterId: "we", verseKey: "7:11", word: 5, part: 1, kind: "pronoun", note: "قلنا" },
    ] }))).toEqual({ saved: 1 });
    const mine = (await a.get(`${B}/mentions?character=we`)).map((m: any) => [m.id, m.status, m.source]);
    expect(mine).toContainEqual(["we|7:11|2|1", "established", "me"]);
    expect(mine).toContainEqual(["we|7:11|5|1", "potential", "ai"]);
  });
});

describe("speech openers set aside", () => {
  it("the reader sets an opener aside, sees them by sūrah in Book order, and puts one back", async () => {
    for (const [verseKey, word] of [["11:42", 1], ["5:58", 2], ["11:45", 1], ["11:42", 1]] as const) {
      expect((await a.put(`${B}/speech-skips`, { verseKey, word })).status).toBe(200);
    }
    expect(await a.get(`${B}/speech-skips?chapter=11`)).toEqual([{ verseKey: "11:42", word: 1 }, { verseKey: "11:45", word: 1 }]);
    expect(await a.get(`${B}/speech-skips`)).toHaveLength(3);
    expect(await json(post(a, `${B}/speech-skips/remove`, { verseKey: "11:42", word: 1 }))).toEqual({ removed: true });
    expect(await json(post(a, `${B}/speech-skips/remove`, { verseKey: "11:42", word: 1 }))).toEqual({ removed: false });
    expect(await a.get(`${B}/speech-skips?chapter=11`)).toEqual([{ verseKey: "11:45", word: 1 }]);
  });

  it("refuses a bad place", async () => {
    expect((await a.put(`${B}/speech-skips`, { verseKey: "eleven", word: 1 })).status).toBe(422);
    expect((await a.put(`${B}/speech-skips`, { verseKey: "11:42", word: 0 })).status).toBe(422);
    expect((await post(a, `${B}/speech-skips/remove`, {})).status).toBe(422);
  });

  it("an AI may see them but not decide where speech is; another reader sees none", async () => {
    expect(await ai.get(`${B}/speech-skips?chapter=11`)).toHaveLength(1);
    expect((await ai.put(`${B}/speech-skips`, { verseKey: "19:24", word: 1 })).status).toBe(403);
    expect((await post(ai, `${B}/speech-skips/remove`, { verseKey: "11:45", word: 1 })).status).toBe(403);
    expect(await b.get(`${B}/speech-skips`)).toEqual([]);
  });
});

describe("plan features", () => {
  it("setting an opener aside is a speakers write; a reason on an earlier version needs any of its three", () => {
    expect(featureForResearch("PUT", "/research/speech-skips")).toBe("speakers");
    expect(featureForResearch("POST", "/research/speech-skips/remove")).toBe("speakers");
    expect(featureForResearch("PUT", "/research/revisions/4")).toEqual(["cases", "my-meanings", "indications"]);
    expect(featureForResearch("GET", "/research/revisions")).toBeNull();
  });
});
