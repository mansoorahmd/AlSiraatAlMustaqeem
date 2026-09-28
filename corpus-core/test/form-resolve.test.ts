// Regression: how propose_indication matches a caller's refinement form against
// a root's real derived forms. This is what caused the "diacritic-mismatch"
// bounce — the bare vow-noun نَّذْر was rejected because the model spelled it
// without the corpus's shadda, and three forms of نذر share one skeleton.
//
// The resolver must: take an exact spelling as-is; forgive vowel differences when
// only one form fits; and, when several forms collapse to the same letters, refuse
// to guess and return the candidates rather than silently attaching to the wrong
// one (or bouncing with no way forward).

import { describe, it, expect } from "vitest";
import { makeFormResolver, type FormRef } from "../../mcp/src/tools.js";

// the real نذر family from quran.db (letters ن ذ ر recur across verb + nouns)
const NADHR: FormRef[] = [
  { form: "نَذِير", pos: "Noun", occurrences: 58 },
  { form: "أَنذَرَ", pos: "Verb", occurrences: 44 },
  { form: "مُنذِر", pos: "Noun", occurrences: 15 },
  { form: "مُنذَرِين", pos: "Noun", occurrences: 5 },
  { form: "نَذَرْ", pos: "Verb", occurrences: 4 },
  { form: "نَّذْر", pos: "Noun", occurrences: 2 },
  { form: "نُذُور", pos: "Noun", occurrences: 1 },
  { form: "نُذْر", pos: "Noun", occurrences: 1 },
];

describe("form resolver for refinements", () => {
  const resolve = makeFormResolver(NADHR);

  it("takes an exact spelling verbatim", () => {
    expect(resolve("نَذِير")).toEqual({ form: "نَذِير" });
    expect(resolve("نَّذْر")).toEqual({ form: "نَّذْر" });
  });

  it("forgives vowel/shadda differences when only one form fits", () => {
    // مُنذِر written without its harakat — unique skeleton منذر
    expect(resolve("منذر")).toEqual({ form: "مُنذِر" });
    // نُذُور offered without vowels — unique skeleton نذور
    expect(resolve("نذور")).toEqual({ form: "نُذُور" });
  });

  it("does NOT silently attach when several forms share the skeleton", () => {
    // this is the exact failure: model sends نَذْر (no shadda) for the vow.
    // نذر is the verb نَذَرْ, the vow-noun نَّذْر AND the noun نُذْر.
    const m = resolve("نَذْر") as { ambiguous: FormRef[] };
    expect("ambiguous" in m).toBe(true);
    expect(m.ambiguous.map((c) => c.form).sort()).toEqual(["نَذَرْ", "نَّذْر", "نُذْر"].sort());
  });

  it("reports a genuinely unknown form", () => {
    expect(resolve("كتاب")).toEqual({ unknown: true });
  });

  it("accepts Buckwalter too — the same folding, either script", () => {
    // bare (vowel-less) Buckwalter → skeleton match, exactly like bare Arabic
    expect(resolve("mn*r")).toEqual({ form: "مُنذِر" });   // منذر
    expect(resolve("n*wr")).toEqual({ form: "نُذُور" });   // نذور
    // voweled Buckwalter that maps to an exact stored spelling
    expect(resolve("na*iyr")).toEqual({ form: "نَذِير" });
    // a Buckwalter skeleton shared by several forms is still refused, not guessed
    const m = resolve("n*r") as { ambiguous: FormRef[] };
    expect("ambiguous" in m).toBe(true);
    expect(m.ambiguous.map((c) => c.form).sort()).toEqual(["نَذَرْ", "نَّذْر", "نُذْر"].sort());
    // genuinely unknown in Buckwalter, too
    expect(resolve("ktAb")).toEqual({ unknown: true });
  });

  it("accepts a POS-homograph: one spelling analysed as two forms is not ambiguous", () => {
    // رَّحِيم is both Adjective and Noun in the corpus — same spelling, two rows.
    // A refinement keys to the spelling, so this must resolve, not bounce.
    const rahim: FormRef[] = [
      { form: "رَّحِيم", pos: "Adjective", occurrences: 112 },
      { form: "رَّحِيم", pos: "Noun", occurrences: 4 },
      { form: "رَّحْمَٰن", pos: "Noun", occurrences: 45 },
      { form: "رَّحْمَٰن", pos: "Adjective", occurrences: 12 },
    ];
    const r = makeFormResolver(rahim);
    // loose vowels / mark ordering — the fold ignores diacritics entirely
    expect(r("رحيم")).toEqual({ form: "رَّحِيم" });
    expect(r("رحمن")).toEqual({ form: "رَّحْمَٰن" });
  });
});
