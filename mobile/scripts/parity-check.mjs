// Parity harness: prove the on-device data layer reproduces the server's
// golden fixtures. Bundles the real src/data + src/text modules with esbuild,
// backs the shared `Db` interface with node:sqlite, and diffs the output
// against server/test/fixtures/*.json.
//
//   node scripts/parity-check.mjs [path/to/quran.db] [path/to/fixtures]
//
// Requires esbuild on the module path (npm i -D esbuild) and Node 22+.

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const esbuild = require("esbuild");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DB = process.argv[2] || path.resolve(ROOT, "..", "quran.db");
const FIX = process.argv[3] || path.resolve(ROOT, "..", "server", "test", "fixtures");

// Bundle the pure modules (db.ts's expo imports are type-only, so nothing
// native is pulled in).
const entry = `
export * as content from ${JSON.stringify(path.join(SRC, "data/content.ts"))};
export * as roots from ${JSON.stringify(path.join(SRC, "data/roots.ts"))};
export { RootLinkages } from ${JSON.stringify(path.join(SRC, "data/linkages.ts"))};
export { EchoIndex } from ${JSON.stringify(path.join(SRC, "data/echoes.ts"))};
export { SimilarityEngine } from ${JSON.stringify(path.join(SRC, "similarity/compose.ts"))};
export { FreeTextSearch } from ${JSON.stringify(path.join(SRC, "similarity/freetext.ts"))};
`;
const out = path.join(os.tmpdir(), `parity-bundle-${Date.now()}.mjs`);
await esbuild.build({
  stdin: { contents: entry, resolveDir: SRC, loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
  logLevel: "error",
});
const mod = await import(pathToFileURL(out).href);

// node:sqlite adapter implementing the same Db interface as expo-sqlite.
const raw = new DatabaseSync(DB);
raw.exec("PRAGMA query_only = ON");
const db = {
  query: (sql, params = []) => raw.prepare(sql).all(...params),
  one: (sql, params = []) => raw.prepare(sql).get(...params) ?? undefined,
  scalar: (sql, params = []) => {
    const r = raw.prepare(sql).get(...params);
    return r ? Object.values(r)[0] : undefined;
  },
  run: (sql, params = []) => raw.prepare(sql).run(...params),
  exec: (sql) => raw.exec(sql),
};

const fx = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), "utf-8"));
let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else {
    fail++;
    console.log(`  ✗ ${name}`);
    const gi = firstDiff(g, w);
    console.log(`      got : …${g.slice(Math.max(0, gi - 40), gi + 60)}…`);
    console.log(`      want: …${w.slice(Math.max(0, gi - 40), gi + 60)}…`);
  }
}
function firstDiff(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }

console.log(`\nDB:       ${DB}`);
console.log(`fixtures: ${FIX}\n`);

// --- content ---
check("chapters list", mod.content.listChapters(db), fx("chapters.json"));
check("single chapter 2", mod.content.getChapter(db, 2), fx("chapter_2.json"));
check("verse 2:143 (+words)", mod.content.getVerse(db, "2:143", { withWords: true }), fx("verse_2_143.json"));
check("verse 1:1 (all scripts)", mod.content.getVerse(db, "1:1", { allScripts: true }), fx("verse_1_1_all.json"));
check("chapter 112 verses (+words)", mod.content.chapterVerses(db, 112, { withWords: true }), fx("chapter_112_verses.json"));
check("neighbours 2:143 r=2", mod.content.verseNeighbours(db, "2:143", { radius: 2 }), fx("neighbours_2_143.json"));
check("words 1:1", mod.content.verseWords(db, "1:1"), fx("words_1_1.json"));
check("translations 1:1", mod.content.verseTranslations(db, "1:1"), fx("translations_1_1.json"));
check(
  "phrase search 'الحمد لله' (keys)",
  mod.content.phraseSearch(db, "الحمد لله").map((v) => v.verse_key),
  fx("phrase_alhamd.json"),
);

// --- roots ---
check("roots top (count, limit 30)", mod.roots.listRoots(db, { orderBy: "count", descending: true, limit: 30 }), fx("roots_top.json"));
for (const r of ["hdy", "Amm", "slm"]) {
  check(`root ${r} detail`, mod.roots.getRoot(db, r), fx(`root_${r}.json`));
  check(`root ${r} forms`, mod.roots.listForms(db, r), fx(`forms_${r}.json`));
  check(`root ${r} occurrences (limit 50)`, mod.roots.rootOccurrences(db, r, { script: "uthmani", limit: 50 }), fx(`occ_${r}.json`));
}

// --- linkages (order can differ on ties; compare as a map, like the server test) ---
for (const r of ["hdy", "Amm", "slm"]) {
  const links = new mod.RootLinkages(db).coOccurringRoots(r, { limit: 40 });
  const want = fx(`linkages_${r}.json`);
  const norm = (arr) => Object.fromEntries(arr.map((l) => [l.root_buckwalter, l]));
  const g = norm(links), w = norm(want);
  const sameKeys = JSON.stringify(Object.keys(g).sort()) === JSON.stringify(Object.keys(w).sort());
  let ok = sameKeys;
  if (ok) for (const k of Object.keys(w)) {
    if (g[k].cooccur !== w[k].cooccur) ok = false;
    if (Math.abs(g[k].score - w[k].score) > 1e-4) ok = false;
    if (Math.abs(g[k].npmi - w[k].npmi) > 1e-4) ok = false;
  }
  if (ok) { pass++; console.log(`  ✓ linkages ${r} (${links.length} roots)`); }
  else { fail++; console.log(`  ✗ linkages ${r}`); }
}

// --- echoes (validated against known repeats, like the server test) ---
const echo = new mod.EchoIndex(db);
function checkTrue(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
{
  const e5513 = echo.echoesForVerse("55:13");
  const refrain = e5513.find((e) => e.occurrences.length >= 10);
  checkTrue("55:13 Ar-Rahman refrain repeats in ≥10 verses", !!refrain);
  checkTrue("refrain length ≥ 3 words", !!refrain && refrain.length >= 3);
  checkTrue("refrain occurrences all in surah 55, not 55:13", !!refrain &&
    refrain.occurrences.every((o) => o.verseKey.startsWith("55:")) &&
    !refrain.occurrences.some((o) => o.verseKey === "55:13"));

  const e11 = echo.echoesForVerse("1:1");
  const all11 = e11.flatMap((e) => e.occurrences.map((o) => o.verseKey));
  checkTrue("1:1 basmala echoes in 27:30", all11.includes("27:30"));

  const ch55 = echo.chapterEchoes(55);
  checkTrue("chapter 55 echo set includes 55:13 and is large", ch55.includes("55:13") && ch55.length > 20);

  checkTrue("2:255 returns an array (no crash)", Array.isArray(echo.echoesForVerse("2:255")));
}

// --- similarity + free-text search (tolerance compare, like the server test) ---
function compareMatches(name, gotAll, wantAll) {
  if (!gotAll.length || !wantAll.length) { checkTrue(name, false); return; }
  const cutoff = Math.max(
    Math.min(...gotAll.map((m) => m.score)),
    Math.min(...wantAll.map((m) => m.score)),
  );
  const got = gotAll.filter((m) => m.score > cutoff);
  const want = wantAll.filter((m) => m.score > cutoff);
  const g = Object.fromEntries(got.map((m) => [m.verse_key, m]));
  const w = Object.fromEntries(want.map((m) => [m.verse_key, m]));
  const close = (a, b) => Math.abs(a - b) <= 1e-4;
  const js = (x) => JSON.stringify(x);
  let ok = js(Object.keys(g).sort()) === js(Object.keys(w).sort());
  if (ok) for (const k of Object.keys(w)) {
    if (!close(g[k].score, w[k].score) || !close(g[k].overlap, w[k].overlap) ||
        !close(g[k].phrase, w[k].phrase) || !close(g[k].morphology, w[k].morphology)) ok = false;
    if (js([...g[k].shared].sort()) !== js([...w[k].shared].sort())) ok = false;
    if (js(g[k].pattern) !== js(w[k].pattern)) ok = false;
    if (js(g[k].phrase_run) !== js(w[k].phrase_run)) ok = false;
  }
  for (let i = 1; i < got.length; i++) if (got[i - 1].score < got[i].score) ok = false;
  checkTrue(`${name} (${got.length} above cutoff)`, ok);
}

const engine = new mod.SimilarityEngine(db);
for (const key of ["2:143", "55:13", "1:1", "112:1"]) {
  compareMatches(`similar ${key}`, engine.similarVerses(key, { topK: 40 }), fx(`similar_${key.replace(":", "_")}.json`));
}
{
  const ftx = new mod.FreeTextSearch(db, engine);
  const cases = fx("search.json");
  for (const { query, result } of cases) {
    const got = ftx.search(query, { topK: 30 });
    checkTrue(`search "${query}" resolved`, JSON.stringify(got.resolved) === JSON.stringify(result.resolved));
    checkTrue(`search "${query}" unresolved`, JSON.stringify(got.unresolved) === JSON.stringify(result.unresolved));
    compareMatches(`search "${query}" matches`, got.matches, result.matches);
  }
}

raw.close();
try { fs.unlinkSync(out); } catch {}
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
