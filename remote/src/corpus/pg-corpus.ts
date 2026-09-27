// The Postgres driver for the shared corpus code (server/src/corpus-db.ts). The corpus modules are
// written once, in portable SQL with `?` placeholders and unqualified table names; this adapts
// them to Postgres so the SAME code answers from the cloud's `corpus` schema:
//
//   • `?` → `$1, $2, …` (outside string literals)
//   • unqualified names resolve to the corpus schema: connections run with
//     search_path = corpus, public (see corpusRunner in db.ts; tests set it on PGlite)
//   • counts come back as numbers: Postgres int8 (COUNT, SUM of integer) arrives as a string
//     from node-pg and a BigInt from PGlite — both are normalised here, matching SQLite
//
// Everything else that could differ between the engines is kept out of the SQL itself (see the
// rules in corpus-db.ts) and proved by `npm run corpus:parity`.

import type { CorpusDb, Row } from "../../../server/src/corpus-db.js";
import type { SqlRunner } from "../migrate.js";

/** Rewrite SQLite-style `?` placeholders as Postgres `$n`, leaving string literals alone. */
export function toPgPlaceholders(sql: string): string {
  let out = "", n = 0, inString = false;
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    out += ch === "?" && !inString ? `$${++n}` : ch;
  }
  return out;
}

const normalise = (row: Row): Row => {
  for (const k of Object.keys(row)) if (typeof row[k] === "bigint") row[k] = Number(row[k]);
  return row;
};

/** The corpus over Postgres. `r` must resolve unqualified names to the corpus schema. */
export function pgCorpus(r: SqlRunner): CorpusDb {
  const query = async <T = Row>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await r.query(toPgPlaceholders(sql), params)).map(normalise) as T[];
  return {
    query,
    one: async <T = Row>(sql: string, params: unknown[] = []) => (await query<T>(sql, params))[0],
    scalar: async <T = unknown>(sql: string, params: unknown[] = []) => {
      const row = (await query(sql, params))[0];
      return row ? (Object.values(row)[0] as T) : undefined;
    },
  };
}
