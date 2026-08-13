// Back up research.db without the app running — a clean, complete copy with the WAL
// folded in (SQLite's VACUUM INTO). Safe to run while the app is open.
//
//   npm run backup                 → backups/research-<timestamp>.db next to the db
//   npm run backup -- /path/out.db → to an explicit .db path
//
// Honours QF_RESEARCH_DB (the desktop build keeps research.db in the OS user-data dir);
// otherwise defaults to ./research.db relative to where you run it.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const src = process.env.QF_RESEARCH_DB ?? resolve(process.cwd(), "research.db");
if (!existsSync(src)) {
  console.error(`No research.db at ${src}. Set QF_RESEARCH_DB, or run from the project root.`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp =
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

let dest = process.argv[2] ?? join(dirname(src), "backups", `research-${stamp}.db`);
if (!isAbsolute(dest)) dest = resolve(process.cwd(), dest);
if (!dest.endsWith(".db")) { console.error("destination must end in .db"); process.exit(1); }
if (existsSync(dest)) { console.error(`refusing to overwrite ${dest}`); process.exit(1); }
mkdirSync(dirname(dest), { recursive: true });

const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
console.log(`✔ backed up → ${dest}  (${(statSync(dest).size / 1024).toFixed(0)} KB)`);
