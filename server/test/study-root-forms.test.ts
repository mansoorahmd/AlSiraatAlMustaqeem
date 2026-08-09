// Regression: study_root must report EVERY (spelling, part-of-speech) form row,
// not one per spelling. It used to dedupe forms by spelling with a Map, which kept
// only the last row and dropped the other — so رحم reported رَّحِيم ×4 (the Noun)
// while silently dropping the ×112 Adjective, and رَّحْمَٰن ×12 while dropping the
// ×45 Noun. The per-form counts then no longer summed to the root total.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// isolate research writes to a throwaway db (study_root only reads, but createState
// opens research.db read-write and migrates it)
process.env.QF_RESEARCH_DB = join(mkdtempSync(join(tmpdir(), "alsiraat-sr-")), "r.db");

let study: any;
let state: any;

beforeAll(async () => {
  const { openState } = await import("../../mcp/src/core.js");
  const { TOOLS } = await import("../../mcp/src/tools.js");
  state = await openState();
  study = TOOLS.find((t) => t.name === "study_root");
});

describe("study_root form counts", () => {
  it("keeps every (spelling, pos) row and they sum to the root total (رحم)", () => {
    const r = study.run(state, { root: "رحم", occurrences: 0 });
    // the per-form counts reconcile with the root total — the whole point
    expect(r.forms.reduce((s: number, f: any) => s + f.occurrences, 0)).toBe(r.total_occurrences);
    expect(r.total_occurrences).toBe(339);
    // homographs are preserved: more rows than distinct spellings
    const spellings = new Set(r.forms.map((f: any) => f.form));
    expect(r.forms.length).toBeGreaterThan(spellings.size);
    // the two counts the old dedupe used to drop are present
    const counts = r.forms.map((f: any) => f.occurrences);
    expect(counts).toContain(112); // رَّحِيم Adjective
    expect(counts).toContain(45); //  رَّحْمَٰن Noun
  });
});
