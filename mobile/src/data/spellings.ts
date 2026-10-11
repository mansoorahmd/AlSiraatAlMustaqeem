// Rasm (orthography) variants: the same word + inflection written differently
// across the mushaf — e.g. إبراهيم full-yāʾ vs superscript small-yāʾ, قال vs قٰل
// (alif vs dagger-alif), رَأَىٰ vs رَءَا (hamza-on-alif vs hamza-on-the-line).
//
// "Same word" = same morphological analysis (`raw_features`, which encodes
// lemma + root + inflection) AND the same normalized skeleton (hamza seats and
// alif/maqṣūra/dagger collapsed) — the skeleton keeps causative أرى from being
// lumped with رأى even though they share raw_features. Within such a group,
// distinct RASM keys are genuine spelling variants.

import type { Db } from "./db";
import { normalizeRoot } from "../text/normalize";

export interface SpellingVariant {
  surface: string;  // a representative stem spelling (with its marks)
  count: number;    // how many occurrences use this spelling
  verses: string[]; // sample verse keys
}

// RASM key: keep only base rasm letters + dagger-alif + wasla + small wāw/yāʾ;
// drop every vowel/tanwīn/shadda/sukūn/madda/waqf annotation. So a full yāʾ vs a
// small yāʾ, or an alif vs a dagger-alif, stay distinct.
export const rasmKey = (s: string) => (s || "").replace(/[^\u0621-\u064A\u0670\u0671\u06E5\u06E6]/g, "");

// SKELETON: further collapse hamza seats (all → ء) and long-a letters
// (alif / alif-maqṣūra / dagger-alif → ا), small yāʾ/wāw → yāʾ/wāw, then squash
// runs. Occurrences with the same raw_features AND skeleton are the same word.
const SKEL: Record<string, string> = {
  "ء": "ء", "أ": "ء", "إ": "ء", "ؤ": "ء", "ئ": "ء", "ٱ": "ا",
  "آ": "ا", "ا": "ا", "ى": "ا", "ٰ": "ا",
  "ۦ": "ي", "ۥ": "و",
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

interface StemRow { verse_key: string; word_position: number; form_arabic: string | null; segment_number: number; raw_features: string | null; }

function stemSurfaces(rows: StemRow[]): Map<string, { vk: string; surface: string; raw: string }> {
  const per = new Map<string, { vk: string; surface: string; raw: string }>();
  for (const r of rows) {
    const k = `${r.verse_key}#${r.word_position}`;
    const cur = per.get(k);
    per.set(k, { vk: r.verse_key, surface: (cur?.surface ?? "") + (r.form_arabic ?? ""), raw: r.raw_features ?? cur?.raw ?? "" });
  }
  return per;
}

/** Distinct spellings of the exact word (same raw_features + skeleton) the
 *  tapped occurrence is. Returns a single entry when there's no variation. */
export function spellingVariantsForWord(db: Db, verseKey: string, wordPosition: number): SpellingVariant[] {
  const lb = db.scalar<string>(
    `SELECT lemma_buckwalter FROM word_segments
     WHERE verse_key = ? AND word_position = ? AND segment_type = 'STEM' AND lemma_buckwalter IS NOT NULL
     LIMIT 1`,
    [verseKey, wordPosition],
  );
  if (!lb) return [];

  const rows = db.query<StemRow>(
    `SELECT verse_key, word_position, form_arabic, segment_number, raw_features FROM word_segments
     WHERE lemma_buckwalter = ? AND segment_type = 'STEM'
     ORDER BY verse_key, word_position, segment_number`,
    [lb],
  );
  const per = stemSurfaces(rows);
  const self = per.get(`${verseKey}#${wordPosition}`);
  if (!self) return [];
  const targetRaw = self.raw;
  const targetSkel = skeleton(rasmKey(self.surface));

  const groups = new Map<string, { surface: string; count: number; verses: string[] }>();
  for (const { vk, surface, raw } of per.values()) {
    const rk = rasmKey(surface);
    if (raw !== targetRaw || skeleton(rk) !== targetSkel) continue;
    let g = groups.get(rk);
    if (!g) { g = { surface, count: 0, verses: [] }; groups.set(rk, g); }
    g.count++;
    if (g.verses.length < 100) g.verses.push(vk);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Āyāt containing the exact written word (surface rasm — letters as written,
 *  vowel marks ignored so the same word in different cases still matches).
 *  Works for any word, including particles and proper nouns with no root. */
export function exactWordOccurrences(
  db: Db,
  surface: string,
  limit = 3000,
): { verse_key: string; word_position: number }[] {
  const target = rasmKey(surface);
  if (!target) return [];
  const rows = db.query<{ verse_key: string; word_position: number; form_arabic: string | null }>(
    `SELECT ws.verse_key, ws.word_position, ws.form_arabic
     FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
     ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
  );
  // assemble each word's full surface (all segments) in mushaf order
  const per = new Map<string, string>();
  for (const r of rows) {
    const k = `${r.verse_key}#${r.word_position}`;
    per.set(k, (per.get(k) ?? "") + (r.form_arabic ?? ""));
  }
  const out: { verse_key: string; word_position: number }[] = [];
  const seenVerse = new Set<string>();
  for (const [k, surf] of per) {
    if (rasmKey(surf) !== target) continue;
    const [vk, pos] = k.split("#");
    if (seenVerse.has(vk!)) continue; // one hop per verse
    seenVerse.add(vk!);
    out.push({ verse_key: vk!, word_position: Number(pos) });
    if (out.length >= limit) break;
  }
  return out;
}

/** For every form (lemma) of a root, the spelling-variant groups it has (each
 *  group = one word+inflection written ≥2 ways). Only forms WITH variation are
 *  returned. One query for the whole root. Keyed by lemma_buckwalter. */
export function rootSpellingsByForm(db: Db, root: string): Map<string, SpellingVariant[][]> {
  const bw = normalizeRoot(root);
  const rows = db.query<StemRow & { lemma_buckwalter: string | null }>(
    `SELECT verse_key, word_position, form_arabic, segment_number, raw_features, lemma_buckwalter
     FROM word_segments WHERE root_buckwalter = ? AND segment_type = 'STEM'
     ORDER BY lemma_buckwalter, verse_key, word_position, segment_number`,
    [bw],
  );
  // reassemble each word (surface + raw + lemma)
  const per = new Map<string, { vk: string; surface: string; raw: string; lemma: string }>();
  for (const r of rows) {
    const k = `${r.verse_key}#${r.word_position}`;
    const cur = per.get(k);
    per.set(k, {
      vk: r.verse_key,
      surface: (cur?.surface ?? "") + (r.form_arabic ?? ""),
      raw: r.raw_features ?? cur?.raw ?? "",
      lemma: r.lemma_buckwalter ?? cur?.lemma ?? "",
    });
  }
  // lemma → group-key → rasm → variant
  const byLemma = new Map<string, Map<string, Map<string, { surface: string; count: number; verses: string[] }>>>();
  for (const { vk, surface, raw, lemma } of per.values()) {
    if (!lemma) continue;
    const rk = rasmKey(surface);
    const gk = `${raw}${skeleton(rk)}`;
    let g = byLemma.get(lemma);
    if (!g) { g = new Map(); byLemma.set(lemma, g); }
    let m = g.get(gk);
    if (!m) { m = new Map(); g.set(gk, m); }
    let v = m.get(rk);
    if (!v) { v = { surface, count: 0, verses: [] }; m.set(rk, v); }
    v.count++;
    if (v.verses.length < 100) v.verses.push(vk);
  }
  const out = new Map<string, SpellingVariant[][]>();
  for (const [lemma, g] of byLemma) {
    const groups: SpellingVariant[][] = [];
    for (const m of g.values()) {
      if (m.size > 1) groups.push([...m.values()].sort((a, b) => b.count - a.count));
    }
    if (groups.length) out.set(lemma, groups);
  }
  return out;
}
