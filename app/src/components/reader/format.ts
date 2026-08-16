// Small formatting helpers for the reader.

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

export function arabicIndic(n: number): string {
  return String(n)
    .split("")
    .map((d) => ARABIC_INDIC[Number(d)] ?? d)
    .join("");
}

/** Root letters spaced out for display: كتب → ك ت ب */
export function spacedRoot(root: string): string {
  return root.split(" ").join("").split("").join("\u00A0"); // nbsp: root letters must not wrap
}

/**
 * A display token of a verse. Quranic annotation marks (waqf signs like ۛ ۖ ۗ,
 * sajda ۩, rub el hizb ۞) appear as standalone space-separated tokens in the
 * text but are NOT words: they carry no `position` and must not shift the
 * word-position numbering used by the morphology tables.
 */
export interface VerseToken {
  text: string;
  /** 1-based word position, or null for annotation marks */
  position: number | null;
}

/** True if the token contains at least one Arabic letter (i.e. is a word). */
const HAS_LETTER =
  /[ء-يٱٹ-ۓەۮۯۺ-ۿݐ-ݿ]/u;

/** Split verse text into tokens, numbering only real words. */
export function tokenizeVerse(text: string): VerseToken[] {
  let pos = 0;
  return text
    .trim()
    .split(/\s+/u)
    .filter((t) => t.length > 0)
    .map((t) => ({
      text: t,
      position: HAS_LETTER.test(t) ? ++pos : null,
    }));
}

/** @deprecated kept for compatibility; prefer tokenizeVerse */
export function tokenize(text: string): string[] {
  return text.trim().split(/\s+/u);
}

/** The corpus root gloss is a raw, unranked word-list whose entries often run
 *  together ("...another.nafaqan (n.acc.) hole..."), which makes it unreadable
 *  and unwrappable. Put a space after punctuation that is glued to the next
 *  word — letters only, so "acc.)" and "3.5" are left alone. */
export function tidyGloss(s: string): string {
  return (s || "")
    .replace(/([.;,])(?=[A-Za-z\u0600-\u06FF])/g, "$1 ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
