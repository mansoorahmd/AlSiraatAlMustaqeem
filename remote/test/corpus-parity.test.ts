// Step 2's contract: the Postgres content port answers EXACTLY like the SQLite original. Runs the
// real server code (server/src/content.ts over the fixture quran.db) and the port
// (src/corpus/content.ts over the same fixture migrated into PGlite), and compares serialized
// JSON — key order included. `npm run corpus:parity` does the same over the whole real corpus.

import { describe, it, expect, beforeAll } from "vitest";
import type { SqlRunner } from "../src/migrate.js";
import { migrateCorpus } from "../src/corpus/load.js";
import { PgQuranContent } from "../src/corpus/content.js";
import { Db } from "../../server/src/db.js";
import { QuranContent } from "../../server/src/content.js";
import { makeFixture, pgliteRunner } from "./fixtures/corpus-fixture.js";

let lite: QuranContent;
let cloud: PgQuranContent;

beforeAll(async () => {
  const r: SqlRunner = pgliteRunner().r;
  const path = makeFixture("parity.db");
  await migrateCorpus({ sqlitePath: path, runner: r });
  lite = new QuranContent(new Db(path, { readOnly: true }));
  cloud = new PgQuranContent(r);
});

/** Both answers, serialized; an error is an answer too (status + message). */
async function both(a: () => unknown, b: () => Promise<unknown>): Promise<[string, string]> {
  const settle = async (f: () => unknown) => {
    try { return JSON.stringify(await f()) ?? "undefined"; } catch (e) {
      const err = e as { status?: number; message?: string };
      return `ERROR ${err.status}: ${err.message}`;
    }
  };
  return [await settle(a), await settle(b)];
}

const CASES: [string, (q: QuranContent) => unknown, (p: PgQuranContent) => Promise<unknown>][] = [
  ["listChapters", (q) => q.listChapters(), (p) => p.listChapters()],
  ["getChapter(1)", (q) => q.getChapter(1), (p) => p.getChapter(1)],
  ["getChapter(99) — missing", (q) => q.getChapter(99), (p) => p.getChapter(99)],
  ["getChapter(1.5) — not an id", (q) => q.getChapter(1.5), (p) => p.getChapter(1.5)],
  ["getVerse(1:1)", (q) => q.getVerse("1:1"), (p) => p.getVerse("1:1")],
  ["getVerse(1:2, words + translations)",
    (q) => q.getVerse("1:2", { withWords: true, withTranslations: true }),
    (p) => p.getVerse("1:2", { withWords: true, withTranslations: true })],
  ["getVerse(1:1, all scripts)", (q) => q.getVerse("1:1", { allScripts: true }), (p) => p.getVerse("1:1", { allScripts: true })],
  ["getVerse(1:1, imlaei)", (q) => q.getVerse("1:1", { script: "imlaei" }), (p) => p.getVerse("1:1", { script: "imlaei" })],
  ["getVerse(9:9) — missing", (q) => q.getVerse("9:9"), (p) => p.getVerse("9:9")],
  ["getVerse(unknown script) — the error text",
    (q) => q.getVerse("1:1", { script: "klingon" }), (p) => p.getVerse("1:1", { script: "klingon" })],
  ["chapterVerses(1, all scripts + words)",
    (q) => q.chapterVerses(1, { allScripts: true, withWords: true }),
    (p) => p.chapterVerses(1, { allScripts: true, withWords: true })],
  ["chapterVerses(1, limit 1 offset 1)",
    (q) => q.chapterVerses(1, { limit: 1, offset: 1 }), (p) => p.chapterVerses(1, { limit: 1, offset: 1 })],
  ["listVerses()", (q) => q.listVerses(), (p) => p.listVerses()],
  ["listVerses(juz 1)", (q) => q.listVerses({ juz: 1 }), (p) => p.listVerses({ juz: 1 })],
  ["listVerses(page 2) — none", (q) => q.listVerses({ page: 2 }), (p) => p.listVerses({ page: 2 })],
  ["verseNeighbours(1:2, r=1)", (q) => q.verseNeighbours("1:2", { radius: 1 }), (p) => p.verseNeighbours("1:2", { radius: 1 })],
  ["verseNeighbours(nope) — missing", (q) => q.verseNeighbours("nope"), (p) => p.verseNeighbours("nope")],
  ["verseWords(1:2) — prefix + stem joined", (q) => q.verseWords("1:2"), (p) => p.verseWords("1:2")],
  ["verseTranslations(1:1)", (q) => q.verseTranslations("1:1"), (p) => p.verseTranslations("1:1")],
  ["listTranslationResources", (q) => q.listTranslationResources(), (p) => p.listTranslationResources()],
];

describe("Postgres answers exactly like SQLite", () => {
  for (const [name, a, b] of CASES) {
    it(name, async () => {
      const [sqlite, pg] = await both(() => a(lite), () => b(cloud));
      expect(pg).toBe(sqlite);
    });
  }

  it("with an allow-everything filter, translations are unchanged", async () => {
    const [sqlite, pg] = await both(() => lite.verseTranslations("1:1"), () => cloud.verseTranslations("1:1", () => true));
    expect(pg).toBe(sqlite);
  });
});
