// Rule checks, characters and mentions (migration 0017), with the fields 0017 adds to speaker
// tags and links. The reader states the rule, names the character and decides every mark and
// mention; an AI may only suggest marks and file potential mentions.

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
const post = (c: ReturnType<typeof client>, path: string, body: unknown = {}) => c.send("POST", path, body);
const json = async (res: Response | Promise<Response>) => (await res).json() as Promise<any>;

beforeAll(async () => {
  h = await researchHarness();
  await h.addUser(AMINA);
  await h.addUser(BILAL);
  a = client(h.as(AMINA));
  b = client(h.as(BILAL));
  ai = client(h.as(AMINA, "token"));
});

const longTa = {
  id: "r1", title: "ٱمْرَأَت with ت",
  statement: "Written with ت, the woman is named with a man.",
  falsifier: "One place written with ت where no man is named with her.",
  scope: { kind: "spelling", key: "امرات", text: "ٱمْرَأَت" },
};

describe("rule checks", () => {
  it("a rule keeps its statement, what would prove it wrong, and what it covers", async () => {
    const saved = await json(a.put(`${B}/rules/r1`, longTa));
    expect(saved).toMatchObject({ ...longTa, source: "me", authorId: AMINA.id, marks: [],
      counts: { fits: 0, exception: 0, unsure: 0, suggested: 0 } });
    expect((await a.get(`${B}/rules`)).map((r: any) => r.id)).toEqual(["r1"]);
  });

  it("needs something it covers, and a title or a statement", async () => {
    expect((await a.put(`${B}/rules/r2`, { id: "r2", title: "no scope" })).status).toBe(422);
    expect((await a.put(`${B}/rules/r2`, { id: "r2", title: "bad kind", scope: { kind: "vibe", key: "x" } })).status).toBe(422);
    expect((await a.put(`${B}/rules/r2`, { id: "r2", scope: { kind: "root", key: "قول" } })).status).toBe(422);
    expect((await a.put(`${B}/rules/r2`, { id: "r2", title: "pattern", scope: { kind: "construction", key: "x" } })).status).toBe(422);
    expect((await a.put(`${B}/rules/r2`, { id: "other", title: "t", scope: { kind: "root", key: "قول" } })).status).toBe(400);
  });

  it("a grammar pattern's query is kept with the rule", async () => {
    const query = { slots: [{ form: "إِذَا" }], atStart: true };
    const saved = await json(a.put(`${B}/rules/r3`, { id: "r3", title: "opening إذا", scope: { kind: "construction", key: "idh-opening", text: "إذا at the start", query } }));
    expect(saved.scope).toEqual({ kind: "construction", key: "idh-opening", text: "إذا at the start", query });
  });

  it("marks land per place, are counted by value, and a new mark replaces the old", async () => {
    const res = await json(a.put(`${B}/rules/r1/marks`, { marks: [
      { verseKey: "3:35", word: 3, mark: "fits" }, { verseKey: "12:30", word: 5, mark: "fits", note: "العزيز is named" },
      { verseKey: "28:9", word: 2, mark: "unsure" }] }));
    expect(res).toEqual({ saved: 3 });
    let rule = await a.get(`${B}/rules/r1`);
    expect(rule.counts).toEqual({ fits: 2, exception: 0, unsure: 1, suggested: 0 });
    // Book order, whatever order they were marked in
    expect(rule.marks.map((m: any) => `${m.verseKey}@${m.word}:${m.mark}`)).toEqual(["3:35@3:fits", "12:30@5:fits", "28:9@2:unsure"]);
    await a.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "28:9", word: 2, mark: "exception", note: "no man named here?" }] });
    rule = await a.get(`${B}/rules/r1`);
    expect(rule.counts).toEqual({ fits: 2, exception: 1, unsure: 0, suggested: 0 });
    expect(rule.marks.find((m: any) => m.verseKey === "28:9")).toMatchObject({ mark: "exception", note: "no man named here?", source: "me" });
    expect((await a.get(`${B}/rules`)).find((r: any) => r.id === "r1").counts).toEqual({ fits: 2, exception: 1, unsure: 0, suggested: 0 });
  });

  it("refuses a mark that is not fits, exception or unsure, a bad place, or an unknown rule", async () => {
    expect((await a.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "3:35", word: 3, mark: "maybe" }] })).status).toBe(422);
    expect((await a.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "3-35", word: 3, mark: "fits" }] })).status).toBe(422);
    expect((await a.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "3:35", word: 0, mark: "fits" }] })).status).toBe(422);
    expect((await a.put(`${B}/rules/r1/marks`, { marks: [] })).status).toBe(422);
    expect((await a.put(`${B}/rules/nope/marks`, { marks: [{ verseKey: "3:35", word: 3, mark: "fits" }] })).status).toBe(404);
  });

  it("a mark can be taken off again", async () => {
    expect(await json(post(a, `${B}/rules/r1/marks/remove`, { places: [{ verseKey: "28:9", word: 2 }] }))).toEqual({ removed: 1 });
    expect((await a.get(`${B}/rules/r1`)).counts).toEqual({ fits: 2, exception: 0, unsure: 0, suggested: 0 });
  });

  it("an AI's marks wait as suggestions: they do not count, and never replace the reader's", async () => {
    const res = await json(ai.put(`${B}/rules/r1/marks`, { marks: [
      { verseKey: "3:35", word: 3, mark: "exception" },      // the reader already marked this one
      { verseKey: "66:10", word: 5, mark: "fits" }, { verseKey: "66:11", word: 5, mark: "fits" }] }));
    expect(res).toEqual({ saved: 2 });
    let rule = await a.get(`${B}/rules/r1`);
    expect(rule.counts).toEqual({ fits: 2, exception: 0, unsure: 0, suggested: 2 });
    expect(rule.marks.find((m: any) => m.verseKey === "3:35")).toMatchObject({ mark: "fits", source: "me" });
    // it may revise its own suggestion
    await ai.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "66:10", word: 5, mark: "unsure" }] });
    rule = await a.get(`${B}/rules/r1`);
    expect(rule.marks.find((m: any) => m.verseKey === "66:10")).toMatchObject({ mark: "unsure", source: "ai" });
    // the reader takes one, then the rest
    expect(await json(post(a, `${B}/rules/r1/marks/accept`, { places: [{ verseKey: "66:10", word: 5 }] }))).toEqual({ accepted: 1 });
    expect((await a.get(`${B}/rules/r1`)).counts).toEqual({ fits: 2, exception: 0, unsure: 1, suggested: 1 });
    expect(await json(post(a, `${B}/rules/r1/marks/accept`))).toEqual({ accepted: 1 });
    expect((await a.get(`${B}/rules/r1`)).counts).toEqual({ fits: 3, exception: 0, unsure: 1, suggested: 0 });
    // and the reader's own mark replaces a suggestion outright
    await ai.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "111:4", word: 1, mark: "fits" }] });
    await a.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "111:4", word: 1, mark: "exception" }] });
    expect((await a.get(`${B}/rules/r1`)).marks.find((m: any) => m.verseKey === "111:4")).toMatchObject({ mark: "exception", source: "me" });
  });

  it("an AI can't write or delete a rule, take marks off, or accept its own suggestions", async () => {
    expect((await ai.put(`${B}/rules/ai_r`, { id: "ai_r", title: "mine", scope: { kind: "root", key: "قول" } })).status).toBe(403);
    expect((await ai.put(`${B}/rules/r1`, { ...longTa, statement: "rewritten" })).status).toBe(403);
    expect((await ai.del(`${B}/rules/r1`)).status).toBe(403);
    expect((await post(ai, `${B}/rules/r1/marks/remove`, { places: [{ verseKey: "3:35", word: 3 }] })).status).toBe(403);
    expect((await post(ai, `${B}/rules/r1/marks/accept`)).status).toBe(403);
    expect((await a.get(`${B}/rules/r1`)).statement).toBe(longTa.statement);
  });

  it("deleting a rule takes its marks with it", async () => {
    await a.put(`${B}/rules/gone`, { id: "gone", title: "short-lived", scope: { kind: "root", key: "قول" } });
    await a.put(`${B}/rules/gone/marks`, { marks: [{ verseKey: "2:8", word: 4, mark: "fits" }] });
    expect((await a.del(`${B}/rules/gone`)).status).toBe(200);
    expect((await h.as(AMINA).request(`${B}/rules/gone`)).status).toBe(404);
    const left = await h.pglite.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM research.rule_marks WHERE rule_id = 'gone'");
    expect(left.rows[0]!.n).toBe(0);
  });
});

const isa = {
  id: "c1", name: "ʿĪsā", note: "",
  designations: [
    { kind: "lemma", key: "عِيسَى", text: "عِيسَى", as: "name" },
    { kind: "lemma", key: "مَسِيح", text: "ٱلْمَسِيح", as: "title" },
  ],
};
const mid = (c: string, v: string, w: number, part = 0) => `${c}|${v}|${w}|${part}`;

describe("characters and mentions", () => {
  it("a character keeps its name and the names and titles filed under it", async () => {
    const saved = await json(a.put(`${B}/characters/c1`, isa));
    expect(saved).toMatchObject({ ...isa, source: "me", mentions: [], counts: { established: 0, potential: 0 } });
    expect((await a.put(`${B}/characters/c2`, { id: "c2", name: "  " })).status).toBe(422);
    expect((await a.put(`${B}/characters/c2`, { id: "c2", name: "x", designations: [{ kind: "lemma" }] })).status).toBe(422);
  });

  it("places are filed as potential, once each, and found by āyah, sūrah, status and kind", async () => {
    const drafts = [
      { characterId: "c1", verseKey: "3:45", word: 14, kind: "name", designation: "عِيسَى" },
      { characterId: "c1", verseKey: "3:45", word: 13, kind: "title", designation: "ٱلْمَسِيح" },
      { characterId: "c1", verseKey: "19:34", word: 2, kind: "name", designation: "عِيسَى" },
    ];
    expect(await json(a.put(`${B}/mentions`, { mentions: drafts }))).toEqual({ saved: 3 });
    // filing the same places again adds nothing and changes nothing
    expect(await json(a.put(`${B}/mentions`, { mentions: drafts }))).toEqual({ saved: 0 });
    const here = await a.get(`${B}/mentions?verse=3:45`);
    expect(here.map((m: any) => `${m.word}:${m.kind}:${m.status}`)).toEqual(["13:title:potential", "14:name:potential"]);
    expect(here[0]).toMatchObject({ id: mid("c1", "3:45", 13), characterId: "c1", words: 1, designation: "ٱلْمَسِيح", source: "me" });
    expect((await a.get(`${B}/mentions?chapter=19`)).map((m: any) => m.id)).toEqual([mid("c1", "19:34", 2)]);
    expect((await a.get(`${B}/mentions?kind=title`)).length).toBe(1);
    expect((await a.get(`${B}/mentions?character=c1&status=potential`)).length).toBe(3);
    expect(await a.get(`${B}/mentions?status=established`)).toEqual([]);
  });

  it("the reader establishes mentions, and can set them back", async () => {
    expect(await json(post(a, `${B}/mentions/status`, { ids: [mid("c1", "3:45", 14), mid("c1", "19:34", 2)], status: "established" }))).toEqual({ changed: 2 });
    let ch = await a.get(`${B}/characters/c1`);
    expect(ch.counts).toEqual({ established: 2, potential: 1 });
    // mentions come in Book order
    expect(ch.mentions.map((m: any) => `${m.verseKey}@${m.word}`)).toEqual(["3:45@13", "3:45@14", "19:34@2"]);
    expect((await a.get(`${B}/characters`)).find((c: any) => c.id === "c1").counts).toEqual({ established: 2, potential: 1 });
    expect(await json(post(a, `${B}/mentions/status`, { ids: [mid("c1", "19:34", 2)], status: "potential" }))).toEqual({ changed: 1 });
    ch = await a.get(`${B}/characters/c1`);
    expect(ch.counts).toEqual({ established: 1, potential: 2 });
    // filing a place as established raises one that was potential; filing as potential never lowers
    expect(await json(a.put(`${B}/mentions`, { mentions: [{ characterId: "c1", verseKey: "19:34", word: 2, kind: "name", status: "established" }] }))).toEqual({ saved: 1 });
    expect(await json(a.put(`${B}/mentions`, { mentions: [{ characterId: "c1", verseKey: "19:34", word: 2, kind: "name" }] }))).toEqual({ saved: 0 });
    expect((await a.get(`${B}/mentions?verse=19:34`))[0].status).toBe("established");
    expect((await post(a, `${B}/mentions/status`, { ids: [mid("c1", "3:45", 13)], status: "sure" })).status).toBe(422);
  });

  it("a pronoun points at a character like any other mention, with a note", async () => {
    await a.put(`${B}/mentions`, { mentions: [{ characterId: "c1", verseKey: "19:30", word: 1, kind: "pronoun" }] });
    expect(await json(post(a, `${B}/mentions/note`, { id: mid("c1", "19:30", 1), note: "the one who speaks here" }))).toEqual({ changed: 1 });
    expect((await a.get(`${B}/mentions?kind=pronoun`))[0]).toMatchObject({ verseKey: "19:30", kind: "pronoun", designation: "", note: "the one who speaks here" });
  });

  it("refuses a mention with no character, an unknown character, or a bad place or kind", async () => {
    expect((await a.put(`${B}/mentions`, { mentions: [{ verseKey: "3:45", word: 1 }] })).status).toBe(422);
    expect((await a.put(`${B}/mentions`, { mentions: [{ characterId: "nobody", verseKey: "3:45", word: 1 }] })).status).toBe(404);
    expect((await a.put(`${B}/mentions`, { mentions: [{ characterId: "c1", verseKey: "3:45", word: 0 }] })).status).toBe(422);
    expect((await a.put(`${B}/mentions`, { mentions: [{ characterId: "c1", verseKey: "3:45", word: 1, kind: "hunch" }] })).status).toBe(422);
  });

  it("an AI may file potential mentions, but not establish, remove, or touch what is filed", async () => {
    const res = await json(ai.put(`${B}/mentions`, { mentions: [
      { characterId: "c1", verseKey: "5:110", word: 4, kind: "name", status: "established" },   // asked for more than it may
      { characterId: "c1", verseKey: "3:45", word: 13, kind: "name" }] }));                       // already the reader's
    expect(res).toEqual({ saved: 1 });
    expect((await a.get(`${B}/mentions?verse=5:110`))[0]).toMatchObject({ status: "potential", source: "ai" });
    expect((await a.get(`${B}/mentions?verse=3:45`)).find((m: any) => m.word === 13)).toMatchObject({ kind: "title", source: "me" });
    expect((await post(ai, `${B}/mentions/status`, { ids: [mid("c1", "5:110", 4)], status: "established" })).status).toBe(403);
    expect((await post(ai, `${B}/mentions/remove`, { ids: [mid("c1", "5:110", 4)] })).status).toBe(403);
    expect((await post(ai, `${B}/mentions/note`, { id: mid("c1", "5:110", 4), note: "x" })).status).toBe(403);
    expect((await ai.put(`${B}/characters/ai_c`, { id: "ai_c", name: "someone" })).status).toBe(403);
    expect((await ai.del(`${B}/characters/c1`)).status).toBe(403);
    // the reader establishing an AI's mention makes it the reader's own
    await post(a, `${B}/mentions/status`, { ids: [mid("c1", "5:110", 4)], status: "established" });
    expect((await a.get(`${B}/mentions?verse=5:110`))[0]).toMatchObject({ status: "established", source: "me" });
  });

  it("mentions can be removed, and a character takes its mentions with it", async () => {
    expect(await json(post(a, `${B}/mentions/remove`, { ids: [mid("c1", "19:30", 1)] }))).toEqual({ removed: 1 });
    await a.put(`${B}/characters/c9`, { id: "c9", name: "Short-lived" });
    await a.put(`${B}/mentions`, { mentions: [{ characterId: "c9", verseKey: "2:30", word: 1 }] });
    expect((await a.del(`${B}/characters/c9`)).status).toBe(200);
    expect(await a.get(`${B}/mentions?character=c9`)).toEqual([]);
  });

  it("files thousands of places in one request", async () => {
    await a.put(`${B}/characters/big`, { id: "big", name: "Many" });
    const many = Array.from({ length: 2700 }, (_, i) => ({ characterId: "big", verseKey: `${1 + (i % 114)}:${1 + Math.floor(i / 114)}`, word: 1 + (i % 3), kind: "name" }));
    expect(await json(a.put(`${B}/mentions`, { mentions: many }))).toEqual({ saved: 2700 });
    expect((await a.get(`${B}/characters`)).find((c: any) => c.id === "big").counts).toEqual({ established: 0, potential: 2700 });
    expect(await json(post(a, `${B}/mentions/status`, { ids: many.map((m) => mid("big", m.verseKey, m.word)), status: "established" }))).toEqual({ changed: 2700 });
    await a.del(`${B}/characters/big`);
  });
});

describe("what 0017 adds to speaker tags and links", () => {
  it("a speaker tag keeps who else hears, and whether the text states the speaker", async () => {
    const tag = { id: "s1", verseKey: "12:26", word: 1, words: 6, speaker: "Yūsuf", addressee: "al-ʿAzīz", listeners: "a witness of her household", basis: "inferred" };
    expect(await json(a.put(`${B}/speech/s1`, tag))).toMatchObject(tag);
    expect((await a.put(`${B}/speech/s2`, { id: "s2", verseKey: "12:26", speaker: "x", basis: "guessed" })).status).toBe(422);
    // an older tag, saved without them, reads back empty
    expect(await json(a.put(`${B}/speech/s3`, { id: "s3", verseKey: "12:27", speaker: "a witness" }))).toMatchObject({ listeners: "", basis: "" });
    expect((await a.get(`${B}/speech?chapter=12`)).map((t: any) => t.id)).toEqual(["s1", "s3"]);
  });

  it("a tension is open until the reader settles it and says how; only a tension can be settled", async () => {
    const t = { id: "t1", a: { verseKey: "4:82", word: 1, words: 3 }, b: { verseKey: "2:106", word: 1, words: 4 }, kind: "tension", note: "how do these sit together?" };
    expect(await json(a.put(`${B}/links/t1`, t))).toMatchObject({ ...t, resolved: false, resolution: "" });
    expect((await a.get(`${B}/links?kind=tension`)).map((l: any) => l.id)).toEqual(["t1"]);
    expect(await json(a.put(`${B}/links/t1`, { ...t, resolved: true, resolution: "2:106 is about something else" })))
      .toMatchObject({ resolved: true, resolution: "2:106 is about something else" });
    expect(await json(a.put(`${B}/links/t1`, { ...t, resolved: false }))).toMatchObject({ resolved: false });
    expect(await json(a.put(`${B}/links/k1`, { id: "k1", a: { verseKey: "1:1", word: 1 }, b: { verseKey: "27:30", word: 4 }, kind: "same-wording", resolved: true, resolution: "x" })))
      .toMatchObject({ resolved: false, resolution: "" });
  });

  it("an AI may raise a tension but never settle one", async () => {
    const raised = await json(ai.put(`${B}/links/ai_t`, { id: "ai_t", a: { verseKey: "7:54", word: 1 }, b: { verseKey: "41:9", word: 1 }, kind: "tension", resolved: true, resolution: "settled by ai" }));
    expect(raised).toMatchObject({ kind: "tension", source: "ai", resolved: false, resolution: "" });
  });
});

describe("privacy and plan features", () => {
  it("another reader sees none of it", async () => {
    expect(await b.get(`${B}/rules`)).toEqual([]);
    expect(await b.get(`${B}/characters`)).toEqual([]);
    expect(await b.get(`${B}/mentions`)).toEqual([]);
    expect((await h.as(BILAL).request(`${B}/rules/r1`)).status).toBe(404);
    expect((await b.put(`${B}/rules/r1/marks`, { marks: [{ verseKey: "3:35", word: 3, mark: "exception" }] })).status).toBe(404);
    expect((await b.put(`${B}/mentions`, { mentions: [{ characterId: "c1", verseKey: "3:45", word: 1 }] })).status).toBe(404);
  });

  it("writes need the rules or characters feature; reading stays open", () => {
    expect(featureForResearch("PUT", "/research/rules/r1")).toBe("rules");
    expect(featureForResearch("PUT", "/research/rules/r1/marks")).toBe("rules");
    expect(featureForResearch("POST", "/research/rules/r1/marks/accept")).toBe("rules");
    expect(featureForResearch("PUT", "/research/characters/c1")).toBe("characters");
    expect(featureForResearch("PUT", "/research/mentions")).toBe("characters");
    expect(featureForResearch("POST", "/research/mentions/status")).toBe("characters");
    expect(featureForResearch("GET", "/research/rules")).toBeNull();
    expect(featureForResearch("GET", "/research/mentions")).toBeNull();
  });
});
