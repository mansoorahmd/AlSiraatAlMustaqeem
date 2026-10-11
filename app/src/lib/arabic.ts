// Client-side Arabic helpers: fold to bare letters, and locate a query phrase
// within a rendered verse so it can be highlighted (best-effort, alef-insensitive
// to match the backend's phrase search).

import { tokenizeVerse } from "../components/reader/format";
import type { HighlightRange } from "../persistence/types";

const AR_DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const FOLD: Record<string, string> = {
  "ٱ": "ا", "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه", "ـ": "",
};

export function foldAr(s: string): string {
  let out = "";
  for (const ch of (s ?? "").replace(AR_DIAC, "")) out += FOLD[ch] ?? ch;
  return out;
}

// alef-insensitive skeleton, matching the server's phrase-search folding
const skel = (s: string) => foldAr(s).replace(/ا/g, "");

/** word-position ranges where the query phrase occurs in the verse text */
export function phraseSpans(text: string, query: string, color = "#fde68a"): HighlightRange[] {
  const qWords = foldAr(query).trim().split(/\s+/).map(skel).filter(Boolean);
  if (!qWords.length) return [];
  const toks = tokenizeVerse(text)
    .filter((t) => t.position != null)
    .map((t) => ({ pos: t.position as number, sk: skel(t.text) }));
  const spans: HighlightRange[] = [];
  for (let i = 0; i + qWords.length <= toks.length; i++) {
    let ok = true;
    for (let j = 0; j < qWords.length; j++) if (toks[i + j]!.sk !== qWords[j]) { ok = false; break; }
    if (ok) spans.push({ start: toks[i]!.pos, end: toks[i + qWords.length - 1]!.pos, color });
  }
  return spans;
}
