// Voices: where speech is introduced in a sūrah, and the pronouns of an āyah. Both read straight
// from the morphology (word_segments); neither says who speaks or whom a pronoun points to.
//
// Speech openers. Every verb of the root ق و ل (قَالَ، قَالُوا، قُلْ، يَقُولُونَ …), `sure`. Every verb
// of ن د و (نَادَىٰ، نُودِىَ …), `sure` only where the corpus itself marks what follows it as addressed
// or explained: a vocative (يَا, tag VOC) or the أَنْ it tags as a particle of interpretation (INT),
// before any other verb in the āyah. Elsewhere it is listed with `sure: false`: a call, after which
// speech may or may not follow (نَادَيْتُمْ إِلَى ٱلصَّلَوٰةِ, 5:58; وَنَادَىٰ نُوحٌ ٱبْنَهُ وَكَانَ فِى مَعْزِلٍ
// يَـٰبُنَىَّ, 11:42, where كَانَ comes between). A reader may add roots of their own: their verbs are
// listed `added`, and `sure` the same way as for ن د و. Where the speech ends is not marked in the
// data and is not guessed.
//
// Pronouns. Separate pronouns (هُوَ، إِيَّاكَ), pronouns attached to a word (the suffix of عَلَيْهِمْ, the
// stem of لَهُمْ after its preposition) and, when asked, the person, number and gender every verb
// carries for its subject (type "verb": nothing written, so `pronoun` is empty). Each carries
// `part`, its number within its word in the corpus's order, counting the verb's subject whether
// or not verbs were asked for, so the number is the same either way (mentions are stored by it).

import type { CorpusDb } from "./corpus-db.js";

export interface SpeechOpener {
  verseKey: string; word: number; text: string; root: string; lemma: string;
  /** true when the corpus itself shows speech follows: every verb of ق و ل, and another verb where
   *  a vocative (يا) or an explaining أن follows it before any other verb. false = a call; speech
   *  may or may not follow. */
  sure: boolean;
  /** true when the verb is of a root the reader added (not ق و ل or ن د و) */
  added?: boolean;
}
export interface SpeechOpeners { chapter: number; openers: SpeechOpener[] }

/** The most extra roots one request may add. */
export const MAX_EXTRA_ROOTS = 10;

export interface PronounInAyah {
  word: number;
  /** the whole word as written */
  text: string;
  /** the pronoun as written; empty when it is not written (a verb's subject, or the dropped ى
   *  of رَبِّ for رَبِّى) */
  pronoun: string;
  type: "separate" | "attached" | "verb";
  person: string | null;
  number: string | null;
  gender: string | null;
  /** which pronoun of its word this is, counting from 1 in the corpus's order (a word such as
   *  خَلَقْنَـٰكُمْ carries two, after the verb's own subject). A mention points at one by it. */
  part: number;
}
export interface AyahPronouns { verseKey: string; pronouns: PronounInAyah[] }

interface Seg {
  verse_key: string; word_position: number; segment_type: string | null; tag: string | null;
  form_arabic: string | null; lemma_arabic: string | null; root_arabic: string | null;
  root_buckwalter: string | null; person: string | null; gender: string | null; number: string | null;
  raw_features: string | null;
}

const SEG_COLUMNS = `ws.verse_key, ws.word_position, ws.segment_type, ws.tag, ws.form_arabic, ws.lemma_arabic,
  ws.root_arabic, ws.root_buckwalter, ws.person, ws.gender, ws.number, ws.raw_features`;

interface Word { verseKey: string; pos: number; text: string; segs: Seg[] }

/** Segments grouped into words, in reading order. */
function wordsOf(rows: Seg[]): Word[] {
  const out: Word[] = [];
  for (const r of rows) {
    let w = out[out.length - 1];
    if (!w || w.verseKey !== r.verse_key || w.pos !== r.word_position) {
      w = { verseKey: r.verse_key, pos: r.word_position, text: "", segs: [] };
      out.push(w);
    }
    w.text += r.form_arabic ?? "";
    w.segs.push(r);
  }
  return out;
}

const SAY = "qwl";
const CALL = "ndw";
const verbOf = (w: Word) => w.segs.find((s) => s.segment_type === "STEM" && s.tag === "V");

/** A root as a reader types it, reduced to its letters (spaces, marks and anything else dropped). */
export const rootLetters = (s: string) => s.replace(/[^ء-غف-ي]/g, "");

/** Parse `?roots=`: comma-separated roots in Arabic letters (spaces inside a root allowed).
 *  Throws a RangeError past MAX_EXTRA_ROOTS. */
export function parseExtraRoots(v: string | undefined): string[] {
  const roots = [...new Set((v ?? "").split(/[,،]/).map(rootLetters).filter(Boolean))];
  if (roots.length > MAX_EXTRA_ROOTS) throw new RangeError(`at most ${MAX_EXTRA_ROOTS} roots`);
  return roots;
}

/** The words that open speech in a sūrah, in reading order; null for a chapter that isn't one.
 *  `extraRoots` (Arabic letters) adds the verbs of those roots, marked `added`; a root the Book
 *  does not have finds nothing. */
export async function speechOpeners(db: CorpusDb, chapter: number, extraRoots: string[] = []): Promise<SpeechOpeners | null> {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 114) return null;
  const rows = await db.query<Seg>(
    `SELECT ${SEG_COLUMNS}
     FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
     WHERE v.chapter_id = ?
     ORDER BY v.verse_number, ws.word_position, ws.segment_number`,
    [chapter],
  );
  const added = new Set(extraRoots.map(rootLetters).filter(Boolean));
  const words = wordsOf(rows);
  const openers: SpeechOpener[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const v = verbOf(w);
    if (!v) continue;
    const say = v.root_buckwalter === SAY;
    const call = v.root_buckwalter === CALL;
    const extra = !say && !call && added.has(v.root_arabic ?? "");
    if (!say && !call && !extra) continue;
    let sure = say;
    if (!sure) {
      // the corpus marks what follows as addressed (VOC) or explained (INT), before another verb
      for (let j = i + 1; j < words.length && words[j]!.verseKey === w.verseKey; j++) {
        const next = words[j]!;
        if (next.segs.some((s) => s.tag === "VOC" || s.tag === "INT")) { sure = true; break; }
        if (verbOf(next)) break;
      }
    }
    openers.push({
      verseKey: w.verseKey, word: w.pos, text: w.text, root: v.root_arabic ?? "", lemma: v.lemma_arabic ?? "", sure,
      ...(extra ? { added: true } : {}),
    });
  }
  return { chapter, openers };
}

/** An āyah's pronouns, in reading order; null for a verse key that isn't one. */
export async function ayahPronouns(db: CorpusDb, verseKey: string, opts: { verbs?: boolean } = {}): Promise<AyahPronouns | null> {
  const rows = await db.query<Seg>(
    `SELECT ${SEG_COLUMNS} FROM word_segments ws
     WHERE ws.verse_key = ?
     ORDER BY ws.word_position, ws.segment_number`,
    [verseKey],
  );
  if (rows.length === 0) return null;
  const pronouns: PronounInAyah[] = [];
  for (const w of wordsOf(rows)) {
    // a pronoun stem after a preposition (لَهُمْ، بِهِۦ) is written joined to it
    const afterPreposition = w.segs.some((s) => s.segment_type === "PREFIX" && s.tag === "P");
    // every pronoun entry of the word is numbered, the verb's subject included even when it is
    // not returned, so `part` is the same with verbs asked for or not
    let part = 0;
    for (const s of w.segs) {
      const png = { person: s.person, number: s.number, gender: s.gender };
      if (s.tag === "PRON" && s.segment_type === "STEM") {
        part++;
        pronouns.push({ word: w.pos, text: w.text, pronoun: s.form_arabic ?? "", type: afterPreposition ? "attached" : "separate", ...png, part });
      } else if (s.tag === "PRON" && s.segment_type === "SUFFIX") {
        part++;
        pronouns.push({ word: w.pos, text: w.text, pronoun: s.form_arabic ?? "", type: "attached", ...png, part });
      } else if (s.tag === "V" && s.segment_type === "STEM") {
        part++;
        if (opts.verbs) pronouns.push({ word: w.pos, text: w.text, pronoun: "", type: "verb", ...png, part });
      }
    }
  }
  return { verseKey, pronouns };
}
