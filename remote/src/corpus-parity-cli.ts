// Prove the Postgres content port answers EXACTLY like the SQLite original, over the whole corpus.
//
//   npm run corpus:parity
//
// Runs the real server code (server/src/content.ts, QuranContent over quran.db) and the port
// (src/corpus/content.ts, PgQuranContent over the Postgres `corpus` schema) side by side, and
// compares the serialized JSON of every answer — key order included, since that's what the API
// returns. Every chapter, every verse (with words and translations, in every script), neighbours,
// every navigation filter, the error text. Exit code 1 on any difference.
//
// Prerequisite: `npm run corpus:migrate` (the Postgres copy must exist and match quran.db).

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";
import type { SqlRunner } from "./migrate.js";
import { Db } from "../../server/src/db.js";
import { QuranContent } from "../../server/src/content.js";
import { PgQuranContent } from "./corpus/content.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sqlitePath = process.env.QF_QURAN_DB ?? resolve(repo, "quran.db");
if (!existsSync(sqlitePath)) { console.error(`no quran.db at ${sqlitePath}`); process.exit(1); }

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
const runner: SqlRunner = {
  exec: async (sql) => { await pool.query(sql); },
  query: async (sql, params = []) => (await pool.query(sql, params as unknown[])).rows,
};
const lite = new QuranContent(new Db(sqlitePath, { readOnly: true }));
const cloud = new PgQuranContent(runner);

let cases = 0;
const diffs: { name: string; sqlite: string; pg: string }[] = [];

/** Run one question both ways; errors are compared as answers too (status + message). */
async function same(name: string, a: () => unknown, b: () => Promise<unknown>): Promise<void> {
  const settle = async (f: () => unknown) => {
    try { return JSON.stringify(await f()) ?? "undefined"; } catch (e) {
      const err = e as { status?: number; message?: string };
      return `ERROR ${err.status ?? "?"}: ${err.message}`;
    }
  };
  const [x, y] = [await settle(a), await settle(b)];
  cases++;
  if (x !== y) diffs.push({ name, sqlite: x.slice(0, 300), pg: y.slice(0, 300) });
}

const t0 = Date.now();
const keys = (new Db(sqlitePath, { readOnly: true })).query<{ verse_key: string }>(
  "SELECT verse_key FROM verses ORDER BY id").map((r) => r.verse_key);
const step = (label: string) => console.log(`  ${label.padEnd(44)} ${cases.toLocaleString().padStart(7)} checks`);

try {
  console.log(`comparing SQLite (${sqlitePath}) with Postgres (schema "corpus")…`);

  await same("listChapters", () => lite.listChapters(), () => cloud.listChapters());
  for (const id of [0, 115, 1.5, -1]) await same(`getChapter(${id})`, () => lite.getChapter(id), () => cloud.getChapter(id));
  for (let id = 1; id <= 114; id++) await same(`getChapter(${id})`, () => lite.getChapter(id), () => cloud.getChapter(id));
  step("chapters");

  for (let id = 1; id <= 114; id++) {
    await same(`chapterVerses(${id}, all scripts + words)`,
      () => lite.chapterVerses(id, { allScripts: true, withWords: true }),
      () => cloud.chapterVerses(id, { allScripts: true, withWords: true }));
    await same(`chapterVerses(${id}, imlaei, limit 5 offset 2)`,
      () => lite.chapterVerses(id, { script: "imlaei", limit: 5, offset: 2 }),
      () => cloud.chapterVerses(id, { script: "imlaei", limit: 5, offset: 2 }));
  }
  step("chapter verses (every script, every word)");

  for (const k of keys) {
    await same(`getVerse(${k}, words + translations)`,
      () => lite.getVerse(k, { withWords: true, withTranslations: true }),
      () => cloud.getVerse(k, { withWords: true, withTranslations: true }));
  }
  step("every verse with words + translations");

  for (const k of keys.filter((_, i) => i % 25 === 0).concat(["1:1", "114:6", "2:255", "0:0", "nope"])) {
    await same(`verseNeighbours(${k}, r=3)`,
      () => lite.verseNeighbours(k, { radius: 3 }), () => cloud.verseNeighbours(k, { radius: 3 }));
    await same(`getVerse(${k}, all scripts)`,
      () => lite.getVerse(k, { allScripts: true }), () => cloud.getVerse(k, { allScripts: true }));
  }
  step("neighbours + all-scripts sample");

  const nav: Record<string, number[]> = {
    juz: [...Array(30)].map((_, i) => i + 1), manzil: [1, 2, 3, 4, 5, 6, 7],
    hizb: [1, 17, 30, 45, 60], page: [1, 2, 50, 300, 604], ruku: [1, 40, 556, 999999],
    chapter: [1, 2, 18, 114],
  };
  for (const [f, vals] of Object.entries(nav)) {
    for (const v of vals) {
      await same(`listVerses(${f}=${v})`,
        () => lite.listVerses({ [f]: v, limit: 300 }), () => cloud.listVerses({ [f]: v, limit: 300 }));
    }
  }
  await same("listVerses(default)", () => lite.listVerses(), () => cloud.listVerses());
  await same("listVerses(offset 6200)", () => lite.listVerses({ offset: 6200, limit: 300 }), () => cloud.listVerses({ offset: 6200, limit: 300 }));
  step("navigation filters");

  await same("listTranslationResources", () => lite.listTranslationResources(), () => cloud.listTranslationResources());
  await same("unknown script", () => lite.getVerse("1:1", { script: "klingon" }), () => cloud.getVerse("1:1", { script: "klingon" }));
  step("resources + errors");

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (diffs.length === 0) {
    console.log(`\n  ✔ ${cases.toLocaleString()} answers compared in ${secs}s — Postgres answers exactly like SQLite.`);
  } else {
    console.log(`\n  ✘ ${diffs.length} of ${cases.toLocaleString()} answers differ. First few:`);
    for (const d of diffs.slice(0, 5)) console.log(`\n  ${d.name}\n    sqlite: ${d.sqlite}\n    pg:     ${d.pg}`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`corpus:parity: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
