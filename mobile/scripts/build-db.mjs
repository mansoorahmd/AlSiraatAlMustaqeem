// Build the offline mobile corpus from the project's quran.db.
//
//   node scripts/build-db.mjs [path/to/quran.db]
//
// Produces assets/db/quran-mobile.db — the read-only database bundled into the
// Android app.
//
// By default it ships the FULL corpus (every translation/tafsir edition and all
// tables), identical to the server's quran.db, just consolidated into a single
// self-contained file (WAL checkpointed into the main file so there's no
// dependency on -wal/-shm sidecars).
//
// Set TRIM = true to instead produce a smaller build that drops the unused
// full-text-search shadow tables + the empty embeddings table and keeps only
// the translations listed in KEEP_RESOURCES. Everything the Reader / Search /
// Roots features need is preserved either way.
//
// Requires Node 22+ (built-in node:sqlite). No native build.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- configuration ----------------------------------------------------------
const TRIM = false; // false = ship the full corpus (default); true = slim build
const KEEP_RESOURCES = [20, 84, 54, 57]; // only used when TRIM = true
// ----------------------------------------------------------------------------

const SRC = process.argv[2] || path.resolve(ROOT, "..", "quran.db");
const OUT_DIR = path.resolve(ROOT, "assets", "db");
const OUT = path.join(OUT_DIR, "quran-mobile.db");

if (!fs.existsSync(SRC)) {
  console.error(`Source DB not found: ${SRC}\nPass the path: node scripts/build-db.mjs /path/to/quran.db`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const s of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(OUT + s); } catch {}
}

console.log(`Copying ${SRC} → ${OUT}`);
fs.copyFileSync(SRC, OUT);

const db = new DatabaseSync(OUT);
// Consolidate any WAL contents into the main file and drop the WAL journal, so
// the bundled asset is a single standalone file.
db.exec("PRAGMA journal_mode=DELETE");

if (TRIM) {
  const DROP = [
    "translations_fts", "translations_fts_config", "translations_fts_data",
    "translations_fts_docsize", "translations_fts_idx",
    "verses_fts", "verses_fts_config", "verses_fts_data",
    "verses_fts_docsize", "verses_fts_idx",
    "verse_embeddings",
  ];
  for (const t of DROP) {
    try { db.exec(`DROP TABLE IF EXISTS "${t}"`); } catch (e) { console.warn(`  skip ${t}: ${e.message}`); }
  }
  const keep = KEEP_RESOURCES.join(",");
  db.exec(`DELETE FROM verse_translations WHERE resource_id NOT IN (${keep})`);
  db.exec(`DELETE FROM translation_resources WHERE id NOT IN (${keep})`);
  console.log("Vacuuming…");
  db.exec("VACUUM");
}

const mb = (() => {
  const pc = db.prepare("SELECT page_count FROM pragma_page_count()").get().page_count;
  const ps = db.prepare("SELECT page_size FROM pragma_page_size()").get().page_size;
  return (pc * ps) / 1048576;
})();
const resources = db.prepare("SELECT COUNT(*) c FROM translation_resources").get().c;
const vt = db.prepare("SELECT COUNT(*) c FROM verse_translations").get().c;
const wo = db.prepare("SELECT COUNT(*) c FROM word_occurrences").get().c;
db.close();

console.log(`\nDone (${TRIM ? "TRIMMED" : "FULL"}). ${OUT}`);
console.log(`  size: ${mb.toFixed(1)} MB`);
console.log(`  translation editions: ${resources} (${vt} verse rows)`);
console.log(`  word_occurrences view: ${wo} rows`);
