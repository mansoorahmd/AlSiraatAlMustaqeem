// Thin wrapper over node:sqlite (Node's built-in SQLite), mirroring the Python
// QuranDB helpers (query / one / scalar / exec). node:sqlite needs no native
// build — the same code runs in CI, on Windows, and in production unchanged.

// Load node:sqlite via createRequire: it's a very new built-in that some
// bundlers/test runners can't yet resolve as a static import. Requiring it
// dynamically sidesteps that while running identically under tsx and node.
// The `import type` is erased at build time, so it costs nothing at runtime.
import type * as SqliteNS from "node:sqlite";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof SqliteNS;

export class Db {
  readonly raw: SqliteNS.DatabaseSync;

  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    this.raw = new DatabaseSync(path);
    if (opts.readOnly) this.raw.exec("PRAGMA query_only = ON");
    this.raw.exec("PRAGMA foreign_keys = ON");
  }

  /** SELECT → all rows as plain objects. */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.raw.prepare(sql).all(...(params as never[])) as T[];
  }

  /** SELECT → first row, or undefined. */
  one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return this.raw.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  /** SELECT → first column of the first row, or undefined. */
  scalar<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    const row = this.raw.prepare(sql).get(...(params as never[])) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return Object.values(row)[0] as T;
  }

  run(sql: string, params: unknown[] = []): { changes: number | bigint } {
    return this.raw.prepare(sql).run(...(params as never[]));
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  close(): void {
    this.raw.close();
  }
}
