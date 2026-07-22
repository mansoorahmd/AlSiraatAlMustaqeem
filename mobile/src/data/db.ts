// On-device SQLite access.
//
// The pure query modules (content, roots, linkages, search) depend only on the
// small `Db` interface below — exactly like the server's modules depend on its
// `Db` adapter. On the phone that interface is backed by expo-sqlite; in the
// Node parity harness it's backed by node:sqlite. Same SQL, same transforms,
// same results.
//
// The read-only corpus is bundled as an asset and copied into place by
// expo-sqlite's own <SQLiteProvider assetSource=…> (see state/DbContext.tsx),
// which uses the native importer so the file lands exactly where
// openDatabaseAsync looks for it.

import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  scalar<T = unknown>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): { changes: number | bigint };
  exec(sql: string): void;
}

/** Name of the bundled corpus on the device. Bump the suffix whenever
 *  scripts/build-db.mjs regenerates a materially different corpus so a fresh
 *  copy replaces the old one. */
export const QURAN_DB_NAME = "quran-mobile-v2.db";

/** Adapts an expo-sqlite database to the shared `Db` interface. */
export class ExpoDb implements Db {
  constructor(private raw: SQLiteDatabase) {}
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.raw.getAllSync(sql, params as never[]) as T[];
  }
  one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return (this.raw.getFirstSync(sql, params as never[]) as T | null) ?? undefined;
  }
  scalar<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    const row = this.raw.getFirstSync(sql, params as never[]) as Record<string, unknown> | null;
    if (!row) return undefined;
    return Object.values(row)[0] as T;
  }
  run(sql: string, params: unknown[] = []): { changes: number | bigint } {
    const r = this.raw.runSync(sql, params as never[]);
    return { changes: r.changes };
  }
  exec(sql: string): void {
    this.raw.execSync(sql);
  }
}

/** Writable research DB (the reader's own notes & meanings). Created on first use. */
let researchDb: Db | null = null;
export function openResearchDb(): Db {
  if (researchDb) return researchDb;
  const raw = openDatabaseSync("research.db");
  const db = new ExpoDb(raw);
  db.exec(RESEARCH_SCHEMA);
  researchDb = db;
  return db;
}

const RESEARCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'note',       -- 'note' | 'question'
  verse_key TEXT,
  word_position INTEGER,
  lemma TEXT,
  root TEXT,
  text TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_verse ON notes(verse_key);
CREATE INDEX IF NOT EXISTS idx_notes_root ON notes(root);

CREATE TABLE IF NOT EXISTS user_root_meanings (
  root_buckwalter TEXT PRIMARY KEY,
  meaning TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  root_buckwalter TEXT,
  root_arabic TEXT,
  hops TEXT NOT NULL,           -- JSON: [{ verseKey, wordPosition }]
  pos INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
