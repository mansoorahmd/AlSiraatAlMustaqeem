// Quran content & metadata — port of quran_api/content.py.
// Read-only access to chapters, verses (multiple scripts), per-word breakdown,
// translations, neighbours, and verbatim phrase search.

import type { Db } from "./db.js";
import { foldArabic } from "./text/normalize.js";

const NAV_FILTERS: Record<string, string> = {
  chapter: "chapter_id",
  juz: "juz_number",
  hizb: "hizb_number",
  page: "page_number",
  ruku: "ruku_number",
  manzil: "manzil_number",
};

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

export class QuranContent {
  constructor(private db: Db) {}

  private scriptCol(script: string): string {
    const col = SCRIPTS[script];
    if (!col) {
      throw new HttpError(422, `unknown script '${script}'; choose from ${Object.keys(SCRIPTS).sort().join(", ")}`);
    }
    return col;
  }

  // -- chapters --
  listChapters(): Row[] {
    return this.db.query("SELECT * FROM chapters ORDER BY id");
  }
  getChapter(chapterId: number): Row | undefined {
    return this.db.one("SELECT * FROM chapters WHERE id = ?", [chapterId]);
  }

  // -- verses --
  private verseDict(row: Row, script: string, allScripts: boolean): Row {
    const d: Row = {};
    for (const k of VERSE_META) d[k] = row[k];
    if (allScripts) {
      const text: Row = {};
      for (const [name, col] of Object.entries(SCRIPTS)) text[name] = row[col];
      d.text = text;
    } else {
      d.script = script;
      d.text = row[this.scriptCol(script)];
    }
    return d;
  }

  getVerse(
    verseKey: string,
    opts: { script?: string; allScripts?: boolean; withWords?: boolean; withTranslations?: boolean } = {},
  ): Row | undefined {
    const script = opts.script ?? "uthmani";
    this.scriptCol(script);
    const row = this.db.one("SELECT * FROM verses WHERE verse_key = ?", [verseKey]);
    if (!row) return undefined;
    const d = this.verseDict(row, script, opts.allScripts ?? false);
    if (opts.withWords) d.words = this.verseWords(verseKey);
    if (opts.withTranslations) d.translations = this.verseTranslations(verseKey);
    return d;
  }

  chapterVerses(
    chapterId: number,
    opts: { script?: string; allScripts?: boolean; withWords?: boolean; limit?: number | null; offset?: number } = {},
  ): Row[] {
    const script = opts.script ?? "uthmani";
    this.scriptCol(script);
    let sql = "SELECT * FROM verses WHERE chapter_id = ? ORDER BY verse_number";
    const params: unknown[] = [chapterId];
    if (opts.limit != null) {
      sql += " LIMIT ? OFFSET ?";
      params.push(opts.limit, opts.offset ?? 0);
    }
    return this.db.query(sql, params).map((row) => {
      const d = this.verseDict(row, script, opts.allScripts ?? false);
      if (opts.withWords) d.words = this.verseWords(row.verse_key as string);
      return d;
    });
  }

  listVerses(opts: {
    script?: string; limit?: number; offset?: number;
    chapter?: number; juz?: number; hizb?: number; page?: number; ruku?: number; manzil?: number;
  } = {}): Row[] {
    const script = opts.script ?? "uthmani";
    this.scriptCol(script);
    const where: string[] = [];
    const params: unknown[] = [];
    for (const key of ["chapter", "juz", "hizb", "page", "ruku", "manzil"] as const) {
      const val = opts[key];
      if (val != null) {
        where.push(`${NAV_FILTERS[key]} = ?`);
        params.push(val);
      }
    }
    let sql = "SELECT * FROM verses";
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY chapter_id, verse_number LIMIT ? OFFSET ?";
    params.push(opts.limit ?? 50, opts.offset ?? 0);
    return this.db.query(sql, params).map((r) => this.verseDict(r, script, false));
  }

  verseNeighbours(
    verseKey: string,
    opts: { radius?: number; script?: string } = {},
  ): Row[] | null {
    const script = opts.script ?? "uthmani";
    const radius = opts.radius ?? 2;
    this.scriptCol(script);
    const target = this.db.one<{ chapter_id: number; verse_number: number }>(
      "SELECT chapter_id, verse_number FROM verses WHERE verse_key = ?", [verseKey],
    );
    if (!target) return null;
    const { chapter_id: ci, verse_number: vn } = target;
    const before = this.db.query(
      `SELECT * FROM verses
       WHERE chapter_id < ? OR (chapter_id = ? AND verse_number < ?)
       ORDER BY chapter_id DESC, verse_number DESC LIMIT ?`,
      [ci, ci, vn, radius],
    );
    const center = this.db.one("SELECT * FROM verses WHERE verse_key = ?", [verseKey])!;
    const after = this.db.query(
      `SELECT * FROM verses
       WHERE chapter_id > ? OR (chapter_id = ? AND verse_number > ?)
       ORDER BY chapter_id ASC, verse_number ASC LIMIT ?`,
      [ci, ci, vn, radius],
    );
    const ordered = [...before.reverse(), center, ...after];
    return ordered.map((r) => {
      const d = this.verseDict(r, script, false);
      d.focus = r.verse_key === verseKey;
      return d;
    });
  }

  phraseSearch(phrase: string, opts: { script?: string; limit?: number } = {}): Row[] {
    const script = opts.script ?? "uthmani";
    const limit = opts.limit ?? 50;
    this.scriptCol(script);
    const skel = (s: string) => foldArabic(s ?? "").replaceAll("ا", "");
    const q = skel(phrase).trim();
    if (!q) return [];
    const out: Row[] = [];
    for (const r of this.db.query("SELECT * FROM verses ORDER BY chapter_id, verse_number")) {
      if (skel((r.text_imlaei_simple as string) ?? "").includes(q)) {
        out.push(this.verseDict(r, script, false));
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // -- words --
  private wordArabic(verseKey: string): Map<number, string> {
    const rows = this.db.query<{ word_position: number; form_arabic: string | null }>(
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

  verseWords(verseKey: string): Row[] {
    const arabic = this.wordArabic(verseKey);
    const rows = this.db.query<Row>(
      `SELECT position, translation_text, transliteration_text,
              lemma_arabic, root_arabic, root_buckwalter,
              pos_english, pos_class
       FROM words WHERE verse_key = ? ORDER BY position`,
      [verseKey],
    );
    return rows.map((r) => ({
      position: r.position,
      arabic: arabic.get(r.position as number) ?? null,
      gloss: r.translation_text,
      transliteration: r.transliteration_text,
      lemma: r.lemma_arabic,
      root: r.root_arabic,
      root_buckwalter: r.root_buckwalter,
      pos: r.pos_english,
      pos_class: r.pos_class,
    }));
  }

  // -- translations --
  verseTranslations(verseKey: string): Row[] {
    return this.db.query(
      `SELECT vt.resource_id, vt.language_name, vt.text,
              tr.name AS resource_name, tr.author_name, tr.resource_type
       FROM verse_translations vt
       LEFT JOIN translation_resources tr ON tr.id = vt.resource_id
       WHERE vt.verse_key = ?
       ORDER BY vt.resource_id`,
      [verseKey],
    );
  }

  listTranslationResources(): Row[] {
    return this.db.query(
      `SELECT tr.* FROM translation_resources tr
       WHERE tr.id IN (SELECT DISTINCT resource_id FROM verse_translations)
       ORDER BY tr.id`,
    );
  }
}

// Small typed HTTP error the routes translate into a JSON status response.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
