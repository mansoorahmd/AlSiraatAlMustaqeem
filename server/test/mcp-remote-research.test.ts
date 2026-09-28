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
