// Moving research between a research.db FILE and an account's research (either direction), over
// the ResearchDb interface — so one routine serves both:
//
//   import   a file → the account      MERGE: adds what isn't there yet; never overwrites or
//                                      deletes anything already in the account
//   export   the account → a new file  a complete copy, openable in any SQLite tool and
//                                      re-importable
//
// Rows are copied table by table in portable SQL (`ON CONFLICT DO NOTHING`), keeping ids, so
// importing the same file twice adds nothing the second time. The account's own owner record is
// never replaced by a file's.

import type { ResearchDb, Row } from "./research-db.js";

/** Research tables, parents before children. */
export const RESEARCH_TABLES = [
  "cases", "form_research", "form_revisions", "trails", "notes", "user_root_meanings",
  "motifs", "motif_roots", "word_indications", "compare_sets", "compare_items", "settings",
  "derived_submissions", "derived_proposed_claims",
] as const;

export type TransferReport = Record<string, { copied: number; alreadyThere: number }>;

async function columnsOf(db: ResearchDb, table: string): Promise<Set<string>> {
  const rows = db.dialect === "sqlite"
    ? await db.query<{ name: string }>(`PRAGMA table_info(${table})`)
    : await db.query<{ name: string }>(
      "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?",
      [table]);
  return new Set(rows.map((r) => r.name));
}

/**
 * Copy every research row from `from` into `to`, keeping whatever `to` already has.
 * `skipSettings` are setting keys that belong to the target (its own local_id).
 */
export async function copyResearch(from: ResearchDb, to: ResearchDb, opts: { skipSettings?: string[] } = {}): Promise<TransferReport> {
  const report: TransferReport = {};
  for (const table of RESEARCH_TABLES) {
    const have = await columnsOf(from, table);
    if (!have.size) continue;                       // an old file without this table
    const want = await columnsOf(to, table);
    const rows = await from.query<Row>(`SELECT * FROM ${table}`);
    let copied = 0;
    for (const row of rows) {
      if (table === "settings" && opts.skipSettings?.includes(String(row.key))) continue;
      // identity columns are the target's to assign; the natural key decides duplicates
      const cols = Object.keys(row).filter((k) => want.has(k) && !(table === "form_revisions" && k === "id"));
      const vals = cols.map((k) => row[k]);
      const list = cols.join(", "), marks = cols.map(() => "?").join(", ");
      let sql: string, params = vals;
      if (table === "form_revisions") {
        sql = `INSERT INTO form_revisions (${list}) SELECT ${marks}
               WHERE NOT EXISTS (SELECT 1 FROM form_revisions WHERE case_id = ? AND lemma = ? AND meaning = ? AND replaced_at = ?)`;
        params = [...vals, row.case_id, row.lemma, row.meaning, row.replaced_at];
      } else if (table === "form_research") {
        // a form's research belongs to a case; never import one whose case isn't there
        sql = `INSERT INTO form_research (${list}) SELECT ${marks}
               WHERE EXISTS (SELECT 1 FROM cases WHERE id = ?) ON CONFLICT DO NOTHING`;
        params = [...vals, row.case_id];
      } else {
        sql = `INSERT INTO ${table} (${list}) VALUES (${marks}) ON CONFLICT DO NOTHING`;
      }
      copied += (await to.run(sql, params)).changes;
    }
    report[table] = { copied, alreadyThere: rows.length - copied };
  }
  return report;
}

/** Before opening an uploaded file: it's data, so strip anything that could run (triggers). */
export async function defuseSqlite(db: ResearchDb): Promise<void> {
  for (const t of await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'")) {
    await db.exec(`DROP TRIGGER IF EXISTS "${t.name.replace(/"/g, '""')}"`);
  }
}
