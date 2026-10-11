// On-screen Arabic keyboard rows + helpers (mirrors app/src/lib/arabic.ts).

export const AR_ROWS: string[][] = [
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ئ", "ء", "ؤ", "ر", "ى", "ة", "و", "ز", "ظ", "د"],
  ["ذ", "أ", "إ", "آ", "غ", "چ"],
];

export const HAMZA_FORMS = ["ء", "أ", "إ", "آ", "ؤ", "ئ", "ٱ"];

export function isArabicText(s: string): boolean {
  return [...s].some((ch) => ch >= "؀" && ch <= "ۿ");
}
