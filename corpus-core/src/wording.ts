// Wording: any Arabic text set against the Book word by word, and two āyāt set against each other.
//
//   check   for each word typed or pasted: is it in the Book exactly as written (vowels and all),
//           with the same letters and other vowels, only once a leading و ف ب ل ك س and/or ال is
//           set aside, or not at all. Counts are words and āyāt.
//   diff    two āyāt aligned word against word (the longest common run of their words, vowels
//           ignored), each row labelled by how the two words differ.
//
// Nothing here interprets. It finds and counts; the reader decides what a difference means.

import type { CorpusDb } from "./corpus-db.js";
import { once } from "./corpus-db.js";
import { asSegments, rasmKey, skeleton } from "./spellings.js";

export interface WordingWord {
  text: string;
  status: "written" | "letters" | "stem" | "none";
  written: { count: number; ayahs: number };
  letters: { count: number; ayahs: number; forms: string[]; roots: string[] };
  stem: { prefix: string; text: string; count: number; ayahs: number; roots: string[] } | null;
  /** one āyah it is found in, to open */
  sample: string | null;
}
export interface WordingCheck {
  words: WordingWord[];
  summary: { total: number; written: number; letters: number; stem: number; none: number };
}

export interface DiffWord { word: number; text: string }
export type DiffHow = "same" | "marks" | "spelling" | "changed" | "only-a" | "only-b";
export interface DiffRow { a: DiffWord | null; b: DiffWord | null; how: DiffHow }
export interface AyahDiff { a: string; b: string; rows: DiffRow[]; counts: Record<DiffHow, number> }

/** The most words one check takes. */
export const MAX_CHECK_WORDS = 200;

export class WordingTooLong extends Error {}

interface BookWord {
  verseKey: string;
  pos: number;
  /** as written (the morphology's segments joined) */
  text: string;
  /** the written word, vowels and all, with display-only differences set aside */
  exact: string;
  /** its letters: vowels ignored, and the letters the script writes several ways made one */
  letters: string;
  /** its rasm (letters and the small letters the Uthmani script writes), vowels ignored */
  rasm: string;
  lemma: string | null;
  roots: string[];
  /** the part of speech of its (first) stem */
  tag: string | null;
}

// pause marks, the end-of-āyah sign, rub' al-hizb, sajda, Arabic punctuation and digits: never
// part of a word
const NOT_WORD = /[؀-؅،؛؟٠-٩٪-٭۔ۖ-ۜ۝۞۩۰-۹‌-‏]/gu;
const HAS_LETTER = /[ء-يٱ-ۓ]/u;

/** A word as written, vowels and all, with what only the display differs in set aside. */
export const exactKey = (s: string) => asSegments(s).replace(NOT_WORD, "").replace(/ـ/g, "").normalize("NFC");

// The letters of a word, as a reader would type them: vowels and marks ignored; a hamza on an
// alif and the waṣla read as alif, a hamza on the line dropped (ؤ and ئ stay: they are typed);
// the small alif written as alif; ة as ه; ى as ي; the small و and ي as the letters.
const LETTER: Record<string, string> = {
  "ٱ": "ا", "أ": "ا", "إ": "ا", "آ": "ا", "ء": "",
  "ٰ": "ا", "ى": "ي", "ة": "ه", "ۥ": "و", "ۦ": "ي",
};
export function lettersKey(s: string, smallAlif = "ا"): string {
  const src = exactKey(s);
  let out = "";
  for (const ch of src) {
    if (ch === "ٰ") out += smallAlif;
    else if (ch in LETTER) out += LETTER[ch];
    else if (/[ء-ي]/u.test(ch)) out += ch;
  }
  return out.replace(/ا{2,}/g, "ا");
}

/** A Book word is found by its letters with its small alif typed as ا (كتاب for كِتَٰب) or left
 *  out (الرحمن for ٱلرَّحْمَٰنِ): readers type it both ways. */
const bookLetterKeys = (s: string) => [...new Set([lettersKey(s), lettersKey(s, "")])];

/** The Book writes a long ā with و inside some words where readers write ا (ٱلصَّلَوٰة, ٱلزَّكَوٰة,
 *  ٱلْحَيَوٰة). Looked up only when the letters themselves find nothing. */
const longAKey = (s: string) => lettersKey(s).replace(/وا(?=.)/g, "ا");

// What may be set aside at the front of a word, in reading order: a joining و / ف, then one of
// ب ل ك س, then the article. لل is لِ + ٱل with the article's alif not written.
const PREFIX_STEPS: { letters: string; name: string }[][] = [
  [{ letters: "و", name: "و" }, { letters: "ف", name: "ف" }],
  [{ letters: "ب", name: "ب" }, { letters: "ل", name: "ل" }, { letters: "ك", name: "ك" }, { letters: "س", name: "س" }],
  [{ letters: "ال", name: "ال" }],
];

/** Every way of setting aside a leading prefix run, fewest letters first. */
function stems(letters: string): { prefix: string; rest: string }[] {
  const out: { prefix: string; rest: string; cut: number }[] = [];
  const walk = (step: number, at: number, names: string[]) => {
    if (step === PREFIX_STEPS.length) {
      if (at > 0 && letters.length - at >= 2) out.push({ prefix: names.join(" + "), rest: letters.slice(at), cut: at });
      return;
    }
    walk(step + 1, at, names);
    for (const p of PREFIX_STEPS[step]!) {
      if (letters.startsWith(p.letters, at)) walk(step + 1, at + p.letters.length, [...names, p.name]);
    }
    // لِ + ٱل written لل
    if (step === 1 && letters.startsWith("لل", at)) walk(PREFIX_STEPS.length, at + 2, [...names, "ل", "ال"]);
  };
  walk(0, 0, []);
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.cut - b.cut)
    .filter((s) => (seen.has(s.rest) ? false : (seen.add(s.rest), true)))
    .map(({ prefix, rest }) => ({ prefix, rest }));
}

const HOWS: DiffHow[] = ["same", "marks", "spelling", "changed", "only-a", "only-b"];

export class WordingIndex {
  private words: BookWord[] = [];
  private byVerse = new Map<string, BookWord[]>();
  private byExact = new Map<string, BookWord[]>();
  private byLetters = new Map<string, BookWord[]>();
  private byLongA = new Map<string, BookWord[]>();
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.build = once(() => this.load());
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{
      verse_key: string; word_position: number; segment_type: string | null; form_arabic: string | null;
      lemma_arabic: string | null; root_arabic: string | null; tag: string | null;
    }>(
      `SELECT ws.verse_key, ws.word_position, ws.segment_type, ws.form_arabic, ws.lemma_arabic, ws.root_arabic, ws.tag
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );
    let cur: BookWord | null = null;
    const flush = () => {
      if (!cur) return;
      cur.exact = exactKey(cur.text);
      cur.letters = lettersKey(cur.text);
      cur.rasm = rasmKey(asSegments(cur.text));
      this.words.push(cur);
      let v = this.byVerse.get(cur.verseKey);
      if (!v) { v = []; this.byVerse.set(cur.verseKey, v); }
      v.push(cur);
      const put = (m: Map<string, BookWord[]>, k: string) => {
        if (!k) return;
        const l = m.get(k);
        if (l) l.push(cur!); else m.set(k, [cur!]);
      };
      put(this.byExact, cur.exact);
      for (const k of bookLetterKeys(cur.text)) put(this.byLetters, k);
      const la = longAKey(cur.text);
      if (la !== cur.letters) put(this.byLongA, la);
    };
    for (const r of rows) {
      if (!cur || r.verse_key !== cur.verseKey || r.word_position !== cur.pos) {
        flush();
        cur = { verseKey: r.verse_key, pos: r.word_position, text: "", exact: "", letters: "", rasm: "", lemma: null, roots: [], tag: null };
      }
      cur.text += r.form_arabic ?? "";
      if (r.segment_type === "STEM") {
        if (!cur.tag && r.tag) cur.tag = r.tag;
        if (!cur.lemma && r.lemma_arabic) cur.lemma = r.lemma_arabic;
        if (r.root_arabic && !cur.roots.includes(r.root_arabic)) cur.roots.push(r.root_arabic);
      }
    }
    flush();
  }

  /** Split Arabic text into words: whitespace apart, pause marks, punctuation and digits dropped. */
  static split(text: string): string[] {
    return text.split(/\s+/).map((t) => t.replace(NOT_WORD, "").replace(/[^ؐ-ؚء-ٰٟ-ۓۥ-۪ۨ-ۭـ]/gu, ""))
      .filter((t) => HAS_LETTER.test(t));
  }

  /** Set any Arabic text against the Book, word by word. Throws WordingTooLong past 200 words. */
  async check(text: string): Promise<WordingCheck> {
    const tokens = WordingIndex.split(text);
    if (tokens.length > MAX_CHECK_WORDS) throw new WordingTooLong(`at most ${MAX_CHECK_WORDS} words at a time (this text has ${tokens.length})`);
    await this.build();
    const words = tokens.map((t) => this.checkWord(t));
    const summary = { total: words.length, written: 0, letters: 0, stem: 0, none: 0 };
    for (const w of words) summary[w.status]++;
    return { words, summary };
  }

  private checkWord(text: string): WordingWord {
    const ayahs = (l: BookWord[]) => new Set(l.map((w) => w.verseKey)).size;
    const rootsOf = (l: BookWord[]) => {
      const out: string[] = [];
      for (const w of l) for (const r of w.roots) if (!out.includes(r)) out.push(r);
      return out.slice(0, 5);
    };
    const exact = this.byExact.get(exactKey(text)) ?? [];
    let letters = this.byLetters.get(lettersKey(text)) ?? [];
    if (!letters.length) letters = this.byLongA.get(lettersKey(text)) ?? [];
    // the other ways the Book writes these letters, commonest first
    const forms = new Map<string, BookWord[]>();
    for (const w of letters) {
      if (w.exact === exactKey(text)) continue;
      const l = forms.get(w.exact);
      if (l) l.push(w); else forms.set(w.exact, [w]);
    }
    const top = [...forms.values()].sort((a, b) => b.length - a.length).slice(0, 5);
    const out: WordingWord = {
      text,
      status: exact.length ? "written" : letters.length ? "letters" : "none",
      written: { count: exact.length, ayahs: ayahs(exact) },
      letters: { count: letters.length, ayahs: ayahs(letters), forms: top.map((l) => l[0]!.text), roots: rootsOf(top.flat()) },
      stem: null,
      sample: exact[0]?.verseKey ?? letters[0]?.verseKey ?? null,
    };
    if (out.status !== "none") return out;
    for (const { prefix, rest } of stems(lettersKey(text))) {
      const found = this.byLetters.get(rest) ?? this.byLongA.get(rest);
      if (!found?.length) continue;
      out.status = "stem";
      out.stem = { prefix, text: found[0]!.text, count: found.length, ayahs: ayahs(found), roots: rootsOf(found) };
      out.sample = found[0]!.verseKey;
      break;
    }
    return out;
  }

  /** Two āyāt word against word; null when either is not a verse key. */
  async diff(a: string, b: string): Promise<AyahDiff | null> {
    await this.build();
    const A = this.byVerse.get(a);
    const B = this.byVerse.get(b);
    if (!A || !B) return null;
    const rows: DiffRow[] = [];
    const view = (w: BookWord): DiffWord => ({ word: w.pos, text: w.text });
    const sameWord = (x: BookWord, y: BookWord): DiffHow =>
      x.exact === y.exact ? "same" : x.rasm === y.rasm ? "marks" : "spelling";

    // The unmatched stretch between two anchors, aligned at the least cost: two words of one
    // lemma pair freely (the same word, written alike or not), of one root or one part of speech
    // at a little cost; anything else stands alone on its side rather than be paired.
    const gap = (xs: BookWord[], ys: BookWord[]) => {
      const INDEL = 1.25;
      const cost = (x: BookWord, y: BookWord) =>
        x.lemma && x.lemma === y.lemma ? 0
        : x.roots.some((r) => y.roots.includes(r)) ? 1
        : x.tag && x.tag === y.tag ? 1.5
        : Infinity;
      const n = xs.length;
      const m = ys.length;
      const D: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
      for (let i = n; i >= 0; i--) {
        for (let j = m; j >= 0; j--) {
          if (i === n && j === m) continue;
          let best = Infinity;
          if (i < n) best = Math.min(best, D[i + 1]![j]! + INDEL);
          if (j < m) best = Math.min(best, D[i]![j + 1]! + INDEL);
          if (i < n && j < m) best = Math.min(best, D[i + 1]![j + 1]! + cost(xs[i]!, ys[j]!));
          D[i]![j] = best;
        }
      }
      let i = 0;
      let j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && D[i]![j] === D[i + 1]![j + 1]! + cost(xs[i]!, ys[j]!)) {
          const x = xs[i++]!;
          const y = ys[j++]!;
          const same = x.lemma !== null && x.lemma === y.lemma && skeleton(x.rasm) === skeleton(y.rasm);
          rows.push({ a: view(x), b: view(y), how: same ? (x.rasm === y.rasm ? "marks" : "spelling") : "changed" });
        } else if (i < n && D[i]![j] === D[i + 1]![j]! + INDEL) {
          rows.push({ a: view(xs[i++]!), b: null, how: "only-a" });
        } else {
          rows.push({ a: null, b: view(ys[j++]!), how: "only-b" });
        }
      }
    };

    const anchors = lcs(A, B, (x, y) => x.letters === y.letters);
    let i = 0;
    let j = 0;
    for (const [pi, pj] of anchors) {
      gap(A.slice(i, pi), B.slice(j, pj));
      rows.push({ a: view(A[pi]!), b: view(B[pj]!), how: sameWord(A[pi]!, B[pj]!) });
      i = pi + 1;
      j = pj + 1;
    }
    gap(A.slice(i), B.slice(j));
    const counts = Object.fromEntries(HOWS.map((h) => [h, 0])) as Record<DiffHow, number>;
    for (const r of rows) counts[r.how]++;
    return { a, b, rows, counts };
  }
}

/** The index pairs of a longest common subsequence, in order. */
function lcs<T>(xs: T[], ys: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = xs.length;
  const m = ys.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i]![j] = eq(xs[i]!, ys[j]!) ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(xs[i]!, ys[j]!) && L[i]![j] === L[i + 1]![j + 1]! + 1) { out.push([i, j]); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}
