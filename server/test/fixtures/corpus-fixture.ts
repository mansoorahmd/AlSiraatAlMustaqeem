// A small but realistic quran.db, built from quran.db's REAL DDL — shared by the corpus tests.
// Arabic with marks above and below, NULLs, a BLOB, and a full word → segment → form → root path.
// Column order matters: the migrator copies by source column order and the verifier checks it.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "../../src/corpus/sqlite.js";
import type { SqlRunner } from "../../src/migrate.js";
import { PGlite } from "@electric-sql/pglite";

const dir = mkdtempSync(join(tmpdir(), "alsiraat-corpus-"));

// quran.db's DDL (the FTS5 virtual tables are omitted — they hold no data of their own)
export const DDL = `
CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE chapters (id INTEGER PRIMARY KEY, name_simple TEXT NOT NULL, name_arabic TEXT, name_complex TEXT,
  revelation_place TEXT, revelation_order INTEGER, bismillah_pre INTEGER, verses_count INTEGER,
  pages_first INTEGER, pages_last INTEGER);
CREATE TABLE juzs (id INTEGER PRIMARY KEY, juz_number INTEGER NOT NULL, verse_mapping TEXT,
  first_verse_id INTEGER, last_verse_id INTEGER, verses_count INTEGER);
CREATE TABLE roots (id INTEGER PRIMARY KEY AUTOINCREMENT, root_buckwalter TEXT NOT NULL UNIQUE,
  root_arabic TEXT NOT NULL, letters_arabic TEXT, letter_count INTEGER, meaning_en TEXT, meaning_ar TEXT);
CREATE TABLE root_forms (id INTEGER PRIMARY KEY AUTOINCREMENT, root_id INTEGER NOT NULL REFERENCES roots(id),
  lemma_buckwalter TEXT NOT NULL, lemma_arabic TEXT, pos TEXT, pos_english TEXT, pos_arabic TEXT,
  pos_class TEXT, occurrence_count INTEGER DEFAULT 0, UNIQUE(root_id, lemma_buckwalter, pos));
CREATE TABLE root_meanings (id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE, source TEXT NOT NULL, language TEXT NOT NULL,
  meaning TEXT NOT NULL, source_ref TEXT, UNIQUE(root_id, source, language));
CREATE TABLE translation_resources (id INTEGER PRIMARY KEY, name TEXT, language_name TEXT, author_name TEXT,
  resource_type TEXT);
CREATE TABLE verse_embeddings (verse_id INTEGER PRIMARY KEY REFERENCES verses(id), model TEXT, embedding BLOB);
CREATE TABLE verse_translations (id INTEGER PRIMARY KEY AUTOINCREMENT, verse_id INTEGER NOT NULL REFERENCES verses(id),
  verse_key TEXT NOT NULL, resource_id INTEGER NOT NULL REFERENCES translation_resources(id), language_name TEXT,
  text TEXT, UNIQUE(verse_id, resource_id));
CREATE TABLE verses (id INTEGER PRIMARY KEY, chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  verse_number INTEGER NOT NULL, verse_key TEXT NOT NULL UNIQUE, verse_index INTEGER, text_uthmani TEXT,
  text_uthmani_simple TEXT, text_imlaei TEXT, text_imlaei_simple TEXT, text_indopak TEXT,
  text_uthmani_tajweed TEXT, code_v1 TEXT, code_v2 TEXT, v1_page INTEGER, v2_page INTEGER, juz_number INTEGER,
  hizb_number INTEGER, rub_el_hizb_number INTEGER, page_number INTEGER, ruku_number INTEGER,
  manzil_number INTEGER, image_url TEXT);
CREATE TABLE word_segments (id INTEGER PRIMARY KEY AUTOINCREMENT, verse_key TEXT NOT NULL,
  word_position INTEGER NOT NULL, segment_number INTEGER NOT NULL, segment_type TEXT NOT NULL,
  form_buckwalter TEXT, form_arabic TEXT, tag TEXT, pos TEXT, pos_arabic TEXT, pos_english TEXT, pos_class TEXT,
  prefix_type TEXT, prefix_arabic TEXT, prefix_english TEXT, lemma_buckwalter TEXT, lemma_arabic TEXT,
  root_buckwalter TEXT, root_arabic TEXT, root_form_id INTEGER REFERENCES root_forms(id), verb_aspect TEXT,
  verb_voice TEXT, verb_mood TEXT, verb_form TEXT, derivation TEXT, noun_state TEXT, noun_case TEXT,
  person TEXT, gender TEXT, number TEXT, raw_features TEXT, UNIQUE(verse_key, word_position, segment_number));
CREATE TABLE words (id INTEGER PRIMARY KEY, verse_id INTEGER REFERENCES verses(id), verse_key TEXT NOT NULL,
  position INTEGER NOT NULL, text_uthmani TEXT, text_imlaei TEXT, text_indopak TEXT, code_v1 TEXT, code_v2 TEXT,
  v1_page INTEGER, v2_page INTEGER, location TEXT, page_number INTEGER, line_number INTEGER, char_type TEXT,
  audio_url TEXT, translation_text TEXT, translation_language TEXT, transliteration_text TEXT,
  transliteration_language TEXT, root_form_id INTEGER REFERENCES root_forms(id), root_buckwalter TEXT,
  root_arabic TEXT, lemma_buckwalter TEXT, lemma_arabic TEXT, pos TEXT, pos_arabic TEXT, pos_english TEXT,
  pos_class TEXT, UNIQUE(verse_key, position));
CREATE VIEW word_occurrences AS
SELECT ws.verse_key, ws.word_position, ws.form_arabic, ws.form_buckwalter, ws.pos, ws.pos_english, ws.pos_class,
  ws.verb_aspect, ws.verb_voice, ws.verb_mood, ws.verb_form, ws.derivation, ws.noun_case, ws.noun_state,
  ws.gender, ws.number, ws.person, r.id AS root_id, r.root_arabic, r.root_buckwalter, r.letters_arabic,
  r.letter_count, rf.id AS root_form_id, rf.lemma_arabic, rf.lemma_buckwalter, v.chapter_id, v.verse_number,
  v.juz_number, v.page_number, v.ruku_number, w.audio_url, w.translation_text, w.code_v1, w.code_v2
FROM word_segments ws
LEFT JOIN root_forms rf ON ws.root_form_id = rf.id
LEFT JOIN roots r ON rf.root_id = r.id
LEFT JOIN verses v ON ws.verse_key = v.verse_key
LEFT JOIN words w ON ws.verse_key = w.verse_key AND ws.word_position = w.position
WHERE ws.segment_type = 'STEM';
`;

export const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ";

function ins(db: DatabaseSync, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...(Object.values(row) as never[]));
}

/** Build a fixture quran.db and return its path. */
export function makeFixture(name: string, opts: { breakChapters?: boolean; dropWords?: boolean } = {}): string {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  db.exec(opts.dropWords ? DDL.replace(/CREATE TABLE words[\s\S]*?\);\n/, "").replace(/CREATE VIEW[\s\S]*$/, "") : DDL);
  ins(db, "_meta", { key: "built_at", value: "2026-06-25T08:40:04" });
  ins(db, "_meta", { key: "data_dir", value: null });
  // SQLite keeps non-numeric text in an INTEGER column; Postgres must refuse it (breakChapters)
  ins(db, "chapters", { id: 1, name_simple: "Al-Fatihah", name_arabic: "الفاتحة", revelation_place: "makkah",
    revelation_order: opts.breakChapters ? "not-a-number" : 5, bismillah_pre: 0, verses_count: 7 });
  ins(db, "juzs", { id: 1, juz_number: 1, verse_mapping: '{"1":"1-7"}', first_verse_id: 1, last_verse_id: 2, verses_count: 2 });
  ins(db, "roots", { id: 1, root_buckwalter: "Hmd", root_arabic: "حمد", letters_arabic: "ح م د", letter_count: 3, meaning_en: "praise" });
  ins(db, "roots", { id: 2, root_buckwalter: "rHm", root_arabic: "رحم", letters_arabic: "ر ح م", letter_count: 3, meaning_en: "mercy" });
  ins(db, "root_forms", { id: 1, root_id: 1, lemma_buckwalter: "Hamod", lemma_arabic: "حَمْد", pos: "N", occurrence_count: 43 });
  ins(db, "root_forms", { id: 2, root_id: 2, lemma_buckwalter: "raHiym", lemma_arabic: "رَحِيم", pos: null, occurrence_count: 115 });
  ins(db, "root_meanings", { id: 1, root_id: 1, source: "lane", language: "en", meaning: "he praised" });
  ins(db, "root_meanings", { id: 2, root_id: 2, source: "lane", language: "en", meaning: "mercy", source_ref: "L-1055" });
  ins(db, "translation_resources", { id: 20, name: "Saheeh International", language_name: "english", resource_type: "translation" });
  ins(db, "translation_resources", { id: 131, name: "Scholarly Edition", language_name: "english", resource_type: "translation" });
  ins(db, "verses", { id: 1, chapter_id: 1, verse_number: 1, verse_key: "1:1", verse_index: 1, text_uthmani: BISMILLAH, text_imlaei: "بسم الله الرحمن الرحيم", juz_number: 1, page_number: 1 });
  ins(db, "verses", { id: 2, chapter_id: 1, verse_number: 2, verse_key: "1:2", verse_index: 2, text_uthmani: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ", juz_number: 1, page_number: 1 });
  ins(db, "verse_embeddings", { verse_id: 1, model: "test", embedding: new Uint8Array([1, 2, 255, 0]) });
  ins(db, "verse_translations", { id: 1, verse_id: 1, verse_key: "1:1", resource_id: 20, language_name: "english", text: "In the name of Allah, the Most Merciful" });
  ins(db, "verse_translations", { id: 2, verse_id: 2, verse_key: "1:2", resource_id: 20, language_name: "english", text: "All praise is due to Allah" });
  ins(db, "verse_translations", { id: 3, verse_id: 1, verse_key: "1:1", resource_id: 131, language_name: "english", text: "In the name of God, the Compassionate, the Merciful" });
  if (!opts.dropWords) {
    ins(db, "words", { id: 1, verse_id: 2, verse_key: "1:2", position: 1, text_uthmani: "ٱلْحَمْدُ", root_form_id: 1,
      root_arabic: "حمد", lemma_arabic: "حَمْد", pos: "N", translation_text: "All praise" });
  }
  ins(db, "word_segments", { id: 1, verse_key: "1:2", word_position: 1, segment_number: 1, segment_type: "PREFIX", form_arabic: "ٱلْ" });
  ins(db, "word_segments", { id: 2, verse_key: "1:2", word_position: 1, segment_number: 2, segment_type: "STEM",
    form_arabic: "حَمْدُ", lemma_arabic: "حَمْد", root_arabic: "حمد", root_form_id: 1, noun_case: "NOM", number: "S" });
  db.close();
  return path;
}

/** A PGlite database and a single-connection runner over it. */
export function pgliteRunner(): { db: PGlite; r: SqlRunner } {
  const db = new PGlite();
  return {
    db,
    r: {
      exec: (sql) => db.exec(sql).then(() => undefined),
      query: async (sql, params = []) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[],
    },
  };
}
