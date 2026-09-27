// M1 — Root explorer. Port of quran_api/roots.py.
//
// Runs over either corpus engine (corpus-db.ts). A root's dictionary meanings take an optional
// `allowSource(source)` predicate, so a caller's plan can leave some dictionaries out.

import type { CorpusDb, Row } from "./corpus-db.js";
import { normalizeRoot } from "./text/normalize.js";
import { SCRIPTS, type Allow } from "./content.js";

const ORDER_BY: Record<string, string> = {
  count: "total_occurrences",
  forms: "form_count",
  letters: "r.letter_count",
  alpha: "r.root_buckwalter",
  arabic: "r.root_arabic",
};

export class RootExplorer {
  constructor(private db: CorpusDb) {}

  private rootId(root: string): Promise<number | undefined> {
    return this.db.scalar<number>("SELECT id FROM roots WHERE root_buckwalter = ?", [normalizeRoot(root)]);
  }

  async listRoots(opts: { orderBy?: string; descending?: boolean; limit?: number | null; offset?: number } = {}): Promise<Row[]> {
    const orderBy = opts.orderBy ?? "count";
    if (!(orderBy in ORDER_BY)) throw new Error(`bad order_by ${orderBy}`);
    const desc = opts.descending ?? true;
    // NULLs sort where SQLite puts them (first ascending, last descending) on both engines
    const orderExpr = `${ORDER_BY[orderBy]} ${desc ? "DESC NULLS LAST" : "ASC NULLS FIRST"}, r.root_buckwalter ASC`;
    let sql = `
      SELECT r.root_buckwalter, r.root_arabic, r.letters_arabic,
             r.letter_count, r.meaning_en,
             COALESCE(SUM(rf.occurrence_count), 0) AS total_occurrences,
             COUNT(rf.id)                          AS form_count
      FROM roots r
      LEFT JOIN root_forms rf ON rf.root_id = r.id
      GROUP BY r.id
      ORDER BY ${orderExpr}`;
    const params: unknown[] = [];
    if (opts.limit != null) {
      sql += "\n      LIMIT ? OFFSET ?";
      params.push(opts.limit, opts.offset ?? 0);
    }
    return (await this.db.query<Row>(sql, params)).map((row) => ({
      root_buckwalter: row.root_buckwalter,
      root_arabic: row.root_arabic,
      letters_arabic: row.letters_arabic,
      letter_count: row.letter_count,
      meaning_en: row.meaning_en,
      total_occurrences: row.total_occurrences,
      form_count: row.form_count,
    }));
  }

  async listForms(root: string): Promise<Row[]> {
    const rid = await this.rootId(root);
    if (rid == null) return [];
    return (await this.db.query<Row>(
      `SELECT lemma_buckwalter, lemma_arabic, pos, pos_english,
              pos_arabic, pos_class, occurrence_count
       FROM root_forms WHERE root_id = ?
       ORDER BY occurrence_count DESC NULLS LAST, lemma_buckwalter ASC, id ASC`,
      [rid],
    )).map((r) => ({
      lemma_buckwalter: r.lemma_buckwalter,
      lemma_arabic: r.lemma_arabic,
      pos: r.pos,
      pos_english: r.pos_english,
      pos_arabic: r.pos_arabic,
      pos_class: r.pos_class,
      occurrence_count: r.occurrence_count,
    }));
  }

  async getRoot(root: string, allowSource?: Allow<string>): Promise<Row | null> {
    const rid = await this.rootId(root);
    if (rid == null) return null;
    const info = (await this.db.one<Row>(
      `SELECT root_buckwalter, root_arabic, letters_arabic, letter_count,
              meaning_en, meaning_ar
       FROM roots WHERE id = ?`,
      [rid],
    ))!;
    const forms = await this.listForms(root);
    const total = forms.reduce((s, f) => s + (f.occurrence_count as number), 0);
    const meanings = (await this.db.query<Row>(
      `SELECT source, language, meaning, source_ref
       FROM root_meanings WHERE root_id = ?
       ORDER BY language, source`,
      [rid],
    ))
      .filter((r) => !allowSource || allowSource(r.source as string))
      .map((r) => ({ source: r.source, language: r.language, meaning: r.meaning, source_ref: r.source_ref }));
    return {
      root_buckwalter: info.root_buckwalter,
      root_arabic: info.root_arabic,
      letters_arabic: info.letters_arabic,
      letter_count: info.letter_count,
      meaning_en: info.meaning_en,
      meaning_ar: info.meaning_ar,
      total_occurrences: total,
      forms,
      meanings,
    };
  }

  async occurrences(root: string, opts: { script?: string; limit?: number | null; offset?: number } = {}): Promise<Row[]> {
    const col = SCRIPTS[opts.script ?? "uthmani"] ?? "text_uthmani";
    let sql = `
      SELECT wo.verse_key, wo.word_position, wo.form_arabic,
             wo.form_buckwalter, wo.pos_english, wo.lemma_arabic,
             wo.chapter_id, wo.verse_number, wo.translation_text,
             v.${col} AS verse_text
      FROM word_occurrences wo
      LEFT JOIN verses v ON v.verse_key = wo.verse_key
      WHERE wo.root_buckwalter = ?
      ORDER BY wo.chapter_id, wo.verse_number, wo.word_position, wo.root_form_id`;
    const params: unknown[] = [normalizeRoot(root)];
    if (opts.limit != null) {
      sql += " LIMIT ? OFFSET ?";
      params.push(opts.limit, opts.offset ?? 0);
    }
    return this.db.query<Row>(sql, params);
  }
}
