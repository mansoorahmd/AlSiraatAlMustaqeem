// Rasm (orthography) variants: the same word + inflection written differently
// across the mushaf — e.g. إبراهيم full-yāʾ vs superscript small-yāʾ, رَأَىٰ vs
// رَءَا. Ported from the mobile app's data/spellings.ts (word-level part).

import type { CorpusDb } from "./corpus-db.js";
import { once } from "./corpus-db.js";
import { foldArabic } from "./text/normalize.js";

export interface SpellingVariant {
  surface: string;
  count: number;
  verses: string[];
  /** this is the spelling the asked-about occurrence is written in */
  here?: boolean;
}

// RASM key: keep only base rasm letters + dagger-alif + wasla + small wāw/yāʾ.
// U+0640 TATWEEL is excluded even though it falls inside the letter range: it is a
// cosmetic elongation dash, not a letter. The DISPLAYED verse text writes
// ٱلرَّحْمَـٰنِ WITH a tatweel while the morphology segments that build this index write
// it without, so keeping it made a word tapped in the reader unmatchable — "follow this
// word" then found nothing and showed only the tapped occurrence.
export const rasmKey = (s: string) =>
  (s || '').replace(/\u0640/g, '').replace(/[^\u0621-\u064A\u0670\u0671\u06E5\u06E6]/g, '');

/** Text copied from the displayed āyah writes two things differently from the morphology the
 *  indexes are built on: a hamza carried on a tatweel (ٱلْـَٔاخِرَةِ, morphology ٱلْءَاخِرَةِ) and the
 *  small high yāʾ U+06E7 (إِبْرَٰهِـۧمَ, morphology U+06E6). Write them the morphology's way. */
export const asSegments = (s: string) =>
  (s || "").replace(/ـ([ً-ْ]*)ٔ/g, "ء$1").replace(/ۧ/g, "ۦ");

// SKELETON: collapse the letters that carry the same word's long-ā across the two
// mushaf spellings, so the same word written two ways still lands in one group:
//   • hamza seats → ء
//   • every long-ā carrier → ا: alif, alif-maqṣūra ى, dagger-alif ٰ, waṣla ٱ, madda آ,
//     AND the mater-lectionis wāw و / superscript wāw ۥ (the archaic ā, as in
//     ٱلصَّلَوٰة, ٱلزَّكَوٰة, ٱلْحَيَوٰة — written with wāw where imlāʾī uses alif)
//   • tāʾ-marbūṭa ة → open tāʾ ت (رَحْمَت vs رَحْمَة, نِعْمَت vs نِعْمَة …)
// then squash runs. This only ever merges within one lemma + full morphological
// analysis (both are in the group key), so it unifies one word-form's spellings and
// never conflates different words. The distinct rasm spellings are still tracked
// separately inside the group, so each variant is counted and shown.
const SKEL: Record<string, string> = {
  "ء": "ء", "أ": "ء", "إ": "ء", "ؤ": "ء", "ئ": "ء", "ٱ": "ا",
  "آ": "ا", "ا": "ا", "ى": "ا", "ٰ": "ا", "و": "ا", "ۥ": "ا",
  "ة": "ت", "ۦ": "ي",
};
export const skeleton = (rk: string) => {
  let out = "";
  let prev = "";
  for (const ch of rk) {
    const m = SKEL[ch] ?? ch;
    if (m !== prev) out += m;
    prev = m;
  }
  return out;
};

// ---- exact-word index: every place a word is written the same way -------------
// "Follow this exact word" walks the written surface (rasm), not the root, so it
// works for particles and proper names that have no root at all. Vowel marks are
// ignored, so the same word in a different case still matches. Built once and
// cached: unlike the variant index this spans ALL segments, since prefixes like
// وَ and ٱل are part of the written word.

export interface WordOccurrence { verse_key: string; word_position: number; surface?: string }

/** A written form that CONTAINS the traced rasm — the same word carrying prefixes or
 *  suffixes (ٱلصَّلَوٰة for صلوٰة). Reported so an exact trace can't be mistaken for the
 *  word's total frequency. */
export interface RelatedForm { surface: string; count: number }

export class WordFormIndex {
  private byRasm = new Map<string, WordOccurrence[]>();
  /** Secondary index on the FOLDED rasm (waṣla/madda/hamza-alif/dagger-alif → ا,
   *  alif-maqṣūra → ي, tāʾ-marbūṭa → ه). The index is built from the Uthmani
   *  morphology, but the reader can display imlāʾī / indopak / simplified text, where
   *  the same word is written الرحمن rather than ٱلرَّحْمَٰنِ. Without this fallback,
   *  tapping a word in any non-Uthmani script matched nothing. */
  private byFolded = new Map<string, WordOccurrence[]>();
  /** first surface seen for each rasm, to name it in results */
  private sample = new Map<string, string>();
  /** every word whose whole rasm OR whose stem's rasm is the key — one exact written shape */
  private byShape = new Map<string, WordOccurrence[]>();
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.build = once(() => this.load());
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{ verse_key: string; word_position: number; segment_type: string | null; form_arabic: string | null }>(
      `SELECT ws.verse_key, ws.word_position, ws.segment_type, ws.form_arabic
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );
    // assemble each word's full written surface (and its stem alone) in mushaf order
    const per = new Map<string, string>();
    const stems = new Map<string, string>();
    const order: string[] = [];
    for (const r of rows) {
      const k = `${r.verse_key}#${r.word_position}`;
      if (!per.has(k)) order.push(k);
      per.set(k, (per.get(k) ?? "") + (r.form_arabic ?? ""));
      if (r.segment_type === "STEM") stems.set(k, (stems.get(k) ?? "") + (r.form_arabic ?? ""));
    }
    for (const k of order) {
      const full = per.get(k)!;
      const rk = rasmKey(full);
      if (!rk) continue;
      const hash = k.indexOf("#");
      const occ = {
        verse_key: k.slice(0, hash),
        word_position: Number(k.slice(hash + 1)),
        surface: full,
      };
      // a written shape names the word as written, or its stem with what is attached set aside
      const sk = rasmKey(stems.get(k) ?? "");
      for (const shape of sk && sk !== rk ? [rk, sk] : [rk]) {
        const s = this.byShape.get(shape);
        if (s) s.push(occ);
        else this.byShape.set(shape, [occ]);
      }
      const list = this.byRasm.get(rk);
      if (list) list.push(occ);
      else this.byRasm.set(rk, [occ]);
      if (!this.sample.has(rk)) this.sample.set(rk, full);
      const fk = foldArabic(rk);
      const flist = this.byFolded.get(fk);
      if (flist) flist.push(occ);
      else this.byFolded.set(fk, [occ]);
    }
  }

  /** Resolve a query to the occurrence list: exact rasm first, then the folded index
   *  so a word tapped in a non-Uthmani script still matches. `mode` says which hit. */
  async lookup(surface: string): Promise<{ key: string; mode: "rasm" | "folded"; list: WordOccurrence[] }> {
    await this.build();
    const rk = rasmKey(surface);
    if (!rk) return { key: "", mode: "rasm", list: [] };
    const exact = this.byRasm.get(rk);
    if (exact?.length) return { key: rk, mode: "rasm", list: exact };
    return { key: foldArabic(rk), mode: "folded", list: this.byFolded.get(foldArabic(rk)) ?? [] };
  }

  /** Every word written in exactly this shape (rasm, vowels ignored): the whole word, or its
   *  stem with prefixes and suffixes set aside. No folding: إِبْرَٰهِيمَ and إِبْرَٰهِۦمَ are two
   *  shapes. Book order. */
  async shapePlaces(shape: string): Promise<WordOccurrence[]> {
    await this.build();
    const rk = rasmKey(asSegments(shape));
    return rk ? this.byShape.get(rk) ?? [] : [];
  }

  /** Every occurrence of the exact written word, in mushaf order. */
  async occurrences(surface: string, limit = 3000): Promise<WordOccurrence[]> {
    return (await this.lookup(surface)).list.slice(0, limit);
  }

  /** How many times this written form occurs — the total, before any limit. */
  async total(surface: string): Promise<number> {
    return (await this.lookup(surface)).list.length;
  }

  /** Other written forms that contain this one, i.e. the same word with ٱل / و / بِ
   *  attached, or with a pronoun suffix. Without this, tracing صلوٰة reports 2 — the
   *  bare form — while 65 occurrences sit inside ٱلصَّلَوٰةَ and look like they do not
   *  exist. Sorted by frequency. */
  async relatedForms(surface: string, limit = 12): Promise<RelatedForm[]> {
    const { key, mode } = await this.lookup(surface);
    if (!key) return [];
    const index = mode === "rasm" ? this.byRasm : this.byFolded;
    const out: RelatedForm[] = [];
    for (const [k, list] of index) {
      if (k === key || !k.includes(key)) continue;
      out.push({ surface: this.sample.get(k) ?? list[0]?.surface ?? k, count: list.length });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, limit);
  }
}

// ---- chapter-level index: which words carry a rasm variant --------------------
// A word occurrence is a "variant" when its (lemma | raw_features | skeleton)
// group is written ≥2 distinct ways across the mushaf. Built once and cached so
// the reader can mark āyāt cheaply.
//
// Case (NOM/ACC/GEN) is left out of the group: it is a vowel mark, never a rasm
// letter, so it can't make a spelling variant — keeping it split one word's
// spellings by case, and the counts read as totals when they weren't (قَهَّار: ×1
// dagger-alif + ×3 full, when the full alif is ×5 once its two genitives count).
const CASES = new Set(["NOM", "ACC", "GEN"]);
const caseless = (raw: string) => raw.split("|").filter((t) => !CASES.has(t)).join("|");

// The inflection a word is grouped under: its features without the case. For a feminine noun
// whose stem ends in ة or ت, being indefinite is left out too: that letter is written ت in some
// places where nothing is attached (ٱمْرَأَتُ ٱلْعَزِيزِ, 12:30) and ة in others (ٱمْرَأَةً, 27:23), and tanwīn
// does not decide which, so both belong to one group. Everywhere else indefiniteness stays part
// of the inflection, because there it does change the writing (the ا of كِتَٰبًا).
const inflection = (raw: string, rasm: string) => {
  const tags = raw.split("|").filter((t) => !CASES.has(t));
  const feminineEnding = /[ةت]$/.test(rasm) && tags.includes("POS:N") && tags.includes("F");
  return (feminineEnding ? tags.filter((t) => t !== "INDEF") : tags).join("|");
};

// What two inflections of one word must share to be listed as ONE word: its features without
// the case and definiteness, and for a verb without its person, gender, number and mood (and
// the corpus's "sister of كَادَ" note, which it puts on some places of a verb and not others).
// Inflections that agree in these and write the stem with the very same letters somewhere are
// one word to a reader (كِتَٰب with and without ٱل; رَأَيْتَ and رَأَيْتُمْ), so their spellings are counted
// together. Tense, voice, verb form and derivation stay: a perfect تَوَلَّوْا is not a place where
// the imperfect dropped a ت. So does a noun's number: the plural صَلَوَٰت is written with the
// letters of صَلَوٰتَكَ, and is not a spelling of the singular.
const PGN = /^([123]|[123]?[MF]?[SDP]|[MF])$/;
const core = (raw: string) => {
  const tags = raw.split("|");
  const verb = tags.includes("POS:V");
  return tags
    .filter((t) => !CASES.has(t) && t !== "INDEF" && !(verb && (PGN.test(t) || t.startsWith("MOOD:") || t.startsWith("SP:"))))
    .join("|");
};

// A hamza's seat is decided by what is ATTACHED to the stem, not by how the word is spelled:
// it follows its new neighbour (لِقَآء, لِقَآئِهِ; إِذَا, أَءِذَا). That is a rule of the script,
// so it is not a spelling variant. A stem with a suffix has its last hamza, and a stem with a
// prefix its first, read as the word's bare spelling: the commonest seat its group shows where
// nothing is attached on that side. A seat that differs with nothing attached (بِلِقَآئِ رَبِّهِمْ,
// 30:8) is a genuine variant and stays. Tāʾ-marbūṭa and the long tāʾ (ة, ت) are deliberately
// left alone: both are kept as variants.
// The same holds for the waṣla after the question ءَ: ٱللَّهِ is written آللَّهُ (10:59, 27:59) once
// the question is attached, so a stem's opening ا / آ after it is read as the bare word's ٱ.
const CONTEXTUAL = [new Set(["ء", "أ", "إ", "ؤ", "ئ"])];
const WASLA = new Set(["ٱ"]);

// A verb that ends in weak letters (و ى ي ا, written or small) is grouped with the short vowel on
// the last letter before them: يَبْلُوَ (ُ) and يَبْلَىٰ (َ, 20:120) carry the same lemma, root and
// features in the corpus, but the vowel says they are two verbs, not one written two ways (so
// too يَسْقِى, 12:41, and يُسْقَىٰ, 13:4). يَدْعُو and يَدْعُوٓا۟ keep one vowel and stay one group.
const LETTER = /[ء-غف-ي]/;
const WEAK = "وىياٰۥۦ";
function vowelBeforeWeakEnd(surface: string): string {
  const ch = [...surface];
  let i = ch.length - 1;
  let weak = false;
  while (i >= 0 && (WEAK.includes(ch[i]!) || !LETTER.test(ch[i]!))) { if (WEAK.includes(ch[i]!)) weak = true; i--; }
  if (!weak || i < 0) return "";
  for (let j = i + 1; j < ch.length && !WEAK.includes(ch[j]!); j++) if ("َُِ".includes(ch[j]!)) return ch[j]!;
  return "";
}

// A grammatical ending: two spellings that part only in their last letters, where those letters
// are the case ending the morphology gives each spelling's words (the case most of them carry):
// و (or وا) nominative and ى / ي genitive or accusative (ذُو / ذِى, بَنُوٓا۟ / بَنِىٓ, أُو۟لُوا۟ / أُو۟لِى,
// تَارِكُوٓا۟ / تَارِكِىٓ), ا accusative among those (أَبَا), ا nominative and ى / ي otherwise in a dual and
// only there (ٱثْنَا / ٱثْنَىْ; the ا of هُدَاىَ beside هُدًى is not an ending), and the ا an accusative
// with tanwīn adds (عَدُوًّا / عَدُوٌّ), which every indefinite accusative of the word must carry and
// nothing else. The two must carry different cases, and the letters must be whole letters: a
// small ى, و or alif (وَلِيُّ / وَلِۦِّ) is a spelling.
const caseOf = (raw: string) => raw.split("|").find((t) => CASES.has(t));
const fitsCase = (tail: string, c: string, dual: boolean) =>
  c === "NOM" ? (dual ? tail === "ا" : /^وا?$/.test(tail)) : /^[يى]$/.test(tail) || (c === "ACC" && !dual && tail === "ا");
function endingOnly(a: string, b: string, caseA: string | undefined, caseB: string | undefined, dual: boolean): boolean {
  if (!caseA || !caseB || caseA === caseB) return false;
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const ta = a.slice(k);
  const tb = b.slice(k);
  // nothing is added for a case but the accusative's ا
  if (!ta) return caseB === "ACC" && tb === "ا";
  if (!tb) return caseA === "ACC" && ta === "ا";
  return fitsCase(ta, caseA, dual) && fitsCase(tb, caseB, dual);
}
/** The case most of these words carry (ties: the first counted). */
function mainCase(n: Map<string, number>): string | undefined {
  let best: string | undefined;
  for (const [c, k] of n) if (best === undefined || k > n.get(best)!) best = c;
  return best;
}
const classOf = (ch: string | undefined) => (ch ? CONTEXTUAL.find((c) => c.has(ch)) : undefined);

interface StemWord {
  /** `surface` is the stem alone; `full` the whole word as written; `seq` its place in the Book */
  vk: string; pos: number; seq: number; surface: string; full: string; raw: string; lemma: string; lemmas: Set<string>;
  prefixed: boolean; suffixed: boolean;
  /** the question ءَ is attached in front */
  question: boolean;
  /** the lemma and root in Arabic, for naming the group */
  lemmaAr: string; rootAr: string | null;
}
type Spelled = { w: StemWord; rk: string };

/** The commonest first (or last) letter, within `cls`, among the group's words with nothing
 *  attached on that side. */
function bareLetter(words: Spelled[], side: "first" | "last", cls: Set<string>): string | undefined {
  const n = new Map<string, number>();
  for (const { w, rk } of words) {
    if (side === "first" ? w.prefixed : w.suffixed) continue;
    const ch = side === "first" ? rk[0] : rk[rk.length - 1];
    if (ch && cls.has(ch)) n.set(ch, (n.get(ch) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** A word's rasm with the attachment-decided letters read as its bare spelling. */
function bareRasm({ w, rk }: Spelled, words: Spelled[]): string {
  let out = rk;
  const last = classOf(out[out.length - 1]);
  if (w.suffixed && last) {
    const ch = bareLetter(words, "last", last);
    if (ch) out = out.slice(0, -1) + ch;
  }
  const first = classOf(out[0]);
  if (w.prefixed && first) {
    const ch = bareLetter(words, "first", first);
    if (ch) out = ch + out.slice(1);
  }
  if (w.question && (out[0] === "ا" || out[0] === "آ") && bareLetter(words, "first", WASLA)) out = "ٱ" + out.slice(1);
  return out;
}

/** An āyah's variant words: written the unusual way here (`positions`), and having other
 *  spellings elsewhere while written the usual way here (`common`). */
export interface VerseVariants { verse_key: string; positions: number[]; common: number[] }

// ---- the Book-wide list: every word written more than one way ----------------------------
//
// Each group is one word in one inflection (the same grouping the ✍ marks use) whose spellings
// differ. The kinds name WHERE two spellings differ, letter by letter, and nothing more: which
// letters are written in one and not the other. They never say why.

export interface SpellingKind { id: string; label: string; count: number }
export interface SpellingPlace { verseKey: string; word: number }
export interface SpellingShape {
  surface: string; count: number; ayahs: number; places: SpellingPlace[];
  /** how many of `count` carry a pronoun and so are written ت where the bare word ends in ة:
   *  the script's rule. They are counted here because the word is never written ت with nothing
   *  attached, so they differ from this spelling in nothing else. Absent when none. */
  attached?: number;
}
export interface SpellingGroup {
  /** the group's first word in the Book, "chapter:verse:word" — stable while the corpus is */
  key: string;
  lemma: string;
  root: string | null;
  /** words in the group: every spelling, and `withPronoun` */
  total: number;
  /** which kinds of difference separate its spellings (ids from SpellingList.kinds) */
  kinds: string[];
  /** the commonest spelling first */
  spellings: SpellingShape[];
  /** Where the Book writes the bare word both ة and ت, its words that carry a pronoun: the
   *  script writes ت there either way, so they are counted with neither spelling. Absent when
   *  none. */
  withPronoun?: { count: number; ayahs: number; places: SpellingPlace[] };
}
export interface SpellingList {
  total: number;
  /** groups whose spellings differ only by a grammatical ending, left out of a list asked for
   *  without a kind (ask kind=ending for them) */
  hidden: number;
  kinds: SpellingKind[];
  items: SpellingGroup[];
}
export interface SpellingListQuery {
  kind?: string; q?: string; limit?: number; offset?: number;
  /** "count" (the default): most places first; "alpha": by the word, in the order of the Arabic alphabet */
  sort?: "count" | "alpha";
}

/** The kinds of difference, in the order a filter lists them. */
export const SPELLING_KINDS: readonly { id: string; label: string }[] = [
  { id: "ta", label: "ت or ة at the end" },
  { id: "alif", label: "alif written or as a small mark" },
  { id: "ya", label: "ى / ي / small ي" },
  { id: "waw", label: "و written or small" },
  { id: "alif-ya", label: "ا or ى" },
  { id: "waw-alif", label: "و or ا" },
  { id: "hamza", label: "hamza seat" },
  { id: "double-ta", label: "one ت or two" },
  { id: "doubling", label: "a letter doubled or written twice" },
  { id: "ending", label: "grammar ending, not a spelling" },
  { id: "other", label: "other" },
];

/** The kind a group carries when its spellings differ only by a grammatical ending. The default
 *  list leaves out groups with no other kind. */
export const ENDING = "ending";

const HAMZA = new Set(["ء", "أ", "إ", "ؤ", "ئ"]);
const within = (chars: string[], set: string) => chars.every((c) => set.includes(c));

/** Which kinds of difference separate two spellings (rasm keys). Each stretch where they part
 *  is named by the letters written in one and not the other. (The "ending" kind is not a letter
 *  difference: SpellingIndex decides it from the morphology.) */
export function spellingDiffKinds(a: string, b: string): string[] {
  // آ against ا is the madda, a mark: named only when nothing else differs (يُشَاقِقِ, يُشَآقِّ)
  const na = a.replace(/آ/g, "ا");
  const nb = b.replace(/آ/g, "ا");
  const kinds = na === nb ? diffKindSet(a, b) : diffKindSet(na, nb);
  return SPELLING_KINDS.map((k) => k.id).filter((id) => kinds.has(id));
}

function diffKindSet(a: string, b: string): Set<string> {
  const x = [...a];
  const y = [...b];
  // LCS table over letters, then walk it, collecting each stretch where the two part
  const n = x.length;
  const m = y.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i]![j] = x[i] === y[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  }
  // each stretch where they part, with the letters on either side of it (what both write)
  const chunks: { chars: string[]; atEnd: boolean; before: string; after: string }[] = [];
  let cur: string[] = [];
  let before = "";
  const close = (atEnd: boolean, after: string) => { if (cur.length) chunks.push({ chars: cur, atEnd, before, after }); cur = []; };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { close(false, x[i]!); before = x[i]!; i++; j++; }
    else if (j >= m || (i < n && L[i + 1]![j]! >= L[i]![j + 1]!)) cur.push(x[i++]!);
    else cur.push(y[j++]!);
  }
  close(true, "");
  const kinds = new Set<string>();
  const name = (chars: string[], atEnd: boolean, nb: string, na: string): string => {
    if (chars.some((c) => HAMZA.has(c))) return "hamza";
    if (within(chars, "ةت") && atEnd) return "ta";
    if (within(chars, "اٰآ")) return "alif";
    if (within(chars, "ىيۦ")) return "ya";
    if (within(chars, "وۥ")) return "waw";
    if (within(chars, "اىٰ")) return "alif-ya";
    if (within(chars, "واٰۥ")) return "waw-alif";
    if (within(chars, "ت")) return "double-ta";
    // one letter written once in one and twice in the other (يَرْتَدَّ, يَرْتَدِدْ)
    if (chars.every((c) => c === chars[0]) && (nb === chars[0] || na === chars[0])) return "doubling";
    return "other";
  };
  for (const { chars, atEnd, before: nb, after: na } of chunks) {
    // a stretch at the end that holds the ت / ة and another difference is named for both
    // (صَلَوٰة, صَلَات: و or ا, then ة or ت)
    if (atEnd && chars.some((c) => c === "ة") && chars.some((c) => c === "ت")) {
      kinds.add("ta");
      const rest = chars.filter((c) => c !== "ة" && c !== "ت");
      if (rest.length) kinds.add(name(rest, false, nb, ""));
      continue;
    }
    kinds.add(name(chars, atEnd, nb, na));
  }
  return kinds;
}

// A loose key for finding a group by what a reader types: the letters only, with the long
// vowels and hamza seats that spellings differ in set aside (ابراهيم finds إِبْرَٰهِـۧمَ).
const looseKey = (s: string) => skeleton(rasmKey(s)).replace(/[اويءۥۦ]/g, "").replace(/ة/g, "ت");

interface GroupRec {
  key: string; lemma: string; root: string | null; kinds: string[];
  /** folded lemma and spellings, and their loose keys, for the search box */
  folded: string[]; loose: Set<string>;
  /** `words` are the words of `places`, in the same order, each as written in full */
  shapes: { surface: string; places: SpellingPlace[]; words: string[]; ayahs: number; attached: number }[];
  /** the words that carry a pronoun where the bare word is written both ة and ت */
  aside: SpellingPlace[];
  total: number;
}

export class SpellingIndex {
  private unusual = new Map<string, Set<number>>(); // verse_key → words written the minority way
  private usual = new Map<string, Set<number>>();   // verse_key → variant words written the majority way
  private meta = new Map<string, [number, number]>(); // verse_key → [chapter, verseNo]
  private groupOf = new Map<string, [string, string]>(); // "verse#pos" → [group key, its spelling's key]
  private groupVariants = new Map<string, { key: string; variant: SpellingVariant }[]>(); // group key → variants
  private peers = new Map<string, Map<string, string[]>>(); // group key → spelling → the spellings that are spellings of it
  private groups: GroupRec[] = []; // in Book order of each group's first word
  private groupByKey = new Map<string, GroupRec>();
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.build = once(() => this.load());
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{
      verse_key: string; word_position: number; segment_type: string; tag: string | null; form_arabic: string | null;
      raw_features: string | null; lemma_buckwalter: string | null;
      lemma_arabic: string | null; root_arabic: string | null;
      chapter_id: number; verse_number: number;
    }>(
      `SELECT ws.verse_key, ws.word_position, ws.segment_type, ws.tag, ws.form_arabic, ws.raw_features,
              ws.lemma_buckwalter, ws.lemma_arabic, ws.root_arabic, v.chapter_id, v.verse_number
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );
    // reassemble each word from its STEM segments (surface + first lemma/raw, and the set
    // of distinct stem-lemmas so compounds can be excluded), noting what is attached
    const per = new Map<string, StemWord>();
    for (const r of rows) {
      const k = `${r.verse_key}#${r.word_position}`;
      let e = per.get(k);
      if (!e) {
        e = { vk: r.verse_key, pos: r.word_position, seq: per.size, surface: "", full: "", raw: "", lemma: "", lemmas: new Set(), prefixed: false, suffixed: false, question: false, lemmaAr: "", rootAr: null };
        per.set(k, e);
      }
      e.full += r.form_arabic ?? "";
      if (!this.meta.has(r.verse_key)) this.meta.set(r.verse_key, [r.chapter_id, r.verse_number]);
      if (r.segment_type === "PREFIX") {
        if (!e.surface) { e.prefixed = true; if (r.tag === "INTG") e.question = true; }
        continue;
      }
      if (r.segment_type === "SUFFIX") { if (e.surface) e.suffixed = true; continue; }
      if (r.segment_type !== "STEM") continue;
      e.surface += r.form_arabic ?? "";
      if (!e.raw && r.raw_features) e.raw = r.raw_features;
      if (!e.lemma && r.lemma_buckwalter) e.lemma = r.lemma_buckwalter;
      if (!e.lemmaAr && r.lemma_arabic) e.lemmaAr = r.lemma_arabic;
      if (!e.rootAr && r.root_arabic) e.rootAr = r.root_arabic;
      if (r.lemma_buckwalter) e.lemmas.add(r.lemma_buckwalter);
    }
    // group by (lemma | raw | skeleton): one word in one inflection
    const inflections = new Map<string, Spelled[]>();
    const wordOf = new Map<string, string>(); // inflection key → the word it is an inflection of
    for (const w of per.values()) {
      // skip compounds/assimilations (مِمَّا = مِن+مَا): not simple spelling variants
      if (!w.surface || !w.lemma || w.lemmas.size > 1) continue;
      const rk = rasmKey(w.surface);
      const weak = w.raw.split("|").includes("POS:V") ? vowelBeforeWeakEnd(w.surface) : "";
      const tail = `${skeleton(rk)}${weak ? `|${weak}` : ""}`;
      const gk = `${w.lemma}|${inflection(w.raw, rk)}|${tail}`;
      const g = inflections.get(gk);
      if (g) g.push({ w, rk });
      else { inflections.set(gk, [{ w, rk }]); wordOf.set(gk, `${w.lemma}|${core(w.raw)}|${tail}`); }
    }
    // One word, one entry: inflections of a word (see `core`) that write the stem with the very
    // same letters somewhere are joined, so كِتَٰب is listed once, not once with ٱل and once without.
    const joined = new Map<string, string>();
    const top = (g: string): string => { let r = g; while (joined.get(r) !== r) r = joined.get(r)!; return r; };
    const writtenBy = new Map<string, string>(); // word + bare spelling → an inflection that writes it
    for (const [gk, words] of inflections) {
      joined.set(gk, gk);
      const word = wordOf.get(gk)!;
      for (const key of new Set(words.map((sp) => bareRasm(sp, words)))) {
        const k = `${word}\n${key}`;
        const other = writtenBy.get(k);
        if (other === undefined) writtenBy.set(k, gk);
        else joined.set(top(gk), top(other));
      }
    }
    const groups = new Map<string, Spelled[]>();
    for (const [gk, words] of inflections) {
      const g = groups.get(top(gk));
      if (g) g.push(...words);
      else groups.set(top(gk), [...words]);
    }
    for (const words of groups.values()) words.sort((a, b) => a.w.seq - b.w.seq);
    const inBookOrder = [...groups.entries()].sort((a, b) => a[1][0]!.w.seq - b[1][0]!.w.seq);
    for (const [gk, words] of inBookOrder) {
      // ة is written ت whenever a pronoun is attached (ٱمْرَأَتُهُۥ, رَحْمَتِهِۦ): a rule of the script, not
      // a choice of spelling. So a word that carries a pronoun says nothing about ة or ت:
      //  - where the Book writes the bare word both ways (ٱمْرَأَةٌ, ٱمْرَأَتُ ٱلْعَزِيزِ), it is set aside
      //    and counted with neither, so each spelling is the places it was written by choice;
      //  - where the bare word is only ever ة, it is read with ة, like a hamza's seat above, and
      //    counted as `attached`: a difference elsewhere in the word (صَلَوٰة, صَلَاتِهِمْ) still shows.
      const bare = words.map((sp) => bareRasm(sp, words));
      const bareTa = words.some(({ w, rk }) => !w.suffixed && rk.endsWith("ة"));
      const openTa = new Set(bare.filter((key, i) => !words[i]!.w.suffixed && key.endsWith("ت")));
      const aside: StemWord[] = [];
      // each distinct bare spelling, shown as the word written exactly that way where one exists:
      // the vocalisation most of them carry (قَالَ, not the قَالُ of قَالُوا۟)
      const rasm = new Map<string, { surface: string; count: number; attached: number; verses: string[]; written: Map<string, number> }>();
      const keyed: { w: StemWord; key: string }[] = [];
      words.forEach((sp, i) => {
        let key = bare[i]!;
        const byRule = bareTa && sp.w.suffixed && key.endsWith("ت");
        if (byRule && openTa.has(key)) { aside.push(sp.w); return; }
        if (byRule) key = key.slice(0, -1) + "ة";
        let e = rasm.get(key);
        if (!e) { e = { surface: sp.w.surface, count: 0, attached: 0, verses: [], written: new Map() }; rasm.set(key, e); }
        if (key === sp.rk) e.written.set(sp.w.surface, (e.written.get(sp.w.surface) ?? 0) + 1);
        e.count++;
        if (byRule) e.attached++;
        if (e.verses.length < 100) e.verses.push(sp.w.vk);
        keyed.push({ w: sp.w, key });
      });
      if (rasm.size < 2) continue; // no variation
      for (const e of rasm.values()) {
        let best = 0;
        for (const [surface, k] of e.written) if (k > best) { best = k; e.surface = surface; }
      }
      const ranked = [...rasm.entries()].sort((a, b) => b[1].count - a[1].count);
      const majority = ranked[0]![0];
      // the cases each spelling's words carry, to tell a grammatical ending from a spelling
      const dual = words[0]!.w.raw.split("|").some((t) => /^[MF]?D$/.test(t));
      const cases = new Map<string, { by: Map<string, number>; n: number; tanwin: number }>();
      for (const { w, key } of keyed) {
        let s = cases.get(key);
        if (!s) { s = { by: new Map(), n: 0, tanwin: 0 }; cases.set(key, s); }
        const c = caseOf(w.raw);
        s.n++;
        if (c) s.by.set(c, (s.by.get(c) ?? 0) + 1);
        if (c === "ACC" && w.raw.split("|").includes("INDEF")) s.tanwin++;
      }
      const ending = (a: string, b: string) => {
        const A = cases.get(a)!;
        const B = cases.get(b)!;
        // the ا of tanwīn is an ending where every indefinite accusative has it and nothing else does
        if (b === a + "ا") return B.tanwin === B.n && A.tanwin === 0;
        if (a === b + "ا") return A.tanwin === A.n && B.tanwin === 0;
        // a letter that follows the case, by the case most of each spelling's words carry
        const ca = mainCase(A.by);
        const cb = mainCase(B.by);
        if (!endingOnly(a, b, ca, cb, dual)) return false;
        // ا accusative beside ى genitive (أَبَا, أَبِى) is an ending only where the ى keeps to its
        // case: هُدًى is written with ى in every case, so the ا of هُدَاىَ is a spelling
        const [alif, ya, other] = a.endsWith("ا") ? [A, B, ca] : b.endsWith("ا") ? [B, A, cb] : [null, null, undefined];
        if (!dual && alif && ya && other === "ACC") {
          const cased = [...ya.by.values()].reduce((x, y) => x + y, 0);
          if ((ya.by.get("ACC") ?? 0) / Math.max(1, cased) > 0.2) return false;
        }
        return true;
      };
      // the Book-wide list: every place of every spelling, and how the spellings differ
      const first = words[0]!.w;
      const kinds = new Set<string>();
      for (const [key] of ranked.slice(1)) {
        if (ending(majority, key)) kinds.add(ENDING);
        else for (const k of spellingDiffKinds(majority, key)) kinds.add(k);
      }
      const shapes = ranked.map(([key, { surface, attached }]) => {
        const mine = keyed.filter((k) => k.key === key);
        const places = mine.map(({ w }) => ({ verseKey: w.vk, word: w.pos }));
        return { surface, places, words: mine.map(({ w }) => w.full), ayahs: new Set(places.map((p) => p.verseKey)).size, attached };
      });
      const rec: GroupRec = {
        key: `${first.vk}:${first.pos}`,
        lemma: first.lemmaAr,
        root: first.rootAr,
        kinds: SPELLING_KINDS.map((k) => k.id).filter((id) => kinds.has(id)),
        folded: [first.lemmaAr, ...shapes.map((s) => s.surface)].map((s) => foldArabic(s)),
        loose: new Set([first.lemmaAr, ...shapes.map((s) => s.surface)].map(looseKey)),
        shapes,
        aside: aside.map((w) => ({ verseKey: w.vk, word: w.pos })),
        total: words.length,
      };
      this.groups.push(rec);
      this.groupByKey.set(rec.key, rec);
      // The reader's ✍ marks: a word is a variant only against the spellings that differ from its
      // own by more than a grammatical ending (its peers, itself included, commonest first). A
      // group whose spellings differ only by endings marks nothing.
      this.groupVariants.set(gk, ranked.map(([key, { surface, count, verses }]) => ({ key, variant: { surface, count, verses } })));
      const peers = new Map<string, string[]>();
      for (const [key] of ranked) peers.set(key, ranked.map(([k]) => k).filter((k) => k === key || !ending(key, k)));
      this.peers.set(gk, peers);
      for (const { w, key } of keyed) {
        const mine = peers.get(key)!;
        if (mine.length < 2) continue;
        this.groupOf.set(`${w.vk}#${w.pos}`, [gk, key]);
        // the MINORITY spellings are the word written unusually here
        const into = key === mine[0] ? this.usual : this.unusual;
        let s = into.get(w.vk);
        if (!s) { s = new Set(); into.set(w.vk, s); }
        s.add(w.pos);
      }
    }
  }

  /** The rasm variants of the word at (verseKey, wordPosition), from the same
   *  grouping the ✍ marks use — so the two always agree. [] when no variation. `here`
   *  marks the spelling this occurrence is written in. */
  async variantsForWord(verseKey: string, wordPosition: number): Promise<SpellingVariant[]> {
    await this.build();
    const at = this.groupOf.get(`${verseKey}#${wordPosition}`);
    if (!at) return [];
    const mine = this.peers.get(at[0])?.get(at[1]) ?? [];
    return (this.groupVariants.get(at[0]) ?? [])
      .filter(({ key }) => mine.includes(key))
      .map(({ key, variant }) => ({ ...variant, here: key === at[1] }));
  }

  /** Verses in a chapter with a word written unusually, plus their words that have other
   *  spellings but are written the usual way here. A verse whose variant words are all
   *  written the usual way isn't listed: nearly every āyah has one (إِلَىٰ, قَالَ), and the
   *  ✍ mark would stop meaning anything. */
  async chapterVariants(chapterId: number): Promise<VerseVariants[]> {
    await this.build();
    const sorted = (s: Set<number> | undefined) => [...(s ?? [])].sort((a, b) => a - b);
    const out: VerseVariants[] = [];
    for (const [vk, set] of this.unusual) {
      if (this.meta.get(vk)?.[0] === chapterId) out.push({ verse_key: vk, positions: sorted(set), common: sorted(this.usual.get(vk)) });
    }
    out.sort((a, b) => (this.meta.get(a.verse_key)![1]) - (this.meta.get(b.verse_key)![1]));
    return out;
  }

  /** Every word the Book writes in more than one way, most places first (then Book order), or
   *  with sort "alpha" by the word in the order of the Arabic alphabet (vowels ignored, a hamza
   *  on any seat read as ا). `q` finds a word by its Arabic (vowels ignored); `kind` keeps one
   *  kind of difference. Each spelling lists its first 12 places; `group(key)` gives them all. */
  async list(q: SpellingListQuery = {}): Promise<SpellingList> {
    await this.build();
    let items = this.groups;
    const text = (q.q ?? "").replace(/\s+/g, "");
    if (text) {
      const f = foldArabic(text);
      const lk = looseKey(text);
      items = items.filter((g) => (f && g.folded.some((s) => s.includes(f))) || (lk && g.loose.has(lk)));
    }
    // every kind the Book shows at all, counted within what `q` found
    const kinds = SPELLING_KINDS
      .filter((k) => this.groups.some((g) => g.kinds.includes(k.id)))
      .map((k) => ({ ...k, count: items.filter((g) => g.kinds.includes(k.id)).length }));
    // without a kind, a group whose spellings differ only by a grammatical ending is left out
    let hidden = 0;
    if (q.kind) items = items.filter((g) => g.kinds.includes(q.kind!));
    else {
      const shown = items.filter((g) => !(g.kinds.length === 1 && g.kinds[0] === ENDING));
      hidden = items.length - shown.length;
      items = shown;
    }
    // the folded letters stand in Unicode in the order of the alphabet
    // (ءَا is the script's آ: one alif, so ءَايَة stands with the words in ا ي)
    const letters = (g: GroupRec) => (g.folded[0] ?? "").replace(/ءا/g, "ا").replace(/ء/g, "ا");
    const sorted = items
      .map((g, i) => ({ g, i }))
      .sort(q.sort === "alpha"
        ? (a, b) => (letters(a.g) < letters(b.g) ? -1 : letters(a.g) > letters(b.g) ? 1 : a.i - b.i)
        : (a, b) => b.g.total - a.g.total || a.i - b.i)
      .map(({ g }) => g);
    const offset = Math.max(0, Math.trunc(q.offset ?? 0));
    const limit = Math.min(500, Math.max(1, Math.trunc(q.limit ?? 50)));
    return { total: sorted.length, hidden, kinds, items: sorted.slice(offset, offset + limit).map((g) => this.view(g, 12)) };
  }

  /** One group with every place of every spelling; null when the key names no group. */
  async group(key: string): Promise<SpellingGroup | null> {
    await this.build();
    const g = this.groupByKey.get(key);
    return g ? this.view(g, Infinity) : null;
  }

  /** The words one group counts under one of its spellings, in Book order: exactly the places
   *  the list shows for it. `spelling` is the spelling as the group names it (its `surface`).
   *  null when the key names no group, or the group has no such spelling. */
  async spellingWords(groupKey: string, spelling: string): Promise<WordOccurrence[] | null> {
    await this.build();
    const g = this.groupByKey.get(groupKey);
    if (!g) return null;
    const rk = rasmKey(asSegments(spelling));
    const s = g.shapes.find((x) => x.surface === spelling) ?? g.shapes.find((x) => rasmKey(x.surface) === rk);
    return s ? s.places.map((p, i) => ({ verse_key: p.verseKey, word_position: p.word, surface: s.words[i]! })) : null;
  }

  private view(g: GroupRec, cap: number): SpellingGroup {
    const capped = (places: SpellingPlace[]) => (Number.isFinite(cap) ? places.slice(0, cap) : places);
    return {
      key: g.key, lemma: g.lemma, root: g.root, total: g.total, kinds: g.kinds,
      spellings: g.shapes.map((s) => ({
        surface: s.surface, count: s.places.length, ayahs: s.ayahs, ...(s.attached ? { attached: s.attached } : {}),
        places: capped(s.places),
      })),
      ...(g.aside.length
        ? { withPronoun: { count: g.aside.length, ayahs: new Set(g.aside.map((p) => p.verseKey)).size, places: capped(g.aside) } }
        : {}),
    };
  }
}
