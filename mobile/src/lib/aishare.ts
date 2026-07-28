// Build a rich, plain-text bundle for an āyah or a root — Arabic, translations,
// each root with its meaning and derived forms, plus the reader's own notes and
// questions — ready to hand to an AI app (Gemini, etc.) via the OS share sheet.
// A user-chosen prompt line and a dictionary-source filter tailor the output.

import { Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import type { QuranApi } from "../data/api";
import type { Db } from "../data/db";
import type { Word } from "../types";
import { notesForRoot, notesForVerse, userRootMeaning } from "../data/research";
import { toast } from "../ui/toast";

const clean = (t: string) => (t ?? "").replace(/[\uE000-\uF8FF\u200B-\u200F\uFEFF]/g, "").trim();
const cnum = (k: string) => Number(k.split(":")[0]);

// Android caps an Intent's text extra (Binder transaction ~1 MB), so a bundle
// with long dictionaries (Lis\u0101n al-\u02BFArab entries reach ~86k chars) can't ride
// the normal text share. Small bundles share as text (AI apps' text target);
// large ones are written to a .txt file and shared by URI \u2014 no size limit \u2014
// with a clipboard fallback.
const TEXT_SHARE_LIMIT = 50_000;
export async function shareBundle(msg: string, title = "Share"): Promise<void> {
  if (!msg) return;
  if (msg.length <= TEXT_SHARE_LIMIT) { await Share.share({ message: msg }); return; }
  try {
    const dest = `${FileSystem.cacheDirectory}alsiraat-share.txt`;
    await FileSystem.writeAsStringAsync(dest, msg);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(dest, { mimeType: "text/plain", dialogTitle: title });
      return;
    }
  } catch { /* fall through to clipboard */ }
  await Clipboard.setStringAsync(msg);
  toast("Bundle is large \u2014 copied to clipboard; paste into your AI app.");
}

export interface ShareOpts {
  prompt?: string | null;      // framing line; "" = none, undefined = composer default
  dicts?: string[] | null;     // dictionary sources to include; null = all, [] = none
  translation?: boolean;       // include the reader's translations (āyah); default true
}

// The built-in English gloss (meaning_en) is only shown when the user hasn't
// restricted dictionaries (dicts == null = "all"). Once specific dictionaries
// are chosen, only those sources appear — nothing extra.
const showGloss = (dicts: string[] | null | undefined) => dicts == null;

interface Meaning { source: string; language: string; meaning: string }
function pickSenses(meanings: Meaning[] | undefined, dicts: string[] | null | undefined, cap: number): Meaning[] {
  const list = (meanings ?? []).filter((m) => (dicts == null ? true : dicts.includes(m.source)));
  return cap > 0 ? list.slice(0, cap) : list;
}

interface ShareRootLite {
  root_buckwalter: string; root_arabic: string; meaning_en: string | null; total_occurrences: number;
  forms: { lemma_buckwalter: string; lemma_arabic: string | null; occurrence_count: number }[];
  meanings: Meaning[];
}
function liteFromRoot(q: QuranApi, bw: string): ShareRootLite | undefined {
  const d = q.root(bw);
  if (!d) return undefined;
  return {
    root_buckwalter: d.root_buckwalter, root_arabic: d.root_arabic, meaning_en: d.meaning_en ?? null,
    total_occurrences: d.total_occurrences,
    forms: (d.forms ?? []).map((f) => ({ lemma_buckwalter: f.lemma_buckwalter, lemma_arabic: f.lemma_arabic ?? null, occurrence_count: f.occurrence_count })),
    meanings: (d.meanings ?? []) as Meaning[],
  };
}

function rootBlock(research: Db, d: ShareRootLite, dicts: string[] | null | undefined): string[] {
  const lines: string[] = [];
  lines.push(`• ${d.root_arabic}${showGloss(dicts) && d.meaning_en ? ` — ${d.meaning_en}` : ""}  (${d.total_occurrences}×)`);
  const forms = (d.forms ?? [])
    .map((f) => `${f.lemma_arabic ?? f.lemma_buckwalter}${f.occurrence_count ? ` (${f.occurrence_count})` : ""}`)
    .join("، ");
  if (forms) lines.push(`    forms: ${forms}`);
  const mine = userRootMeaning(research, d.root_buckwalter);
  if (mine) lines.push(`    my meaning: ${mine}`);
  for (const m of pickSenses(d.meanings, dicts, 2)) lines.push(`    (${m.source}) ${m.meaning.trim()}`);
  return lines;
}

/** Everything about one āyah, for pasting into an AI chat. */
export function composeAyahShare(
  q: QuranApi, research: Db, verseKey: string, editionIds: Set<number>, opts: ShareOpts = {},
): string {
  const surah = q.chapter(cnum(verseKey))?.name_simple ?? "";
  const verse = q.verse(verseKey, { script: "uthmani", withWords: true });
  const arabic = clean((verse?.text as string) ?? "");
  const words = ((verse?.words ?? []) as Word[]).filter((w) => w.pos != null);
  const trans = editionIds.size ? q.verseTranslations(verseKey).filter((t) => editionIds.has(t.resource_id)) : [];

  const seen = new Set<string>();
  const roots: string[] = [];
  for (const w of words) if (w.root_buckwalter && !seen.has(w.root_buckwalter)) { seen.add(w.root_buckwalter); roots.push(w.root_buckwalter); }

  const prompt = opts.prompt === undefined ? "Please help me study this Qur'anic āyah through its root vocabulary." : opts.prompt;
  const L: string[] = [];
  if (prompt) { L.push(prompt); L.push(""); }
  L.push(`Qur'an ${verseKey} — Sūrah ${surah}`);
  L.push("");
  L.push(arabic);
  if (opts.translation !== false && trans.length) {
    L.push("");
    L.push("Translation:");
    for (const t of trans) L.push(`  ${t.text}  — ${t.resource_name ?? t.language_name}`);
  }
  if (roots.length) {
    const bundle = typeof q.rootsForShare === "function" ? q.rootsForShare(roots) : null;
    L.push("");
    L.push("Roots & derived forms:");
    for (const bw of roots) {
      const d = bundle ? bundle.get(bw) : liteFromRoot(q, bw);
      if (d) L.push(...rootBlock(research, d, opts.dicts));
    }
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
export function composeRootShare(q: QuranApi, research: Db, rootBw: string, opts: ShareOpts = {}): string {
  const d = q.root(rootBw);
  if (!d) return "";
  const prompt = opts.prompt === undefined ? "Please help me study this Qur'anic root." : opts.prompt;
  const L: string[] = [];
  if (prompt) { L.push(prompt); L.push(""); }
  L.push(`Root ${d.root_arabic}${showGloss(opts.dicts) && d.meaning_en ? ` — ${d.meaning_en}` : ""}  (${d.total_occurrences}× · ${d.forms.length} forms)`);
  const forms = (d.forms ?? [])
    .map((f) => `${f.lemma_arabic ?? f.lemma_buckwalter}${f.occurrence_count ? ` (${f.occurrence_count})` : ""}`)
    .join("، ");
  if (forms) { L.push(""); L.push(`Derived forms: ${forms}`); }
  const senses = pickSenses(d.meanings as Meaning[], opts.dicts, 8);
  if (senses.length) {
    L.push("");
    L.push("Dictionary senses:");
    for (const m of senses) L.push(`  • (${m.source}) ${m.meaning.trim()}`);
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
