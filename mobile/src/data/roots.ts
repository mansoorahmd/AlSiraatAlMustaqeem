// Root explorer — on-device port of server/src/roots.ts. Same SQL as the server.

import type { Db } from "./db";
import type { RootDetail, RootForm, RootOccurrence, RootSummary, Script } from "../types";
import { normalizeRoot } from "../text/normalize";
import { SCRIPTS } from "./content";

const ORDER_BY: Record<string, string> = {
  count: "total_occurrences",
  forms: "form_count",
  letters: "r.letter_count",
  alpha: "r.root_buckwalter",
  arabic: "r.root_arabic",
};

type Row = Record<string, unknown>;

function rootId(db: Db, root: string): number | undefined {
  return db.scalar<number>("SELECT id FROM roots WHERE root_buckwalter = ?", [normalizeRoot(root)]);
}

export function listRoots(
  db: Db,
  opts: { orderBy?: string; descending?: boolean; limit?: number | null; offset?: number } = {},
): RootSummary[] {
  const orderBy = opts.orderBy ?? "count";
  if (!(orderBy in ORDER_BY)) throw new Error(`bad order_by ${orderBy}`);
  const direction = (opts.descending ?? true) ? "DESC" : "ASC";
  const orderExpr = `${ORDER_BY[orderBy]} ${direction}, r.root_buckwalter ASC`;
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
    sql += "\n    LIMIT ? OFFSET ?";
    params.push(opts.limit, opts.offset ?? 0);
  }
  return db.query<Row>(sql, params).map((row) => ({
    root_buckwalter: row.root_buckwalter as string,
    root_arabic: row.root_arabic as string,
    letters_arabic: (row.letters_arabic as string) ?? null,
    letter_count: (row.letter_count as number) ?? null,
    meaning_en: (row.meaning_en as string) ?? null,
    total_occurrences: row.total_occurrences as number,
    form_count: row.form_count as number,
  }));
}

export function listForms(db: Db, root: string): RootForm[] {
  const rid = rootId(db, root);
  if (rid == null) return [];
  return db.query<Row>(
    `SELECT lemma_buckwalter, lemma_arabic, pos, pos_english,
            pos_arabic, pos_class, occurrence_count
     FROM root_forms WHERE root_id = ?
     ORDER BY occurrence_count DESC, lemma_buckwalter ASC`,
    [rid],
  ).map((r) => ({
    lemma_buckwalter: r.lemma_buckwalter as string,
    lemma_arabic: (r.lemma_arabic as string) ?? null,
    pos: (r.pos as string) ?? null,
    pos_english: (r.pos_english as string) ?? null,
    pos_arabic: (r.pos_arabic as string) ?? null,
    pos_class: (r.pos_class as string) ?? null,
    occurrence_count: r.occurrence_count as number,
  }));
}

export function getRoot(db: Db, root: string): RootDetail | null {
  const rid = rootId(db, root);
  if (rid == null) return null;
  const info = db.one<Row>(
    `SELECT root_buckwalter, root_arabic, letters_arabic, letter_count,
            meaning_en, meaning_ar
     FROM roots WHERE id = ?`,
    [rid],
  )!;
  const forms = listForms(db, root);
  const total = forms.reduce((s, f) => s + f.occurrence_count, 0);
  const meanings = db.query<Row>(
    `SELECT source, language, meaning, source_ref
     FROM root_meanings WHERE root_id = ?
     ORDER BY language, source`,
    [rid],
  ).map((r) => ({
    source: r.source as string,
    language: r.language as string,
    meaning: r.meaning as string,
    source_ref: (r.source_ref as string) ?? null,
  }));
  return {
    root_buckwalter: info.root_buckwalter as string,
    root_arabic: info.root_arabic as string,
    letters_arabic: (info.letters_arabic as string) ?? null,
    letter_count: (info.letter_count as number) ?? null,
    meaning_en: (info.meaning_en as string) ?? null,
    meaning_ar: (info.meaning_ar as string) ?? null,
    total_occurrences: total,
    forms,
    meanings,
  };
}

/** Āyāt in which a specific form (lemma) occurs — one row per verse. */
export function formOccurrences(
  db: Db,
  lemmaBuckwalter: string,
  script: Script = "uthmani",
  limit = 1000,
): { verse_key: string; word_position: number; verse_text: string | null }[] {
  const col = SCRIPTS[script] ?? "text_uthmani";
  return db.query(
    `SELECT ws.verse_key AS verse_key, MIN(ws.word_position) AS word_position, v.${col} AS verse_text
     FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
     WHERE ws.lemma_buckwalter = ? AND ws.segment_type = 'STEM'
     GROUP BY ws.verse_key
     ORDER BY v.chapter_id, v.verse_number
     LIMIT ?`,
    [lemmaBuckwalter, limit],
  );
}

/** root_arabic → total occurrences in the Book (for rare-root marks). */
export function rootFrequencies(db: Db): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of db.query<{ root_arabic: string; n: number }>(
    `SELECT root_arabic, COUNT(*) AS n FROM word_occurrences
     WHERE root_arabic IS NOT NULL GROUP BY root_arabic`,
  )) m.set(r.root_arabic, r.n);
  return m;
}

export function rootOccurrences(
  db: Db,
  root: string,
  opts: { script?: Script; limit?: number | null; offset?: number } = {},
): RootOccurrence[] {
  const col = SCRIPTS[opts.script ?? "uthmani"] ?? "text_uthmani";
  let sql = `
    SELECT wo.verse_key, wo.word_position, wo.form_arabic,
           wo.form_buckwalter, wo.pos_english, wo.lemma_arabic,
           wo.chapter_id, wo.verse_number, wo.translation_text,
           v.${col} AS verse_text
    FROM word_occurrences wo
    LEFT JOIN verses v ON v.verse_key = wo.verse_key
    WHERE wo.root_buckwalter = ?
    ORDER BY wo.chapter_id, wo.verse_number, wo.word_position`;
  const params: unknown[] = [normalizeRoot(root)];
  if (opts.limit != null) {
    sql += " LIMIT ? OFFSET ?";
    params.push(opts.limit, opts.offset ?? 0);
  }
  return db.query<RootOccurrence>(sql, params);
}
