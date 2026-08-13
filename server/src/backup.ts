// One safe backup of research.db — the reader's one irreplaceable file.
//
// SQLite's `VACUUM INTO` writes a single, fully-merged copy of the live database,
// capturing any uncheckpointed WAL content, atomically, even while the app is using
// the connection. So it doubles as the checkpoint: the copy is a complete standalone
// file with no -wal / -shm sidecars. This is why we don't checkpoint-then-copy (which
// races a running app) — VACUUM INTO is the whole job in one statement, on both the
// node:sqlite and better-sqlite3 drivers.

import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { Db } from "./db.js";

export interface BackupResult {
  path: string;
  bytes: number;
  at: number;
}

/**
 * Write a clean, complete copy of `db` to `destPath` (absolute, ending in .db).
 * By default it refuses to clobber an existing file; `overwrite` is for the desktop
 * save-dialog case, where the native dialog has already had the user confirm the
 * replacement. VACUUM INTO needs a fresh target, so an overwrite unlinks first.
 */
export function backupResearch(
  db: Db,
  destPath: string,
  opts: { overwrite?: boolean } = {},
): BackupResult {
  if (!isAbsolute(destPath)) throw new Error("backup destination must be an absolute path");
  if (!destPath.endsWith(".db")) throw new Error("backup destination must end in .db");
  if (existsSync(destPath)) {
    if (!opts.overwrite) throw new Error(`refusing to overwrite an existing file: ${destPath}`);
    unlinkSync(destPath);
  }
  mkdirSync(dirname(destPath), { recursive: true });
  // VACUUM INTO takes a string literal, not a bound parameter — escape single quotes.
  db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  return { path: destPath, bytes: statSync(destPath).size, at: Date.now() };
}

/** `backups/research-YYYYMMDD-HHMMSS.db` next to the research db. */
export function defaultBackupPath(researchDbPath: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ts =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return join(dirname(researchDbPath), "backups", `research-${ts}.db`);
}
