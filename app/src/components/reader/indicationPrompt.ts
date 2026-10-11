// Builds the AI hand-off prompt for testing a proposed indication against every form
// of a root, and — when it holds — deriving each form's own BRIEF/DETAIL, which
// paste straight into the form's two fields in the Indication Editor.
//
// Written to work with a mid-grade model: hard rules first, the material next,
// then an explicit method, an exact output contract, and a format-only worked
// example on an unrelated root. The model must reason from the supplied lexicon
// and morphology only — never from how the Qur'an is conventionally translated.

import type { RootDetail } from "../../api/types";
import type { NoteRecord } from "../../persistence/types";

const spaced = (r: string) => r.split("").join(" ");

export interface PromptInput {
  root: string;
  detail: RootDetail | null;
  /** the indication being proposed, in the reader's words */
  indication: string;
  notes: NoteRecord[];
  /** anything extra the reader wants to steer the model with */
  instructions?: string;
}

/** Lexicon text as stored carries editorial apparatus that only burns tokens and
 *  distracts: [[...]] footnotes and '|' line separators. Strip them. */
function cleanEntry(text: string): string {
  return (text || "")
    // editorial footnotes — non-greedy to the closing "]]", since they often
    // contain nested single brackets (e.g. [[. قوله [وَلَكِنْ …] الذي …]])
    .replace(/\[\[[\s\S]*?\]\]/g, " ")
    .replace(/\s*\|\s*/g, "\n")        // stored line breaks
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Unique forms (lemmas) of the root, with part of speech and frequency. */
export function uniqueForms(detail: RootDetail | null) {
  const seen = new Set<string>();
  const out: { lemma: string; pos: string | null; count: number }[] = [];
  for (const f of detail?.forms ?? []) {
    const l = f.lemma_arabic;
    if (!l || seen.has(l)) continue;
    seen.add(l);
    out.push({ lemma: l, pos: f.pos_english, count: f.occurrence_count });
  }
  return out;
}

export function buildIndicationPrompt({ root, detail, indication, notes, instructions }: PromptInput): string {
  const forms = uniqueForms(detail);
  const meanings = detail?.meanings ?? [];
  const withText = notes.filter((n) => (n.text ?? "").trim());
  const n = forms.length;
  const L: string[] = [];

  // ---- role -----------------------------------------------------------------
  L.push("You are a classical Arabic morphologist helping to build the meaning of a Qur'anic");
  L.push("root from the inside out: from the root's concrete physical core and the shape (wazn)");
  L.push("of each derived form — not from how the word is customarily rendered.");
  L.push("");

  // ---- hard rules (stated before the material, repeated in the task) --------
  L.push("=== HARD RULES — follow all of them ===");
  L.push("1. IGNORE the traditional Qur'anic understanding of this root entirely. Disregard how");
  L.push("   tafsir and English/Urdu translations render it. Do not let conventional renderings");
  L.push("   enter your reasoning, not even as a sanity check or a 'this is usually translated");
  L.push("   as…' aside. If a familiar rendering comes to mind, set it aside deliberately.");
  L.push("2. Use ONLY the material supplied below: the classical lexicon entries, the list of");
  L.push("   forms with their part of speech, and my notes. Add no outside sources, no verses");
  L.push("   from memory, no hadith, no scholars' opinions.");
  L.push("3. IMPORTANT — the lexicon entries below quote the Qur'an and sometimes explain the");
  L.push("   word theologically (paradise, salvation, reward, the call to prayer, and so on).");
  L.push("   Those passages are LATER APPLICATION, not the word's core, and rule 1 applies to");
  L.push("   them too. Mine each entry instead for its concrete, physical, everyday indications —");
  L.push("   what the word does to soil, iron, a lip, a piece of wood — and for explicit");
  L.push("   statements of the root's origin (Maqāyīs in particular names the أصل/أصلان).");
  L.push("   Skip lines of poetry and grammarians' asides; they are illustration, not evidence.");
  L.push("4. Reason from morphology: what the specific pattern of each form does to the root");
  L.push("   idea (e.g. Form IV causative/entering-a-state, active participle = the one doing it,");
  L.push("   verbal noun = the act itself). Say which pattern you are relying on.");
  L.push("5. Never invent certainty. If the supplied material cannot settle a form, say");
  L.push("   'insufficient evidence' and explain what is missing.");
  L.push("6. Output ONLY the blocks specified in OUTPUT CONTRACT — no preamble, no closing");
  L.push("   remarks, no markdown headings, no bullet points outside the fields.");
  L.push("");

  // ---- the material ---------------------------------------------------------
  L.push("=== ROOT ===");
  L.push(spaced(root));
  if (detail) {
    L.push(`Occurrences in the Book: ${detail.total_occurrences} · distinct forms: ${n}`);
    if (detail.meaning_en) {
      L.push(`Corpus gloss (raw word-list, unranked — reference only): ${detail.meaning_en}`);
    }
  }
  L.push("");

  L.push("=== PROPOSED ROOT SENSE (the hypothesis you must test) ===");
  L.push(indication.trim());
  L.push("");

  L.push(`=== THE ${n} FORM${n === 1 ? "" : "S"} OF THIS ROOT ===`);
  if (n === 0) L.push("(none listed)");
  forms.forEach((f, i) => {
    L.push(`${i + 1}. ${f.lemma}${f.pos ? `  —  ${f.pos}` : ""}  —  occurs ${f.count}×`);
  });
  L.push("");

  L.push(`=== CLASSICAL LEXICON ENTRIES (${meanings.length}) — your only external evidence ===`);
  if (meanings.length === 0) L.push("(none available)");
  meanings.forEach((m, i) => {
    L.push(`--- entry ${i + 1}: ${m.source}${m.language ? ` (${m.language})` : ""} ---`);
    L.push(cleanEntry(m.meaning));
  });
  L.push("");

  L.push(`=== MY NOTES & OPEN QUESTIONS ON THIS ROOT (${withText.length}) ===`);
  if (withText.length === 0) L.push("(none)");
  for (const note of withText) {
    const tag = note.kind === "question" ? "QUESTION" : "NOTE";
    const where = `${note.verseKey}${note.wordPosition != null ? ` w${note.wordPosition}` : ""}`;
    const form = note.lemma ? ` · form ${note.lemma}` : "";
    L.push(`- [${tag} · ${where}${form}] ${note.text.trim()}`);
    if (note.answer?.trim()) L.push(`  (my answer so far: ${note.answer.trim()})`);
  }
  L.push("");

  if (instructions?.trim()) {
    L.push("=== MY SPECIAL INSTRUCTIONS (these take priority over style defaults, ===");
    L.push("=== but never override the HARD RULES above) ===");
    L.push(instructions.trim());
    L.push("");
  }

  // ---- method ---------------------------------------------------------------
  L.push("=== METHOD — work through these steps silently, then output only the contract ===");
  L.push("Step 1. Read every lexicon entry and pull out (a) the concrete, physical uses and");
  L.push("        (b) any explicit statement of the root's origin. Set aside the theological");
  L.push("        and Qur'an-quoting passages per rule 3. From what remains, state the root's");
  L.push("        most concrete core idea — what it does in the material world — in one line.");
  L.push("        If the entries name more than one origin, say so and note which the physical");
  L.push("        evidence supports more strongly.");
  L.push("Step 2. Check the PROPOSED ROOT SENSE against that core: is it the same idea, or an");
  L.push("        abstraction that has drifted from it? Sharpen the wording if needed.");
  L.push("Step 3. For each form in order, apply its morphological pattern to the root indication and");
  L.push("        ask: does the result describe a coherent Arabic word? That is the test — not");
  L.push("        whether it matches any familiar translation.");
  L.push("Step 4. Where it holds, PIVOT the root indication into that form's own specific meaning:");
  L.push("        the same underlying idea, bent by what the pattern does to it.");
  L.push("Step 5. Where it strains or fails, say so and propose the shade that would fit better.");
  L.push("");

  // ---- output contract ------------------------------------------------------
  L.push("=== OUTPUT CONTRACT — produce exactly this, nothing else ===");
  L.push("");
  L.push("First one ROOT block:");
  L.push("");
  L.push("ROOT SENSE");
  L.push("VERDICT: holds | needs adjustment | does not hold");
  L.push("BRIEF: <2-5 words. The root indication in its sharpest form. Lowercase, no final period.>");
  L.push("DETAIL: <1-3 sentences. The root's core idea in plain English, tied to the physical");
  L.push("        core from Step 1. No verse references, no traditional renderings.>");
  L.push("");
  L.push(`Then exactly ${n} FORM block${n === 1 ? "" : "s"}, one per form, in the order listed above:`);
  L.push("");
  L.push("FORM: <the Arabic form, copied exactly as given>");
  L.push("VERDICT: fits | partially fits | does not fit | insufficient evidence");
  L.push("PATTERN: <the wazn / morphological role you relied on, e.g. Form IV, active participle>");
  L.push("BRIEF: <2-5 words. This form's meaning, pivoted from the root indication. Lowercase, no");
  L.push("       final period. Must read as a specialisation of the root BRIEF, not a synonym");
  L.push("       of it, and not a conventional translation.>");
  L.push("DETAIL: <1-3 sentences. What this form specifically says: who/what is doing the root");
  L.push("        idea, in what state, to what. Plain English, traceable back to the root indication.>");
  L.push("WHY: <2-3 sentences. How the pattern acting on the root core produces that meaning,");
  L.push("     citing the lexicon entries you used by name.>");
  L.push("ALTERNATIVE: <only if VERDICT is not 'fits': the shade that would fit this form better,");
  L.push("             else write: none>");
  L.push("CONFIDENCE: high | medium | low");
  L.push("");
  L.push("Then one closing block:");
  L.push("");
  L.push("OVERALL: <one short paragraph: does the proposed indication hold across the whole root?>");
  L.push("WEAKEST LINK: <the form that fits least well, and the one thing that would settle it>");
  L.push("");
  L.push("Field rules: BRIEF and DETAIL are pasted directly into my notes, so write them as");
  L.push("finished text — no hedging inside them, no quotation marks, no 'possibly/perhaps'.");
  L.push("Put all uncertainty in VERDICT and CONFIDENCE instead.");
  L.push("");

  // ---- format-only few-shot on an unrelated root ----------------------------
  L.push("=== FORMAT EXAMPLE (a DIFFERENT root, shown only so you copy the shape) ===");
  L.push("Do not reuse any of this content or let it influence your analysis.");
  L.push("");
  L.push("ROOT SENSE");
  L.push("VERDICT: holds");
  L.push("BRIEF: to inscribe by pressing");
  L.push("DETAIL: The root turns on making a lasting mark by pressing one thing into another,");
  L.push("DETAIL: so that what was loose becomes fixed and readable.");
  L.push("");
  L.push("FORM: كَتَبَ");
  L.push("VERDICT: fits");
  L.push("PATTERN: Form I past verb, the bare act");
  L.push("BRIEF: he pressed a mark in");
  L.push("DETAIL: The agent performs the inscribing himself, fixing something that was until then");
  L.push("DETAIL: unfixed. The emphasis is on the act, not on what results from it.");
  L.push("WHY: Form I carries the root idea with nothing added, so the physical indication of pressing");
  L.push("WHY: a mark stands unmodified; entry 1 gives that concrete core.");
  L.push("ALTERNATIVE: none");
  L.push("CONFIDENCE: high");
  L.push("");
  L.push("=== END OF EXAMPLE — now analyse the root given above ===");

  return L.join("\n");
}
