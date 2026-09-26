// Qur'an content & metadata from the Postgres corpus — step 2's first piece. An async twin of
// server/src/content.ts (QuranContent), kept line-for-line so the two return IDENTICAL JSON for
// the same request; test/corpus-parity.test.ts and `npm run corpus:parity` hold it to that.
//
// Differences from the SQLite original, all mechanical:
//   • async (pg), `$n` placeholders, tables qualified with the `corpus` schema
//   • ids that aren't whole numbers return "not found" instead of reaching Postgres (SQLite would
//     just match nothing; Postgres would reject the value) — same answer to the caller
//   • translations pass through an optional `allow(resourceId)` predicate, so a translation the
//     caller's plan doesn't reach is left out (see corpus-access.ts). With no predicate, or no
//     locked translations, the output is exactly the SQLite output.
//
// Not here yet: phrase search (needs its own Arabic-search decision — see CORPUS.md step 2).

import type { SqlRunner } from "../migrate.js";
import { SCHEMA } from "./schema.js";

const S = SCHEMA;

/** Mirrors server/src/content.ts SCRIPTS — drift is caught by the parity test. */
export const SCRIPTS: Record<string, string> = {
  uthmani: "text_uthmani",
  uthmani_simple: "text_uthmani_simple",
  imlaei: "text_imlaei",
  imlaei_simple: "text_imlaei_simple",
  indopak: "text_indopak",
  tajweed: "text_uthmani_tajweed",
};

const NAV_FILTERS: Record<string, string> = {
  chapter: "chapter_id", juz: "juz_number", hizb: "hizb_number",
  page: "page_number", ruku: "ruku_number", manzil: "manzil_number",
};

const VERSE_META = [
  "verse_key", "chapter_id", "verse_number", "verse_index",
  "juz_number", "hizb_number", "rub_el_hizb_number",
  "page_number", "ruku_number", "manzil_number",
];

type Row = Record<string, unknown>;
export type Allow = (resourceId: number) => boolean;

/** Same shape and message as the server's HttpError, so the route answers identically. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const isId = (n: number): boolean => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647;

export class PgQuranContent {
  constructor(private r: SqlRunner) {}

  private scriptCol(script: string): string {
    const col = SCRIPTS[script];
    if (!col) {
      throw new HttpError(422, `unknown script '${script}'; choose from ${Object.keys(SCRIPTS).sort().join(", ")}`);
    }
    return col;
  }

  private async one(sql: string, params: unknown[] = []): Promise<Row | undefined> {
    return (await this.r.query(sql, params))[0];
  }

  // -- chapters --
  listChapters(): Promise<Row[]> {
    return this.r.query(`SELECT * FROM ${S}.chapters ORDER BY id`);
  }
  async getChapter(chapterId: number): Promise<Row | undefined> {
    if (!isId(chapterId)) return undefined;
    return this.one(`SELECT * FROM ${S}.chapters WHERE id = $1`, [chapterId]);
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
    const row = await this.one(`SELECT * FROM ${S}.verses WHERE verse_key = $1`, [verseKey]);
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
    let sql = `SELECT * FROM ${S}.verses WHERE chapter_id = $1 ORDER BY verse_number`;
    const params: unknown[] = [chapterId];
    if (opts.limit != null) {
      sql += " LIMIT $2 OFFSET $3";
      params.push(opts.limit, opts.offset ?? 0);
    }
    const out: Row[] = [];
    for (const row of await this.r.query(sql, params)) {
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
        if (!isId(val)) return [];          // SQLite would match nothing; say the same
        params.push(val);
        where.push(`${NAV_FILTERS[key]} = $${params.length}`);
      }
    }
    let sql = `SELECT * FROM ${S}.verses`;
    if (where.length) sql += " WHERE " + where.join(" AND ");
    params.push(opts.limit ?? 50, opts.offset ?? 0);
    sql += ` ORDER BY chapter_id, verse_number LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return (await this.r.query(sql, params)).map((r) => this.verseDict(r, script, false));
  }

  async verseNeighbours(
    verseKey: string,
    opts: { radius?: number; script?: string } = {},
  ): Promise<Row[] | null> {
    const script = opts.script ?? "uthmani";
    const radius = opts.radius ?? 2;
    this.scriptCol(script);
    const target = await this.one(
      `SELECT chapter_id, verse_number FROM ${S}.verses WHERE verse_key = $1`, [verseKey]);
    if (!target) return null;
    const ci = target.chapter_id as number, vn = target.verse_number as number;
    const before = await this.r.query(
      `SELECT * FROM ${S}.verses
       WHERE chapter_id < $1 OR (chapter_id = $1 AND verse_number < $2)
       ORDER BY chapter_id DESC, verse_number DESC LIMIT $3`,
      [ci, vn, radius]);
    const center = (await this.one(`SELECT * FROM ${S}.verses WHERE verse_key = $1`, [verseKey]))!;
    const after = await this.r.query(
      `SELECT * FROM ${S}.verses
       WHERE chapter_id > $1 OR (chapter_id = $1 AND verse_number > $2)
       ORDER BY chapter_id ASC, verse_number ASC LIMIT $3`,
      [ci, vn, radius]);
    const ordered = [...before.reverse(), center, ...after];
    return ordered.map((r) => {
      const d = this.verseDict(r, script, false);
      d.focus = r.verse_key === verseKey;
      return d;
    });
  }

  // -- words --
  private async wordArabic(verseKey: string): Promise<Map<number, string>> {
    const rows = await this.r.query(
      `SELECT word_position, form_arabic FROM ${S}.word_segments
       WHERE verse_key = $1 ORDER BY word_position, segment_number`,
      [verseKey]);
    const out = new Map<number, string>();
    for (const r of rows) {
      const pos = r.word_position as number, form = r.form_arabic as string | null;
      if (form) out.set(pos, (out.get(pos) ?? "") + form);
    }
    return out;
  }

  async verseWords(verseKey: string): Promise<Row[]> {
    const arabic = await this.wordArabic(verseKey);
    const rows = await this.r.query(
      `SELECT "position", translation_text, transliteration_text,
              lemma_arabic, root_arabic, root_buckwalter,
              pos_english, pos_class
       FROM ${S}.words WHERE verse_key = $1 ORDER BY "position"`,
      [verseKey]);
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

  // -- translations (entitlement-filtered) --
  async verseTranslations(verseKey: string, allow?: Allow): Promise<Row[]> {
    const rows = await this.r.query(
      `SELECT vt.resource_id, vt.language_name, vt."text",
              tr.name AS resource_name, tr.author_name, tr.resource_type
       FROM ${S}.verse_translations vt
       LEFT JOIN ${S}.translation_resources tr ON tr.id = vt.resource_id
       WHERE vt.verse_key = $1
       ORDER BY vt.resource_id`,
      [verseKey]);
    return allow ? rows.filter((r) => allow(r.resource_id as number)) : rows;
  }

  async listTranslationResources(allow?: Allow): Promise<Row[]> {
    const rows = await this.r.query(
      `SELECT tr.* FROM ${S}.translation_resources tr
       WHERE tr.id IN (SELECT DISTINCT resource_id FROM ${S}.verse_translations)
       ORDER BY tr.id`);
    return allow ? rows.filter((r) => allow(r.id as number)) : rows;
  }
}
