// Build a rich, plain-text bundle for an āyah or a root — Arabic, translations,
// each root with its meaning and derived forms, plus the reader's own notes and
// questions — ready to hand to an AI app (Gemini, etc.) via the OS share sheet.

import type { QuranApi } from "../data/api";
import type { Db } from "../data/db";
import type { Word } from "../types";
import { notesForRoot, notesForVerse, userRootMeaning } from "../data/research";

const clean = (t: string) => (t ?? "").replace(/[\uE000-\uF8FF\u200B-\u200F\uFEFF]/g, "").trim();
const cnum = (k: string) => Number(k.split(":")[0]);

function rootBlock(q: QuranApi, research: Db, bw: string): string[] {
  const d = q.root(bw);
  if (!d) return [];
  const lines: string[] = [];
  lines.push(`• ${d.root_arabic}${d.meaning_en ? ` — ${d.meaning_en}` : ""}  (${d.total_occurrences}×)`);
  const forms = (d.forms ?? [])
    .map((f) => `${f.lemma_arabic ?? f.lemma_buckwalter}${f.occurrence_count ? ` (${f.occurrence_count})` : ""}`)
    .join("، ");
  if (forms) lines.push(`    forms: ${forms}`);
  const mine = userRootMeaning(research, bw);
  if (mine) lines.push(`    my meaning: ${mine}`);
  return lines;
}

/** Everything about one āyah, for pasting into an AI chat. */
export function composeAyahShare(q: QuranApi, research: Db, verseKey: string, editionIds: Set<number>): string {
  const surah = q.chapter(cnum(verseKey))?.name_simple ?? "";
  const arabic = clean((q.verse(verseKey, { script: "uthmani" })?.text as string) ?? "");
  const words = ((q.verse(verseKey, { script: "uthmani", withWords: true })?.words ?? []) as Word[]).filter((w) => w.pos != null);
  const trans = editionIds.size ? q.verseTranslations(verseKey).filter((t) => editionIds.has(t.resource_id)) : [];

  const seen = new Set<string>();
  const roots: string[] = [];
  for (const w of words) if (w.root_buckwalter && !seen.has(w.root_buckwalter)) { seen.add(w.root_buckwalter); roots.push(w.root_buckwalter); }

  const L: string[] = [];
  L.push("Please help me study this Qur'anic āyah through its root vocabulary.");
  L.push("");
  L.push(`Qur'an ${verseKey} — Sūrah ${surah}`);
  L.push("");
  L.push(arabic);
  if (trans.length) {
    L.push("");
    L.push("Translation:");
    for (const t of trans) L.push(`  ${t.text}  — ${t.resource_name ?? t.language_name}`);
  }
  if (roots.length) {
    L.push("");
    L.push("Roots & derived forms:");
    for (const bw of roots) L.push(...rootBlock(q, research, bw));
  }
  const notes = notesForVerse(research, verseKey);
  if (notes.length) {
    L.push("");
    L.push("My notes & questions:");
    for (const n of notes) {
      const tag = n.kind === "question" ? "Question" : "Note";
      const loc = n.word_position != null ? ` (word ${n.word_position})` : "";
      L.push(`  • [${tag}]${loc} ${n.text}`);
      if (n.answer) L.push(`      → ${n.answer}`);
    }
  }
  return L.join("\n");
}

/** Everything about one root, for pasting into an AI chat. */
export function composeRootShare(q: QuranApi, research: Db, rootBw: string): string {
  const d = q.root(rootBw);
  if (!d) return "";
  const L: string[] = [];
  L.push("Please help me study this Qur'anic root.");
  L.push("");
  L.push(`Root ${d.root_arabic}${d.meaning_en ? ` — ${d.meaning_en}` : ""}  (${d.total_occurrences}× · ${d.forms.length} forms)`);
  const forms = (d.forms ?? [])
    .map((f) => `${f.lemma_arabic ?? f.lemma_buckwalter}${f.occurrence_count ? ` (${f.occurrence_count})` : ""}`)
    .join("، ");
  if (forms) { L.push(""); L.push(`Derived forms: ${forms}`); }
  const dicts = (d.meanings ?? []).slice(0, 6);
  if (dicts.length) {
    L.push("");
    L.push("Dictionary senses:");
    for (const m of dicts) L.push(`  • (${m.source}) ${m.meaning}`);
  }
  const mine = userRootMeaning(research, rootBw);
  if (mine) { L.push(""); L.push(`My meaning: ${mine}`); }
  const notes = notesForRoot(research, d.root_arabic);
  if (notes.length) {
    L.push("");
    L.push("My notes & questions:");
    for (const n of notes) {
      const tag = n.kind === "question" ? "Question" : "Note";
      L.push(`  • [${tag}] ${n.text}${n.answer ? `  → ${n.answer}` : ""}`);
    }
  }
  return L.join("\n");
}
