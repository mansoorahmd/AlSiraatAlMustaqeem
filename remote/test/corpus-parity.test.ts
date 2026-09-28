// Step 2's contract: the cloud corpus answers EXACTLY like the local one. One corpus codebase,
// two drivers — so this mounts the IDENTICAL app (the shared server routes, via corpusApp) over
// SQLite (the fixture quran.db) and over Postgres (the same fixture migrated into PGlite), sends
// both the same requests, and compares status and body byte for byte. `npm run corpus:parity`
// does the same over the whole real corpus.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import type { SqlRunner } from "../src/migrate.js";
import { migrateCorpus } from "../src/corpus/load.js";
import { pgCorpus } from "../src/corpus/pg-corpus.js";
import { corpusApp } from "../src/corpus/serve.js";
import { Db } from "../../corpus-core/src/db.js";
import { sqliteCorpus } from "../../corpus-core/src/corpus-db.js";
import { createCorpusServices } from "../../corpus-core/src/corpus-services.js";
import { makeFixture, pgliteRunner } from "./fixtures/corpus-fixture.js";

let lite: Hono;
let cloud: Hono;

beforeAll(async () => {
  const r: SqlRunner = pgliteRunner().r;
  const path = makeFixture("parity.db");
  await migrateCorpus({ sqlitePath: path, runner: r });
  await r.exec("SET search_path TO corpus, public");
  lite = corpusApp(createCorpusServices(sqliteCorpus(new Db(path, { readOnly: true })))) as unknown as Hono;
  cloud = corpusApp(createCorpusServices(pgCorpus(r))) as unknown as Hono;
});

const GET = [
  "/scripts", "/chapters", "/chapters/1", "/chapters/99", "/chapters/abc",
  "/chapters/1/verses?all_scripts=1&words=1", "/chapters/1/verses?limit=1&offset=1",
  "/verses", "/verses?juz=1", "/verses?page=2", "/verses?ruku=999999",
  "/verses/1:1", "/verses/1:1?all_scripts=1", "/verses/1:1?script=imlaei",
  "/verses/1:2?words=1&translations=1", "/verses/1:1?script=klingon", "/verses/9:9",
  "/verses/1:2/neighbours?radius=1", "/verses/nope/neighbours",
  "/verses/1:2/words", "/verses/1:1/translations", "/translation-resources",
  `/phrase-search?q=${encodeURIComponent("الحمد")}`, "/phrase-search",
  `/words/occurrences?surface=${encodeURIComponent("ٱلْحَمْدُ")}`,
  `/words/occurrences?surface=${encodeURIComponent("ٱلْحَمْدُ")}&full=1`,
  "/chapters/1/variants", "/verses/1:2/wazn?pos=1", "/verses/1:2/wazn", "/verses/1:2/spelling?pos=1",
  "/chapters/1/echoes", "/verses/1:1/echoes",
  "/roots", "/roots?order_by=alpha&descending=false", "/roots?order_by=letters", "/roots?order_by=nope",
  "/roots/Hmd", "/roots/حمد", "/roots/Hmd/forms", "/roots/Hmd/occurrences", "/roots/Hmd/with/rHm",
  "/roots/Hmd/linkages", "/roots/Hmd/linkages?scope=adjacent&min_count=1", "/roots/nope",
  "/verses/1:2/similar", "/verses/9:9/similar", "/corpus/version",
];
const POST: [string, unknown][] = [
  ["/search", { text: "الحمد لله" }],
  ["/expression-search", { terms: [{ surface: "الحمد", root: "Hmd" }], mode: "roots" }],
  ["/expression-search", { terms: [{ surface: "الحمد" }], mode: "verbatim" }],
];

async function both(path: string, init?: RequestInit): Promise<[string, string]> {
  const ask = async (app: Hono) => {
    const res = await app.request(path, init);
    return `${res.status} ${await res.text()}`;
  };
  return [await ask(lite), await ask(cloud)];
}

describe("the cloud corpus answers exactly like the local one", () => {
  for (const path of GET) {
    it(`GET ${path}`, async () => {
      const [sqlite, pg] = await both(path);
      expect(pg).toBe(sqlite);
    });
  }
  for (const [path, body] of POST) {
    it(`POST ${path} ${JSON.stringify(body)}`, async () => {
      const [sqlite, pg] = await both(path, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      expect(pg).toBe(sqlite);
    });
  }
});
