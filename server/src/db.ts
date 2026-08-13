// Thin wrapper over SQLite, mirroring the Python QuranDB helpers (query / one /
// scalar / exec). Two drivers behind ONE api:
//
//   • node:sqlite (default) — Node's built-in, no native build. Used by web dev,
//     the parity tests and CI. Needs Node 22.5+.
//   • better-sqlite3 — a native module, selected with QF_SQLITE_DRIVER=better-sqlite3.
//     The desktop (Electron) build uses this, because Electron bundles its own Node
//     which may predate node:sqlite. Its statement/exec/close API matches ours, so the
//     wrapper is identical; only how the connection is opened differs.
//
// Both are loaded via createRequire so a bundler/test runner that can't statically
// resolve them is never asked to, and the unused driver is never even required.

import type * as SqliteNS from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const USE_BETTER = process.env.QF_SQLITE_DRIVER === "better-sqlite3";

// the subset of the two drivers we actually use — identical across both
interface RawStmt {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint };
}
interface RawDb {
  prepare(sql: string): RawStmt;
  exec(sql: string): void;
  close(): void;
}

function openRaw(path: string, readOnly: boolean): RawDb {
  if (USE_BETTER) {
    const Database = require("better-sqlite3") as new (
      p: string,
      o?: { readonly?: boolean },
    ) => RawDb;
    const db = new Database(path, { readonly: readOnly });
    if (!readOnly) db.exec("PRAGMA journal_mode = WAL"); // match the web db's WAL mode
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  }
  const { DatabaseSync } = require("node:sqlite") as typeof SqliteNS;
  const db = new DatabaseSync(path) as unknown as RawDb;
  if (readOnly) db.exec("PRAGMA query_only = ON");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export class Db {
  readonly raw: RawDb;
  readonly path: string;

  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    this.path = path;
    this.raw = openRaw(path, opts.readOnly ?? false);
  }

  /** SELECT → all rows as plain objects. */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  /** SELECT → first row, or undefined. */
  one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  /** SELECT → first column of the first row, or undefined. */
  scalar<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    const row = this.raw.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return Object.values(row)[0] as T;
  }

  run(sql: string, params: unknown[] = []): { changes: number | bigint } {
    return this.raw.prepare(sql).run(...params);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  close(): void {
    this.raw.close();
  }
}
