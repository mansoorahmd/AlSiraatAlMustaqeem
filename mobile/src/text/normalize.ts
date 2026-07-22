// Script / encoding helpers — ported verbatim from the server
// (server/src/text/normalize.ts). Must match byte-for-byte so search/resolve
// behave identically on-device and on the server.

import { BUCKWALTER2UNICODE, UNICODE2BUCKWALTER } from "./constants";

// Arabic diacritics (harakat, tanwin, shadda, sukun, dagger alif, …).
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/gu;

// Arabic Unicode block, for "is this token Arabic?" tests (U+0600–U+06FF).
const isArabic = (ch: string) => ch >= "؀" && ch <= "ۿ";

export function buckToArabic(text: string): string {
  let out = "";
  for (const ch of text) out += BUCKWALTER2UNICODE[ch] ?? ch;
  return out;
}

export function arabicToBuck(text: string): string {
  let out = "";
  for (const ch of text) out += UNICODE2BUCKWALTER[ch] ?? ch;
  return out;
}

export function stripDiacritics(text: string): string {
  return text.replace(DIACRITICS, "");
}

export function normalizeRoot(value: string): string {
  value = value.trim();
  if (!value) return value;
  const compact = value.replace(/\s+/g, "");
  if ([...compact].some(isArabic)) return arabicToBuck(stripDiacritics(compact));
  return compact;
}

const FOLD: Record<string, string> = {
  "ٱ": "ا",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ى": "ي",
  "ة": "ه",
  "ـ": "",
};

export function foldArabic(text: string): string {
  if (!text) return text;
  const s = stripDiacritics(text);
  let out = "";
  for (const ch of s) out += FOLD[ch] ?? ch;
  return out;
}

// Clitics that attach to Arabic words (in folded form), longest first.
export const PROCLITICS_AR = ["وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ك", "ل", "س"];
export const ENCLITICS_AR = [
  "كما", "هما", "نا", "كم", "كن", "هم", "هن", "ها",
  "ني", "ون", "ين", "وا", "ات", "ك", "ه", "ي", "ت",
];

export function affixTrials(folded: string, minStem = 2): string[] {
  const out: string[] = [folded];
  const preStripped: string[] = [folded];
  for (const p of PROCLITICS_AR) {
    if (folded.startsWith(p) && folded.length - p.length >= minStem) {
      preStripped.push(folded.slice(p.length));
      break;
    }
  }
  for (const base of preStripped) {
    for (const s of ENCLITICS_AR) {
      if (base.endsWith(s) && base.length - s.length >= minStem) {
        out.push(base.slice(0, base.length - s.length));
        break;
      }
    }
  }
  for (const b of preStripped) if (b !== folded) out.push(b);
  const seen = new Set<string>();
  const trials: string[] = [];
  for (const t of out) {
    if (!seen.has(t)) {
      seen.add(t);
      trials.push(t);
    }
  }
  return trials;
}

export function tokenizeArabic(text: string): string[] {
  const stripped = stripDiacritics(text).trim();
  const toks = stripped.split(/\s+/);
  return toks.filter((t) => [...t].some(isArabic));
}
