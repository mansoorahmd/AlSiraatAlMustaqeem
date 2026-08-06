// Builds the AI hand-off prompt for testing a proposed sense against every form
// of a root. The model is told to reason ONLY from the material we supply — the
// reader's own lexicon entries and their notes/questions — so the answer stays
// inside the organic, corpus-first method rather than importing outside tafsir.

import type { RootDetail } from "../../api/types";
import type { NoteRecord } from "../../persistence/types";

const spaced = (r: string) => r.split("").join(" ");

export interface PromptInput {
  root: string;
  detail: RootDetail | null;
  /** the sense being proposed, in the reader's words */
  sense: string;
  notes: NoteRecord[];
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

export function buildSensePrompt({ root, detail, sense, notes }: PromptInput): string {
  const forms = uniqueForms(detail);
  const L: string[] = [];

  L.push("You are helping with a Qur'anic root study that builds meaning from the Book's own");
  L.push("usage (an organic, corpus-first method) rather than from received translation.");
  L.push("");
  L.push(`ROOT: ${spaced(root)}`);
  if (detail) {
    L.push(`Occurrences: ${detail.total_occurrences} · distinct forms: ${forms.length}`);
    if (detail.meaning_en) L.push(`Corpus gloss (reference only): ${detail.meaning_en}`);
  }
  L.push("");
  L.push("PROPOSED SENSE TO EVALUATE");
  L.push(`"${sense.trim()}"`);
  L.push("");

  L.push(`FORMS OF THIS ROOT (${forms.length}) — the sense must be judged against each`);
  if (forms.length === 0) L.push("(none listed)");
  forms.forEach((f, i) => {
    L.push(`${i + 1}. ${f.lemma}${f.pos ? ` — ${f.pos}` : ""} — ${f.count}× in the Book`);
  });
  L.push("");

  const meanings = detail?.meanings ?? [];
  L.push(`DICTIONARY ENTRIES (${meanings.length}) — the ONLY external evidence you may use`);
  if (meanings.length === 0) L.push("(none available)");
  for (const m of meanings) {
    L.push(`[${m.source}${m.language ? ` · ${m.language}` : ""}] ${m.meaning}`);
  }
  L.push("");

  const withText = notes.filter((n) => (n.text ?? "").trim());
  L.push(`MY NOTES & OPEN QUESTIONS ON THIS ROOT (${withText.length})`);
  if (withText.length === 0) L.push("(none)");
  for (const n of withText) {
    const tag = n.kind === "question" ? "Question" : "Note";
    const where = `${n.verseKey}${n.wordPosition != null ? ` w${n.wordPosition}` : ""}`;
    const form = n.lemma ? ` · form ${n.lemma}` : "";
    L.push(`- [${tag} · ${where}${form}] ${n.text.trim()}`);
    if (n.answer?.trim()) L.push(`  My answer: ${n.answer.trim()}`);
  }
  L.push("");

  L.push("TASK");
  L.push("For EACH form listed above, judge whether the proposed sense can legitimately carry");
  L.push("that form's usage. Reason from the form's morphology (its pattern/wazn and part of");
  L.push("speech) together with the dictionary entries above. Use ONLY the material given here —");
  L.push("do not import outside tafsir, translations, or lore. Where the evidence provided is");
  L.push("insufficient to decide, say so plainly instead of guessing. Note any form where the");
  L.push("proposed sense strains, and say what shade would fit that form better.");
  L.push("");
  L.push("OUTPUT FORMAT — repeat this block once per form, in the order listed, and nothing else:");
  L.push("");
  L.push("FORM: <the Arabic form>");
  L.push("VERDICT: fits | partially fits | does not fit | insufficient evidence");
  L.push("FORM MEANING: <one line — this form's specific shade of the proposed sense>");
  L.push("REASONING: <2-3 sentences, grounded in the morphology and the entries above>");
  L.push("EVIDENCE USED: <which dictionary sources, by name>");
  L.push("CONFIDENCE: high | medium | low");
  L.push("");
  L.push("Then close with:");
  L.push("");
  L.push("OVERALL: <does the proposed sense hold across the whole root? One short paragraph.>");
  L.push("WEAKEST LINK: <the form that fits least well, and why>");

  return L.join("\n");
}
