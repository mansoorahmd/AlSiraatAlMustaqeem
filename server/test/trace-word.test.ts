// trace_word: three defects found by inspection, each pinned here.
//
// 1. `count` was the length of the RETURNED list, so limit=5 on a 99-occurrence root
//    reported "count: 5" — indistinguishable from a root that occurs five times.
// 2. exact mode returned bare coordinates (verse_key + word_position) with no verse
//    text and no word, while root mode returned text — so following a spelling gave
//    nothing to reason from.
// 3. exact mode matches the WHOLE written word, so ٱلصَّلَوٰةَ is a different rasm from
//    صلوٰة. Tracing صلوٰة reported 2 while 65 occurrences sat inside prefixed spellings,
//    silently under-reporting by a factor of 30.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QF_RESEARCH_DB = join(mkdtempSync(join(tmpdir(), "alsiraat-trace-")), "r.db");

let state: any;
let trace: any;

beforeAll(async () => {
  const { openState } = await import("../../mcp/src/core.js");
  const { TOOLS } = await import("../../mcp/src/tools.js");
  state = await openState();
  trace = TOOLS.find((t) => t.name === "trace_word");
});

describe("trace_word — root family", () => {
  it("reports the true total even when the list is truncated", () => {
    const few = trace.run(state, { word: "صلو", exact: false, limit: 5 });
    const all = trace.run(state, { word: "صلو", exact: false, limit: 300 });
    // the total must not depend on the limit
    expect(few.total).toBe(all.total);
    expect(few.total).toBeGreaterThan(90);
    expect(few.returned).toBe(5);
    expect(few.truncated).toBe(true);
    expect(all.truncated).toBe(false);
  });

  it("gives each occurrence its form and verse text", () => {
    const r = trace.run(state, { word: "صلو", exact: false, limit: 3 });
    expect(r.occurrences.every((o: any) => o.verse_key && o.form && o.text)).toBe(true);
  });

  it("refuses a root that does not exist, pointing at exact=true", () => {
    expect(trace.run(state, { word: "زقتل", exact: false, limit: 5 }).error).toMatch(/exact=true/);
  });
});

describe("trace_word — exact written word", () => {
  it("does not present the bare spelling as the word's whole frequency", () => {
    const r = trace.run(state, { word: "صلوٰة", exact: true, limit: 300 });
    // the bare form really is rare — that part was never wrong
    expect(r.total).toBe(2);
    // ...but the prefixed spellings must be surfaced, not silently omitted
    const related = r.also_written as { surface: string; count: number }[];
    expect(related.length).toBeGreaterThan(0);
    expect(related.reduce((s, x) => s + x.count, 0)).toBeGreaterThan(50);
    expect(r.note).toMatch(/BARE spelling/);
  });

  it("returns the word and its verse text, not just coordinates", () => {
    const r = trace.run(state, { word: "صلوٰة", exact: true, limit: 10 });
    expect(r.occurrences.length).toBeGreaterThan(0);
    for (const o of r.occurrences) {
      expect(o.verse_key).toBeTruthy();
      expect(o.word_position).toBeGreaterThan(0);
      expect(typeof o.word).toBe("string");
      expect(typeof o.text).toBe("string");
    }
  });

  it("works for a rootless word (a particle), which is the point of exact mode", () => {
    const r = trace.run(state, { word: "إِيَّاكَ", exact: true, limit: 10 });
    expect(r.total).toBeGreaterThan(0);
    expect(r.occurrences[0].verse_key).toBe("1:5");
  });

  it("ignores diacritics: a bare-consonant query finds the vocalised word", () => {
    const withMarks = trace.run(state, { word: "إِيَّاكَ", exact: true, limit: 10 });
    const without = trace.run(state, { word: "إياك", exact: true, limit: 10 });
    expect(without.total).toBe(withMarks.total);
  });
});

// The bug the reader hit: "follow this word" on ٱلرَّحْمَٰنِ in 1:1 showed one occurrence.
// Cause: the DISPLAYED verse text writes it with a TATWEEL (U+0640) — ٱلرَّحْمَـٰنِ — while
// the morphology segments that build the index do not. rasmKey kept the tatweel because
// it falls inside the letter range, so the tapped token matched nothing and the trail
// showed only its own seed hop. The reader can also display imlāʾī / indopak /
// simplified text, where the same word is الرحمن, so a folded fallback backs it up.
describe("trace_word — a word tapped in the reader must match the index", () => {
  const SCRIPTS = ["uthmani", "uthmani_simple", "imlaei", "imlaei_simple", "indopak"] as const;

  it("finds every ٱلرَّحْمَٰنِ from the token of ANY display script", async () => {
    const { createState } = await import("../src/state.js");
    const s: any = state ?? createState();
    for (const script of SCRIPTS) {
      const verse: any = s.content.getVerse("1:1", { script });
      const token = String(verse.text).split(/\s+/)[2]; // ٱلرَّحْمَٰنِ
      const r = trace.run(s, { word: token, exact: true, limit: 300 });
      expect(r.total, `script ${script} (token ${token})`).toBe(45);
    }
  });

  it("the tatweel form and the plain form are the same word", () => {
    const withTatweel = trace.run(state, { word: "ٱلرَّحْمَـٰنِ", exact: true, limit: 300 });
    const without = trace.run(state, { word: "ٱلرَّحْمَٰنِ", exact: true, limit: 300 });
    expect(withTatweel.total).toBe(without.total);
    expect(withTatweel.total).toBe(45);
  });
});
