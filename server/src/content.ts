// Quran content & metadata — port of quran_api/content.py.
// Read-only access to chapters, verses (multiple scripts), per-word breakdown,
// translations, neighbours, and verbatim phrase search.
//
// Runs over either corpus engine (corpus-db.ts): SQLite locally, Postgres in the cloud. Translations
// take an optional `allow(resourceId)` predicate, so a caller's plan can leave some out (the cloud
// passes one; locally there is none and nothing is filtered).

import type { CorpusDb, Row } from "./corpus-db.js";
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

export type Allow<K = number> = (key: K) => boolean;

/** Ids that aren't whole int4 numbers can't match a row; answer "nothing" before the engine
 *  sees them (SQLite would just match nothing; Postgres would reject the value). */
const isId = (n: number): boolean => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

export class QuranContent {
  constructor(private db: CorpusDb) {}

  private scriptCol(script: string): string {
    const col = SCRIPTS[script];
    if (!col) {
      throw new HttpError(422, `unknown script '${script}'; choose from ${Object.keys(SCRIPTS).sort().join(", ")}`);
    }
    return col;
  }

  // -- chapters --
  listChapters(): Promise<Row[]> {
    return this.db.query("SELECT * FROM chapters ORDER BY id");
  }
  async getChapter(chapterId: number): Promise<Row | undefined> {
    if (!isId(chapterId)) return undefined;
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

  async getVerse(
    verseKey: string,
    opts: { script?: string; allScripts?: boolean; withWords?: boolean; withTranslations?: boolean; allow?: Allow } = {},
  ): Promise<Row | undefined> {
    const script = opts.script ?? "uthmani";
    this.scriptCol(script);
    const row = await this.db.one("SELECT * FROM verses WHERE verse_key = ?", [verseKey]);
    if (!row) return undefined;
    const d = this.verseDict(row, script, opts.allScripts ?? false);
    if (opts.withWords) d.words = await this.verseWords(verseKey);
    if (opts.withTranslations) d.translations = await this.verseTranslations(verseKey, opts.allow);
    return d;
  }

  async chapterVerses(
    chapterId: number,
    opts: { script?: string; allScripts?: boolean; withWords?: boolean; limit?: number | null; offset?: number } = {},
  ): Promise<Row[]> {
    const script = opts.script ?? "uthmani";
    this.scriptCol(script);
    if (!isId(chapterId)) return [];
    let sql = "SELECT * FROM verses WHERE chapter_id = ? ORDER BY verse_number";
    const params: unknown[] = [chapterId];
    if (opts.limit != null) {
      sql += " LIMIT ? OFFSET ?";
      params.push(opts.limit, opts.offset ?? 0);
    }
    const out: Row[] = [];
    for (const row of await this.db.query(sql, params)) {
      const d = this.verseDict(row, script, opts.allScripts ?? false);
      if (opts.withWords) d.words = await this.verseWords(row.verse_key as string);
      out.push(d);
    }
    return out;
  }

  async listVerses(opts: {
    script?: string; limit?: number; offset?: number;
    chapter?: number; juz?: number; hizb?: number; page?: number; ruku?: number; manzil?: number;
  } = {}): Promise<Row[]> {
    const script = opts.script ?? "uthmani";
    this.scriptCol(script);
    const where: string[] = [];
    const params: unknown[] = [];
    for (const key of ["chapter", "juz", "hizb", "page", "ruku", "manzil"] as const) {
      const val = opts[key];
      if (val != null) {
        if (!isId(val)) return [];
        where.push(`${NAV_FILTERS[key]} = ?`);
        params.push(val);
      }
    }
    let sql = "SELECT * FROM verses";
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY chapter_id, verse_number LIMIT ? OFFSET ?";
    params.push(opts.limit ?? 50, opts.offset ?? 0);
    return (await this.db.query(sql, params)).map((r) => this.verseDict(r, script, false));
  }

  async verseNeighbours(
    verseKey: string,
    opts: { radius?: number; script?: string } = {},
  ): Promise<Row[] | null> {
    const script = opts.script ?? "uthmani";
    const radius = opts.radius ?? 2;
    this.scriptCol(script);
    const target = await this.db.one<{ chapter_id: number; verse_number: number }>(
      "SELECT chapter_id, verse_number FROM verses WHERE verse_key = ?", [verseKey],
    );
    if (!target) return null;
    const { chapter_id: ci, verse_number: vn } = target;
    const before = await this.db.query(
      `SELECT * FROM verses
       WHERE chapter_id < ? OR (chapter_id = ? AND verse_number < ?)
       ORDER BY chapter_id DESC, verse_number DESC LIMIT ?`,
      [ci, ci, vn, radius],
    );
    const center = (await this.db.one("SELECT * FROM verses WHERE verse_key = ?", [verseKey]))!;
    const after = await this.db.query(
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

  async phraseSearch(phrase: string, opts: { script?: string; limit?: number } = {}): Promise<Row[]> {
    const script = opts.script ?? "uthmani";
    const limit = opts.limit ?? 50;
    this.scriptCol(script);
    const skel = (s: string) => foldArabic(s ?? "").replaceAll("ا", "");
    const q = skel(phrase).trim();
    if (!q) return [];
    const out: Row[] = [];
    for (const r of await this.db.query("SELECT * FROM verses ORDER BY chapter_id, verse_number")) {
      if (skel((r.text_imlaei_simple as string) ?? "").includes(q)) {
        out.push(this.verseDict(r, script, false));
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // -- words --
  private async wordArabic(verseKey: string): Promise<Map<number, string>> {
    const rows = await this.db.query<{ word_position: number; form_arabic: string | null }>(
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

  async verseWords(verseKey: string): Promise<Row[]> {
    const arabic = await this.wordArabic(verseKey);
    const rows = await this.db.query<Row>(
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

  // -- translations (a caller's plan may leave some out) --
  async verseTranslations(verseKey: string, allow?: Allow): Promise<Row[]> {
    const rows = await this.db.query(
      `SELECT vt.resource_id, vt.language_name, vt.text,
              tr.name AS resource_name, tr.author_name, tr.resource_type
       FROM verse_translations vt
       LEFT JOIN translation_resources tr ON tr.id = vt.resource_id
       WHERE vt.verse_key = ?
       ORDER BY vt.resource_id`,
      [verseKey],
    );
    return allow ? rows.filter((r) => allow(r.resource_id as number)) : rows;
  }

  async listTranslationResources(allow?: Allow): Promise<Row[]> {
    const rows = await this.db.query(
      `SELECT tr.* FROM translation_resources tr
       WHERE tr.id IN (SELECT DISTINCT resource_id FROM verse_translations)
       ORDER BY tr.id`,
    );
    return allow ? rows.filter((r) => allow(r.id as number)) : rows;
  }
}

// Small typed HTTP error the routes translate into a JSON status response.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
