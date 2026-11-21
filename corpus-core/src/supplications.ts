// Supplications: every place the Lord is addressed with one of three openings, in Book order,
// decided from the morphology. Whether a place is a supplication is the reader's to say: this
// lists where the address is written, nothing more.
//
//   rabbana    رَبّ with the attached نَا, in the accusative (the case of the address): رَبَّنَا.
//              Not رَبُّنَا or رَبِّنَا (another case: a statement, or after a preposition), not after
//              إِنَّ / أَنَّ (a particle the corpus tags ACC governs it: إِنَّ رَبَّنَا لَغَفُورٌ, 35:34).
//              The morphology cannot tell a verb's object from an address, so a رَبَّنَا that is
//              an object (أَوْ نَرَىٰ رَبَّنَا, 25:21) is listed too: the reader says which it is.
//   rabbi      رَبّ with the ى of "my" not written, the corpus's empty pronoun: رَبِّ (and يَـٰرَبِّ).
//              Not رَبِّ ٱلْعَـٰلَمِينَ (no pronoun) and not رَبِّى (the ى written: a statement).
//   allahumma  the word whose lemma the corpus gives as ٱللَّهُمَّ (ٱللَّه with the vocative مَّ).

import type { CorpusDb } from "./corpus-db.js";

export type SupplicationOpening = "rabbana" | "rabbi" | "allahumma";
export interface Supplication { verseKey: string; word: number; opening: SupplicationOpening; text: string }
export interface Supplications {
  total: number;
  ayahs: number;
  /** every opening with its full count, whatever `opening` filtered */
  openings: { id: SupplicationOpening; label: string; count: number; ayahs: number }[];
  items: Supplication[];
}

export const SUPPLICATION_OPENINGS: readonly { id: SupplicationOpening; label: string }[] = [
  { id: "rabbana", label: "رَبَّنَا" },
  { id: "rabbi", label: "رَبِّ" },
  { id: "allahumma", label: "ٱللَّهُمَّ" },
];
export const isSupplicationOpening = (v: unknown): v is SupplicationOpening =>
  SUPPLICATION_OPENINGS.some((o) => o.id === v);

interface Seg {
  verse_key: string; word_position: number; segment_type: string | null; tag: string | null;
  form_arabic: string | null; lemma_buckwalter: string | null;
  person: string | null; number: string | null; raw_features: string | null;
}

/** Worked out once per corpus, on first use; concurrent callers share the one build. */
const built = new WeakMap<CorpusDb, Promise<Supplication[]>>();
function every(db: CorpusDb): Promise<Supplication[]> {
  let p = built.get(db);
  if (!p) {
    p = find(db).catch((e) => { built.delete(db); throw e; });
    built.set(db, p);
  }
  return p;
}

async function find(db: CorpusDb): Promise<Supplication[]> {
  // the āyāt that hold رَبّ or ٱللَّهُمَّ, then every segment of them, in Book order
  const segs = await db.query<Seg>(
    `SELECT ws.verse_key, ws.word_position, ws.segment_type, ws.tag, ws.form_arabic, ws.lemma_buckwalter,
            ws.person, ws.number, ws.raw_features
     FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
     WHERE ws.verse_key IN (SELECT verse_key FROM word_segments WHERE lemma_buckwalter IN ('rab~', '{ll~ahum~a'))
     ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
  );

  interface Word { verseKey: string; pos: number; text: string; segs: Seg[] }
  const words: Word[] = [];
  for (const s of segs) {
    let w = words[words.length - 1];
    if (!w || w.verseKey !== s.verse_key || w.pos !== s.word_position) {
      w = { verseKey: s.verse_key, pos: s.word_position, text: "", segs: [] };
      words.push(w);
    }
    w.text += s.form_arabic ?? "";
    w.segs.push(s);
  }

  const out: Supplication[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const stem = w.segs.find((s) => s.segment_type === "STEM");
    if (!stem) continue;
    let opening: SupplicationOpening | null = null;
    if (stem.lemma_buckwalter === "{ll~ahum~a") {
      opening = "allahumma";
    } else if (stem.lemma_buckwalter === "rab~") {
      const me = w.segs.find((s) => s.segment_type === "SUFFIX" && s.tag === "PRON" && s.person === "1");
      if (me?.number === "S" && !(me.form_arabic ?? "")) opening = "rabbi";
      else if (me?.number === "P" && (stem.raw_features ?? "").split("|").includes("ACC")) {
        const prev = words[i - 1]?.verseKey === w.verseKey ? words[i - 1] : undefined;
        if (!prev?.segs.some((s) => s.tag === "ACC")) opening = "rabbana";
      }
    }
    if (opening) out.push({ verseKey: w.verseKey, word: w.pos, opening, text: w.text });
  }
  return out;
}

/** Every place of the three openings, or of one. */
export async function supplications(db: CorpusDb, opening?: SupplicationOpening): Promise<Supplications> {
  const all = await every(db);
  const items = opening ? all.filter((s) => s.opening === opening) : all;
  const ayahsOf = (l: Supplication[]) => new Set(l.map((s) => s.verseKey)).size;
  return {
    total: items.length,
    ayahs: ayahsOf(items),
    openings: SUPPLICATION_OPENINGS.map((o) => {
      const of = all.filter((s) => s.opening === o.id);
      return { id: o.id, label: o.label, count: of.length, ayahs: ayahsOf(of) };
    }),
    items,
  };
}
