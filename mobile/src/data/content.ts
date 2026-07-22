// Quran content & metadata — on-device port of server/src/content.ts.
// Read-only access to chapters, verses (multiple scripts), per-word breakdown,
// translations, neighbours, and verbatim phrase search. Same SQL as the server.

import type { Db } from "./db";
import type { Chapter, Script, Translation, TranslationResource, Verse, Word } from "../types";
import { foldArabic } from "../text/normalize";

export const SCRIPTS: Record<string, string> = {
  uthmani: "text_uthmani",
  uthmani_simple: "text_uthmani_simple",
  imlaei: "text_imlaei",
  imlaei_simple: "text_imlaei_simple",
  indopak: "text_indopak",
  tajweed: "text_uthmani_tajweed",
};

const VERSE_META = [
  "verse_key", "chapter_id", "verse_number", "verse_index",
  "juz_number", "hizb_number", "rub_el_hizb_number",
  "page_number", "ruku_number", "manzil_number",
];

type Row = Record<string, unknown>;

function scriptCol(script: string): string {
  const col = SCRIPTS[script];
  if (!col) throw new Error(`unknown script '${script}'`);
  return col;
}

function verseDict(row: Row, script: string, allScripts: boolean): Verse {
  const d: Row = {};
  for (const k of VERSE_META) d[k] = row[k];
  if (allScripts) {
    const text: Row = {};
    for (const [name, col] of Object.entries(SCRIPTS)) text[name] = row[col];
    d.text = text;
  } else {
    d.script = script;
    d.text = row[scriptCol(script)];
  }
  return d as unknown as Verse;
}

export function listChapters(db: Db): Chapter[] {
  return db.query<Chapter>("SELECT * FROM chapters ORDER BY id");
}

export function getChapter(db: Db, chapterId: number): Chapter | undefined {
  return db.one<Chapter>("SELECT * FROM chapters WHERE id = ?", [chapterId]);
}

export function chapterVerses(
  db: Db,
  chapterId: number,
  opts: { script?: Script; allScripts?: boolean; withWords?: boolean; limit?: number | null; offset?: number } = {},
): Verse[] {
  const script = opts.script ?? "uthmani";
  scriptCol(script);
  let sql = "SELECT * FROM verses WHERE chapter_id = ? ORDER BY verse_number";
  const params: unknown[] = [chapterId];
  if (opts.limit != null) {
    sql += " LIMIT ? OFFSET ?";
    params.push(opts.limit, opts.offset ?? 0);
  }
  return db.query<Row>(sql, params).map((row) => {
    const d = verseDict(row, script, opts.allScripts ?? false);
    if (opts.withWords) d.words = verseWords(db, row.verse_key as string);
    return d;
  });
}

export function getVerse(
  db: Db,
  verseKey: string,
  opts: { script?: Script; allScripts?: boolean; withWords?: boolean; withTranslations?: boolean } = {},
): Verse | undefined {
  const script = opts.script ?? "uthmani";
  scriptCol(script);
  const row = db.one<Row>("SELECT * FROM verses WHERE verse_key = ?", [verseKey]);
  if (!row) return undefined;
  const d = verseDict(row, script, opts.allScripts ?? false);
  if (opts.withWords) d.words = verseWords(db, verseKey);
  if (opts.withTranslations) d.translations = verseTranslations(db, verseKey);
  return d;
}

export function verseNeighbours(
  db: Db,
  verseKey: string,
  opts: { radius?: number; script?: Script } = {},
): Verse[] | null {
  const script = opts.script ?? "uthmani";
  const radius = opts.radius ?? 2;
  scriptCol(script);
  const target = db.one<{ chapter_id: number; verse_number: number }>(
    "SELECT chapter_id, verse_number FROM verses WHERE verse_key = ?", [verseKey],
  );
  if (!target) return null;
  const { chapter_id: ci, verse_number: vn } = target;
  const before = db.query<Row>(
    `SELECT * FROM verses
     WHERE chapter_id < ? OR (chapter_id = ? AND verse_number < ?)
     ORDER BY chapter_id DESC, verse_number DESC LIMIT ?`,
    [ci, ci, vn, radius],
  );
  const center = db.one<Row>("SELECT * FROM verses WHERE verse_key = ?", [verseKey])!;
  const after = db.query<Row>(
    `SELECT * FROM verses
     WHERE chapter_id > ? OR (chapter_id = ? AND verse_number > ?)
     ORDER BY chapter_id ASC, verse_number ASC LIMIT ?`,
    [ci, ci, vn, radius],
  );
  const ordered = [...before.reverse(), center, ...after];
  return ordered.map((r) => {
    const d = verseDict(r, script, false);
    d.focus = r.verse_key === verseKey;
    return d;
  });
}

export function phraseSearch(
  db: Db,
  phrase: string,
  opts: { script?: Script; limit?: number } = {},
): Verse[] {
  const script = opts.script ?? "uthmani";
  const limit = opts.limit ?? 50;
  scriptCol(script);
  const skel = (s: string) => foldArabic(s ?? "").replaceAll("ا", "");
  const q = skel(phrase).trim();
  if (!q) return [];
  const out: Verse[] = [];
  for (const r of db.query<Row>("SELECT * FROM verses ORDER BY chapter_id, verse_number")) {
    if (skel((r.text_imlaei_simple as string) ?? "").includes(q)) {
      out.push(verseDict(r, script, false));
      if (out.length >= limit) break;
    }
  }
  return out;
}

// -- words --
function wordArabic(db: Db, verseKey: string): Map<number, string> {
  const rows = db.query<{ word_position: number; form_arabic: string | null }>(
    `SELECT word_position, form_arabic FROM word_segments
     WHERE verse_key = ? ORDER BY word_position, segment_number`,
    [verseKey],
  );
  const out = new Map<number, string>();
  for (const r of rows) {
    if (r.form_arabic) out.set(r.word_position, (out.get(r.word_position) ?? "") + r.form_arabic);
  }
  return out;
}

export function verseWords(db: Db, verseKey: string): Word[] {
  const arabic = wordArabic(db, verseKey);
  const rows = db.query<Row>(
    `SELECT position, translation_text, transliteration_text,
            lemma_arabic, root_arabic, root_buckwalter,
            pos_english, pos_class
     FROM words WHERE verse_key = ? ORDER BY position`,
    [verseKey],
  );
  return rows.map((r) => ({
    position: r.position as number,
    arabic: arabic.get(r.position as number) ?? null,
    gloss: (r.translation_text as string) ?? null,
    transliteration: (r.transliteration_text as string) ?? null,
    lemma: (r.lemma_arabic as string) ?? null,
    root: (r.root_arabic as string) ?? null,
    root_buckwalter: (r.root_buckwalter as string) ?? null,
    pos: (r.pos_english as string) ?? null,
    pos_class: (r.pos_class as string) ?? null,
  }));
}

// -- translations --
export function listTranslationResources(db: Db): TranslationResource[] {
  return db.query<TranslationResource>(
    `SELECT tr.id, tr.name, tr.author_name, tr.language_name, tr.resource_type
     FROM translation_resources tr
     WHERE tr.id IN (SELECT DISTINCT resource_id FROM verse_translations)
     ORDER BY tr.resource_type, tr.language_name, tr.id`,
  );
}

export function verseTranslations(db: Db, verseKey: string): Translation[] {
  return db.query<Translation>(
    `SELECT vt.resource_id, vt.language_name, vt.text,
            tr.name AS resource_name, tr.author_name, tr.resource_type
     FROM verse_translations vt
     LEFT JOIN translation_resources tr ON tr.id = vt.resource_id
     WHERE vt.verse_key = ?
     ORDER BY vt.resource_id`,
    [verseKey],
  );
}
