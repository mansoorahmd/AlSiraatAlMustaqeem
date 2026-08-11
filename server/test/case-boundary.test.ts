// The Investigate board write boundary, as chosen by the reader:
//   create cases + add items freely · edit/delete ONLY your own items ·
//   never write verdict/status/formResearch (propose instead) ·
//   refuse a write against a stale copy, because a case is rewritten whole.
//
// These are the tests that matter most: this is the first surface where an AI can
// modify the reader's existing work, so each prohibition gets an explicit test.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QF_RESEARCH_DB = join(mkdtempSync(join(tmpdir(), "alsiraat-case-")), "r.db");

let state: any;
let T: Map<string, any>;
const call = (name: string, args: any) => T.get(name)!.run(state, args);

beforeAll(async () => {
  const { openState } = await import("../../mcp/src/core.js");
  const { TOOLS } = await import("../../mcp/src/tools.js");
  state = await openState();
  T = new Map(TOOLS.map((t) => [t.name, t]));
});

/** a case as the READER would have made it: no source tags anywhere */
function seedReaderCase() {
  const now = Date.now();
  return state.research.saveCase({
    id: `case_reader_${now}_${Math.random().toString(36).slice(2, 7)}`,
    subject: { type: "root", value: "رحم" },
    title: "the reader's own case",
    cards: [{ id: "card_mine", verseKey: "1:1", wordPosition: null, x: 20, y: 20, rotation: 0 }],
    slips: [{ id: "slip_mine", kind: "comment", form: null, text: "my own note", x: 400, y: 20, rotation: 0 }],
    threads: [], clusters: [], formResearch: {},
    verdict: "my verdict", status: "partial", createdAt: now, updatedAt: now,
  });
}

describe("case boundary — what the AI may do", () => {
  it("opens a case and adds evidence, slips, links and groups", () => {
    const opened = call("open_case", {
      subject_type: "root", subject: "رحم", title: "AI case", description: "test",
    });
    expect(opened.created).toBe(true);

    const ev = call("add_evidence", {
      case_id: opened.case_id,
      ayat: [{ verse_key: "1:1" }, { verse_key: "1:3" }],
      expect_version: opened.updated_at,
    });
    expect(ev.added.length).toBe(2);

    const slip = call("add_slip", {
      case_id: opened.case_id, kind: "comment", text: "both are the same construction",
      form: null, source: "", locator: "", expect_version: ev.updated_at,
    });
    const link = call("link_evidence", {
      case_id: opened.case_id, from_id: ev.added[0].id, to_id: ev.added[1].id,
      label: "same construction", expect_version: slip.updated_at,
    });
    const group = call("group_evidence", {
      case_id: opened.case_id, name: "physical sense",
      item_ids: [ev.added[0].id, slip.added], expect_version: link.updated_at,
    });
    expect(group.added).toBeTruthy();

    // cards must not be stacked on the same spot
    const full = call("read_case", { case_id: opened.case_id });
    const raw = state.research.getCase(opened.case_id);
    const spots = new Set([...raw.cards, ...raw.slips].map((i: any) => `${i.x},${i.y}`));
    expect(spots.size).toBe(raw.cards.length + raw.slips.length);
    expect(full.evidence.every((e: any) => e.added_by === "you")).toBe(true);
  });

  it("skips an āyah already on the board, and a nonexistent one", () => {
    const c = call("open_case", { subject_type: "root", subject: "رحم", title: "dupes", description: "" });
    const first = call("add_evidence", { case_id: c.case_id, ayat: [{ verse_key: "2:2" }], expect_version: c.updated_at });
    const again = call("add_evidence", {
      case_id: c.case_id, ayat: [{ verse_key: "2:2" }, { verse_key: "999:1" }],
      expect_version: first.updated_at,
    });
    expect(again.added.length).toBe(0);
    expect(again.skipped.length).toBe(2);
  });

  it("edits and removes its OWN items", () => {
    const c = call("open_case", { subject_type: "root", subject: "رحم", title: "own", description: "" });
    const s = call("add_slip", {
      case_id: c.case_id, kind: "comment", text: "first wording", form: null,
      source: "", locator: "", expect_version: c.updated_at,
    });
    const r = call("revise_own_item", {
      case_id: c.case_id, item_id: s.added, action: "retext", text: "better wording",
      expect_version: s.updated_at,
    });
    expect(state.research.getCase(c.case_id).slips[0].text).toBe("better wording");
    call("revise_own_item", { case_id: c.case_id, item_id: s.added, action: "remove", text: "", expect_version: r.updated_at });
    expect(state.research.getCase(c.case_id).slips.length).toBe(0);
  });
});

describe("case boundary — what the AI may NOT do", () => {
  it("refuses to edit or delete the reader's own card or slip", () => {
    const mine = seedReaderCase();
    for (const id of ["card_mine", "slip_mine"]) {
      expect(() => call("revise_own_item", {
        case_id: mine.id, item_id: id, action: "remove", text: "", expect_version: mine.updatedAt,
      })).toThrow(/reader's own work/);
    }
    const after = state.research.getCase(mine.id);
    expect(after.cards.length).toBe(1);
    expect(after.slips.length).toBe(1);
  });

  it("never writes verdict, status or formResearch — even while adding to the board", () => {
    const mine = seedReaderCase();
    const ev = call("add_evidence", { case_id: mine.id, ayat: [{ verse_key: "2:3" }], expect_version: mine.updatedAt });
    const after = state.research.getCase(mine.id);
    expect(after.verdict).toBe("my verdict");   // untouched
    expect(after.status).toBe("partial");        // untouched
    expect(after.cards.length).toBe(2);          // but the evidence did land
    expect(ev.added.length).toBe(1);
  });

  it("parks a proposed conclusion without applying it", () => {
    const mine = seedReaderCase();
    const p = call("propose_conclusion", {
      case_id: mine.id, kind: "verdict", form: null, text: "the root means X",
      reasoning: "because", suggested_status: "closed", expect_version: mine.updatedAt,
    });
    expect(p.applied).toBe(false);
    const after = state.research.getCase(mine.id);
    expect(after.verdict).toBe("my verdict"); // NOT overwritten
    expect(after.status).toBe("partial");     // NOT closed
    expect(after.proposals.entries.length).toBe(1);
    // and the reader can see it waiting
    expect(call("read_case", { case_id: mine.id }).awaiting_reader.length).toBe(1);
  });

  it("marking a form established stays a proposal, not formResearch", () => {
    const mine = seedReaderCase();
    call("propose_conclusion", {
      case_id: mine.id, kind: "form", form: "رَّحْمَٰن", text: "means Y",
      reasoning: "", expect_version: mine.updatedAt,
    });
    expect(state.research.getCase(mine.id).formResearch).toEqual({});
  });

  it("refuses a write based on a stale read, so the reader is never clobbered", () => {
    const mine = seedReaderCase();
    const stale = mine.updatedAt;
    // the reader edits in the app meanwhile
    state.research.saveCase({ ...state.research.getCase(mine.id), title: "renamed by me" });
    expect(() => call("add_evidence", {
      case_id: mine.id, ayat: [{ verse_key: "2:4" }], expect_version: stale,
    })).toThrow(/changed since you read it/);
    expect(state.research.getCase(mine.id).title).toBe("renamed by me");
  });

  it("refuses to link or group items that are not on the case", () => {
    const c = call("open_case", { subject_type: "root", subject: "رحم", title: "x", description: "" });
    expect(() => call("link_evidence", {
      case_id: c.case_id, from_id: "nope", to_id: "nope2", label: "l", expect_version: c.updated_at,
    })).toThrow(/not a card or slip/);
    expect(() => call("group_evidence", {
      case_id: c.case_id, name: "g", item_ids: ["nope"], expect_version: c.updated_at,
    })).toThrow(/Not on this case/);
  });

  it("does not mistake a slip's cited source for provenance", () => {
    // SlipRecord.source is the WORK BEING CITED ("Lane's Lexicon"), not who wrote the
    // slip (that is `author`). A reader's reference slip must stay untouchable.
    const now = Date.now();
    const c = state.research.saveCase({
      id: `case_cite_${now}`,
      subject: { type: "root", value: "رحم" }, title: "citation slip",
      cards: [],
      slips: [{ id: "slip_cited", kind: "reference", form: null, text: "quoted",
                source: "Lane's Lexicon", locator: "vol 3", x: 20, y: 20, rotation: 0 }],
      threads: [], clusters: [], formResearch: {}, verdict: "", status: "open",
      createdAt: now, updatedAt: now,
    });
    expect(() => call("revise_own_item", {
      case_id: c.id, item_id: "slip_cited", action: "remove", text: "", expect_version: c.updatedAt,
    })).toThrow(/reader's own work/);
  });

  it("requires a source on a reference slip", () => {
    const c = call("open_case", { subject_type: "root", subject: "رحم", title: "y", description: "" });
    expect(() => call("add_slip", {
      case_id: c.case_id, kind: "reference", text: "quoted", form: null,
      source: "", locator: "", expect_version: c.updated_at,
    })).toThrow(/needs `source`/);
  });
});
