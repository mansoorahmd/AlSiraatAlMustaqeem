// The MCP writing to the reader's research IN THEIR ACCOUNT: the real tools, over HTTP with a
// token, into the research server's `research` schema (PGlite here). The AI's writes
// must land as proposals the reader then sees in their own session — and the server must refuse
// what the MCP's guard would, even if something skipped the guard.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { ResearchRefused } from "../../mcp/src/research-client.js";
import { TOOLS } from "../../mcp/src/tools.js";
import { mcpTestState, READER } from "./mcp-state.js";

let state: any;
let reader: Hono<any>;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const call = (name: string, args: Record<string, unknown>) => tool(name).run(state, args) as Promise<any>;
const asReader = async (path: string, init?: RequestInit) => (await reader.request(path, init)).json() as Promise<any>;

beforeAll(async () => {
  const t = await mcpTestState();
  state = t.state;
  reader = t.harness.as(READER);   // the reader's own session, straight at /research
});

describe("the MCP's proposals land in the reader's account, as proposals", () => {
  it("add_note → a proposal the reader sees for review", async () => {
    const out = await call("add_note", { verse_key: "2:2", text: "no doubt in it — a claim of certainty", kind: "note" });
    expect(out).toMatchObject({ proposed: true, awaiting_review: true });
    const proposed = await asReader("/research/proposed");
    expect(proposed.notes.map((n: any) => n.id)).toContain(out.id);
  });

  it("propose_link → a link the reader sees for review; without a second place it is a lead", async () => {
    const link = await call("propose_link", {
      from_verse: "19:47", from_word: 10, from_words: 1, to_verse: "7:187", to_word: 26, to_words: 1,
      kind: "same-wording", shares_kind: "lemma", shares_key: "حَفِيّ", shares_text: "حَفِيّ",
      group: "", note: "the word occurs in these two āyāt only",
    });
    expect(link).toMatchObject({ proposed: true, status: "kept", awaiting_review: true });
    const lead = await call("propose_link", { from_verse: "12:21", from_word: 1, from_words: 4, kind: "", group: "", note: "who bought him?" });
    expect(lead.status).toBe("lead");
    const proposed = await asReader("/research/proposed");
    expect(proposed.links.map((l: any) => l.id).sort()).toEqual([lead.id, link.id].sort());
    expect(proposed.links.every((l: any) => l.source === "ai")).toBe(true);
    // and the model reads them back, with the reader's own
    const mine = await call("my_links", { verse_key: "19:47" });
    expect(mine.links).toMatchObject([{ id: link.id, to: { verseKey: "7:187", word: 26 }, shares: { kind: "lemma" }, proposed_by: "ai" }]);
    expect((await call("my_links", { status: "lead" })).links.map((l: any) => l.id)).toEqual([lead.id]);
    expect((await call("my_research_on", { verse_key: "19:47" })).links_on_ayah).toHaveLength(1);
  });

  it("propose_link refuses a span the āyah does not have, and a link from a place to itself", async () => {
    await expect(call("propose_link", { from_verse: "1:1", from_word: 4, from_words: 3, kind: "", group: "", note: "x" }))
      .rejects.toThrow(/has 4 words/);
    await expect(call("propose_link", { from_verse: "1:1", from_word: 1, from_words: 1, to_verse: "1:1", to_word: 1, to_words: 1, kind: "", group: "", note: "x" }))
      .rejects.toThrow(/two different places/);
    await expect(call("propose_link", { from_verse: "1:1", from_word: 1, from_words: 1, kind: "", group: "", note: " " }))
      .rejects.toThrow(/note is required/);
  });

  it("propose_speaker → a tag for the reader to accept; it needs a name", async () => {
    const out = await call("propose_speaker", { verse_key: "19:47", from_word: 2, speaker: "Ibrāhīm", addressee: "his father", note: "" });
    expect(out).toMatchObject({ proposed: true, awaiting_review: true });
    const proposed = await asReader("/research/proposed");
    expect(proposed.speech).toMatchObject([{ id: out.id, verseKey: "19:47", word: 2, words: null, speaker: "Ibrāhīm", source: "ai" }]);
    expect((await call("my_links", { verse_key: "19:47" })).speakers).toHaveLength(1);
    await expect(call("propose_speaker", { verse_key: "19:47", from_word: 1, speaker: " ", addressee: "", note: "" }))
      .rejects.toThrow(/speaker or an addressee/);
  });

  it("propose_indication → never the reader's primary, refinements attached", async () => {
    const out = await call("propose_indication", {
      root: "فلح", label: "attain the good", meaning: "",
      refinements: [{ form: "ٱلْمُفْلِحُونَ", label: "those who attain", meaning: "" }],
    });
    expect(out.is_primary).toBe(false);
    const d = await asReader(`/research/indications/${out.id}`);
    expect(d).toMatchObject({ primary: false, source: "ai" });
    expect(await asReader(`/research/indications/${out.id}/refinements`)).toHaveLength(out.refinements.length);
  });

  it("open_case and add_evidence build an AI case the reader can open", async () => {
    const c = await call("open_case", { subject_type: "phrase", subject: "ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ", title: "the straight path", description: "" });
    const ev = await call("add_evidence", { case_id: c.case_id, ayat: [{ verse_key: "1:6" }], expect_version: c.updated_at });
    expect(ev).toBeTruthy();
    const saved = await asReader(`/research/cases/${c.case_id}`);
    expect(saved.source).toBe("ai");
    expect(saved.cards.some((card: any) => card.verseKey === "1:6" && card.source === "ai")).toBe(true);
  });

  it("on the READER's case: adds its own evidence, never touches theirs", async () => {
    const t = Date.now();
    const mine = { id: "case_readers", subject: { type: "root", value: "رحم" }, title: "mercy", verdict: "my verdict",
      status: "partial", cards: [{ id: "card_mine", verseKey: "1:1", x: 20, y: 20, rotation: 0 }], slips: [],
      threads: [], clusters: [], formResearch: {}, createdAt: t, updatedAt: t };
    const seeded = await asReader("/research/cases/case_readers", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(mine) });
    await call("add_evidence", { case_id: "case_readers", ayat: [{ verse_key: "1:3" }], expect_version: seeded.updatedAt });
    const after = await asReader("/research/cases/case_readers");
    expect(after.cards.map((c: any) => c.id)).toContain("card_mine");
    expect(after.cards.length).toBe(2);
    expect(after).toMatchObject({ verdict: "my verdict", status: "partial" });
    await expect(call("revise_own_item", {
      case_id: "case_readers", item_id: "card_mine", action: "remove", text: "", expect_version: after.updatedAt,
    })).rejects.toThrow(/reader's own work/);
  });

  it("my_research_on reads the reader's research from the account", async () => {
    const out = await call("my_research_on", { root: "فلح" });
    expect(out.indications.length).toBeGreaterThan(0);
  });

  it("the SERVER refuses what the guard would, even called directly with the token", async () => {
    await reader.request("/research/notes/n_reader", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "n_reader", verseKey: "1:1", text: "the reader's own" }) });
    await expect(state.research.saveNote({ id: "n_reader", verseKey: "1:1", text: "overwritten" }))
      .rejects.toBeInstanceOf(ResearchRefused);
    expect((await asReader("/research/notes/n_reader")).text).toBe("the reader's own");
  });
});

// Rule checks and characters (server migration 0017): the reader states the rule and names the
// character; the MCP only suggests marks and files potential mentions.
describe("rule checks and characters: the reader states, the MCP suggests", () => {
  const put = (path: string, body: unknown) =>
    asReader(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("suggest_rule_marks → suggestions on the reader's rule, never over the reader's own mark", async () => {
    await put("/research/rules/r1", {
      id: "r1", title: "حَفِيّ", statement: "It is said of a lord, toward his servant.",
      falsifier: "A place where it is said of anyone else.", scope: { kind: "lemma", key: "حَفِيّ", text: "حَفِيّ" },
    });
    const listed = await call("my_rule_checks", {});
    expect(listed.rules).toMatchObject([{ id: "r1", covers: { kind: "lemma", key: "حَفِيّ" }, marked: { fits: 0, exception: 0, unsure: 0, suggested: 0 } }]);

    const out = await call("suggest_rule_marks", { rule_id: "r1", marks: [
      { verse_key: "19:47", word: 10, mark: "fits", note: "" },
      { verse_key: "7:187", word: 26, mark: "unsure", note: "said of the one asked, not of a lord" },
    ] });
    expect(out).toMatchObject({ suggested: 2, awaiting_review: true });
    const rule = await asReader("/research/rules/r1");
    expect(rule.counts).toEqual({ fits: 0, exception: 0, unsure: 0, suggested: 2 });
    expect(rule.marks.every((m: any) => m.source === "ai")).toBe(true);

    // the reader marks one place; a later suggestion leaves it alone
    await put("/research/rules/r1/marks", { marks: [{ verseKey: "19:47", word: 10, mark: "exception", note: "mine" }] });
    const again = await call("suggest_rule_marks", { rule_id: "r1", marks: [
      { verse_key: "19:47", word: 10, mark: "fits", note: "" },
      { verse_key: "7:187", word: 26, mark: "exception", note: "said of the one asked" },
    ] });
    expect(again).toMatchObject({ suggested: 1, left_alone: 1 });
    const read = await call("my_rule_checks", { rule_id: "r1" });
    expect(read.marks).toEqual([
      { verse_key: "7:187", word: 26, mark: "exception", note: "said of the one asked", by: "suggested" },
      { verse_key: "19:47", word: 10, mark: "exception", note: "mine", by: "reader" },
    ]);
  });

  it("suggest_rule_marks refuses an exception with no note, a place the āyah lacks, and an unknown rule", async () => {
    await expect(call("suggest_rule_marks", { rule_id: "r1", marks: [{ verse_key: "19:47", word: 10, mark: "exception", note: " " }] }))
      .rejects.toThrow(/needs a note/);
    await expect(call("suggest_rule_marks", { rule_id: "r1", marks: [{ verse_key: "19:47", word: 99, mark: "fits", note: "" }] }))
      .rejects.toThrow(/has \d+ words/);
    await expect(call("suggest_rule_marks", { rule_id: "nope", marks: [{ verse_key: "19:47", word: 10, mark: "fits", note: "" }] }))
      .rejects.toThrow(/No rule with id nope/);
  });

  it("propose_mentions → potential mentions on the reader's character; a pronoun needs its reason", async () => {
    await put("/research/characters/c1", { id: "c1", name: "ʿĪsā", note: "", designations: [{ kind: "lemma", key: "عِيسَى", text: "عِيسَى", as: "name" }] });
    const out = await call("propose_mentions", { character_id: "c1", kind: "name", filed_under: "عِيسَى",
      places: [{ verse_key: "19:34", word: 2, words: 1, note: "" }] });
    expect(out).toMatchObject({ proposed: 1, status: "potential", character: "ʿĪsā" });
    await expect(call("propose_mentions", { character_id: "c1", kind: "pronoun", filed_under: "",
      places: [{ verse_key: "19:30", word: 1, words: 1, note: "" }] })).rejects.toThrow(/needs a note/);
    await expect(call("propose_mentions", { character_id: "nobody", kind: "name", filed_under: "",
      places: [{ verse_key: "19:34", word: 2, words: 1, note: "" }] })).rejects.toThrow(/No character/);
    // filing the same place again changes nothing
    expect(await call("propose_mentions", { character_id: "c1", kind: "name", filed_under: "عِيسَى",
      places: [{ verse_key: "19:34", word: 2, words: 1, note: "" }] })).toMatchObject({ proposed: 0, left_alone: 1 });

    const listed = await call("my_characters", {});
    expect(listed.characters).toMatchObject([{ id: "c1", name: "ʿĪsā", mentions: { established: 0, potential: 1 } }]);
    const one = await call("my_characters", { character_id: "c1" });
    expect(one.mentions).toMatchObject([{ verse_key: "19:34", word: 2, kind: "name", status: "potential", proposed_by: "ai" }]);
    expect((await call("my_research_on", { verse_key: "19:34" })).characters_on_ayah)
      .toMatchObject([{ character: "ʿĪsā", verse_key: "19:34", status: "potential" }]);
  });

  it("the SERVER keeps rules, characters and decisions the reader's, even with the token directly", async () => {
    await expect(state.research.saveLink({ id: "ai_t1", a: { verseKey: "4:82", word: 1 }, b: { verseKey: "2:106", word: 1 }, kind: "tension", resolved: true, resolution: "by ai" }))
      .resolves.toMatchObject({ kind: "tension", resolved: false, resolution: "" });
    // an AI's mention asked for as established still lands potential
    await state.research.addMentions([{ characterId: "c1", verseKey: "3:45", word: 14, kind: "name", status: "established" }]);
    expect((await asReader("/research/mentions?verse=3:45"))[0]).toMatchObject({ status: "potential", source: "ai" });
  });

  it("a pronoun is proposed by its number in the word, so a word's two pronouns are two places", async () => {
    await put("/research/characters/c2", { id: "c2", name: "those addressed", note: "", designations: [] });
    // خَلَقْنَـٰكُمْ (7:11, word 2) carries two pronouns
    await expect(call("propose_mentions", { character_id: "c2", kind: "pronoun", filed_under: "",
      places: [{ verse_key: "7:11", word: 2, words: 1, note: "the ones created" }] })).rejects.toThrow(/which pronoun/);
    const out = await call("propose_mentions", { character_id: "c2", kind: "pronoun", filed_under: "",
      places: [{ verse_key: "7:11", word: 2, words: 1, part: 2, note: "the ones created" }] });
    expect(out).toMatchObject({ proposed: 1, status: "potential" });
    expect(await asReader("/research/mentions?character=c2")).toMatchObject([{ id: "c2|7:11|2|2", part: 2, kind: "pronoun", source: "ai" }]);
    expect((await call("my_characters", { character_id: "c2" })).mentions).toMatchObject([{ verse_key: "7:11", word: 2, part: 2 }]);
  });

  it("add_slip says what kind of work it cites, and propose_conclusion counts the cited works", async () => {
    const c = await call("open_case", { subject_type: "root", subject: "رحم", title: "what the case rests on", description: "" });
    const ev = await call("add_evidence", { case_id: c.case_id, ayat: [{ verse_key: "1:1" }, { verse_key: "1:3" }], expect_version: c.updated_at });
    const s1 = await call("add_slip", { case_id: c.case_id, kind: "reference", text: "the womb, and tenderness", form: null,
      source: "Lisān al-ʿArab", locator: "under ر-ح-م", source_kind: "lexicon", expect_version: ev.updated_at });
    const s2 = await call("add_slip", { case_id: c.case_id, kind: "reference", text: "a report", form: null,
      source: "a book", locator: "", expect_version: s1.updated_at });
    const saved = await asReader(`/research/cases/${c.case_id}`);
    expect(saved.slips.map((s: any) => s.sourceKind ?? null)).toEqual(["lexicon", null]);
    const out = await call("propose_conclusion", { case_id: c.case_id, kind: "verdict", form: null, text: "a test conclusion",
      reasoning: "", expect_version: s2.updated_at });
    expect(out).toMatchObject({ rests_on_ayahs: 2, rests_on_cited_works: { lexicon: 1, kind_not_said: 1 } });
  });

  it("propose_speaker carries who else hears and whether the speaker is stated", async () => {
    const out = await call("propose_speaker", { verse_key: "12:26", from_word: 1, speaker: "Yūsuf", addressee: "", also_hears: "a witness", speaker_is: "inferred", note: "" });
    const tags = await asReader("/research/speech?verse=12:26");
    expect(tags).toMatchObject([{ id: out.id, listeners: "a witness", basis: "inferred", source: "ai" }]);
  });
});
