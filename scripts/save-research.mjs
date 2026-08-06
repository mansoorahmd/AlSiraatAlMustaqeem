// Save your research to git.
//
// SQLite runs research.db in WAL mode, so recent work often lives in the
// transient research.db-wal sidecar (which is gitignored) rather than in
// research.db itself. Committing without checkpointing would archive a
// database that is missing your latest senses, notes and cases.
//
// This checkpoints the WAL into research.db and commits it. The server can stay
// running: a checkpoint is just another connection, and TRUNCATE folds the WAL
// back into the main file.
//
//   npm run save                 → checkpoint + commit (default message)
//   npm run save -- "message"    → checkpoint + commit with your own message

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.QF_RESEARCH_DB
  ? resolve(process.env.QF_RESEARCH_DB)
  : resolve(repo, "research.db");

const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

if (!existsSync(dbPath)) {
  console.error(`✕ No research database at ${dbPath}`);
  process.exit(1);
}

// 1. fold the WAL back into research.db so the file on disk is complete
const walPath = `${dbPath}-wal`;
const walBefore = existsSync(walPath) ? statSync(walPath).size : 0;
let db;
try {
  db = new DatabaseSync(dbPath);
  const [row] = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
  // busy = 1 means another connection held it; the data is safe either way
  if (row && Number(row.busy) === 1) {
    console.warn("⚠ Checkpoint was blocked by an active connection — some of the");
    console.warn("  newest work may still sit in the WAL. Close the app and retry.");
  }
} catch (err) {
  console.error(`✕ Could not checkpoint: ${err.message}`);
  process.exit(1);
} finally {
  db?.close();
}
if (walBefore > 0) console.log(`✓ Checkpointed ${mb(walBefore)} of pending work into research.db`);

// 2. commit it, but only if it actually changed
git("add", "--", dbPath);
const staged = git("diff", "--cached", "--name-only");
if (!staged) {
  console.log("· research.db is unchanged since the last save — nothing to commit.");
  process.exit(0);
}

const message = process.argv.slice(2).join(" ").trim()
  || `Research snapshot: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
git("commit", "-m", message);
console.log(`✓ Committed: ${message}`);
console.log(`  ${git("log", "-1", "--format=%h  %s")}   (${mb(statSync(dbPath).size)})`);
console.log("  Push when ready:  git push");
