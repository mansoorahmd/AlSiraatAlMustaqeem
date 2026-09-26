// Prove the cloud corpus answers EXACTLY like the local one, over the whole real corpus.
//
//   npm run corpus:parity            # the full sweep
//   npm run corpus:parity -- --quick # a fast sample (every chapter, 1 in 25 verses/roots)
//
// One corpus codebase, two drivers: this mounts the IDENTICAL app (the shared server routes, via
// corpusApp) over SQLite (quran.db) and over Postgres (the `corpus` schema), sends both the same
// requests — every route, across every chapter, verse and root — and compares status and body
// byte for byte, key order included. Exit code 1 on any difference.
//
// Prerequisite: `npm run corpus:migrate` (the Postgres copy must match quran.db).

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { corpusPool, corpusRunner } from "./db.js";
import { pgCorpus } from "./corpus/pg-corpus.js";
import { corpusApp } from "./corpus/serve.js";
import { Db } from "../../server/src/db.js";
import { sqliteCorpus } from "../../server/src/corpus-db.js";
import { createCorpusServices, warmCorpus } from "../../server/src/corpus-services.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sqlitePath = process.env.QF_QURAN_DB ?? resolve(repo, "quran.db");
if (!existsSync(sqlitePath)) { console.error(`no quran.db at ${sqlitePath}`); process.exit(1); }
const quick = process.argv.includes("--quick");
const every = (n: number) => (_: unknown, i: number) => !quick || i % n === 0;

const db = new Db(sqlitePath, { readOnly: true });
const liteSvc = createCorpusServices(sqliteCorpus(db));
const cloudSvc = createCorpusServices(pgCorpus(corpusRunner));
const lite = corpusApp(liteSvc) as unknown as Hono;
const cloud = corpusApp(cloudSvc) as unknown as Hono;

let checked = 0;
const diffs: { req: string; sqlite: string; pg: string }[] = [];

async function same(path: string, init?: RequestInit): Promise<void> {
  const ask = async (app: Hono) => {
    const res = await app.request(path, init);
    return `${res.status} ${await res.text()}`;
  };
  const [a, b] = await Promise.all([ask(lite), ask(cloud)]);
  checked++;
  if (a !== b) diffs.push({ req: `${init?.method ?? "GET"} ${path}`, sqlite: a.slice(0, 240), pg: b.slice(0, 240) });
}
const post = (path: string, body: unknown) =>
  same(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const enc = encodeURIComponent;

const t0 = Date.now();
const step = (label: string) =>
  console.log(`  ${label.padEnd(46)} ${checked.toLocaleString().padStart(7)} checks  ${((Date.now() - t0) / 1000).toFixed(0)}s`);

try {
  console.log(`comparing SQLite (${sqlitePath}) with Postgres (schema "corpus")${quick ? " — quick sample" : ""}…`);
  console.log("  building indexes on both engines…");
  await Promise.all([warmCorpus(liteSvc), warmCorpus(cloudSvc)]);

  const verseKeys = db.query<{ verse_key: string }>("SELECT verse_key FROM verses ORDER BY id").map((r) => r.verse_key);
  const roots = db.query<{ root_buckwalter: string }>("SELECT root_buckwalter FROM roots ORDER BY id").map((r) => r.root_buckwalter);

  for (const p of ["/scripts", "/chapters", "/translation-resources", "/corpus/version", "/chapters/0", "/chapters/115"]) await same(p);
  for (let ch = 1; ch <= 114; ch++) {
    await same(`/chapters/${ch}`);
    await same(`/chapters/${ch}/verses?all_scripts=1&words=1`);
    await same(`/chapters/${ch}/verses?script=imlaei&limit=5&offset=2`);
    await same(`/chapters/${ch}/variants`);
    await same(`/chapters/${ch}/echoes`);
  }
  step("chapters (every script, words, variants, echoes)");

  for (const k of verseKeys.filter(every(25))) {
    await same(`/verses/${k}?words=1&translations=1`);
    await same(`/verses/${k}/echoes`);
    await same(`/verses/${k}/similar?top_k=10`);
  }
  step("verses (words, translations, echoes, similar)");

  for (const k of verseKeys.filter(every(40))) {
    await same(`/verses/${k}/neighbours?radius=3`);
    await same(`/verses/${k}?all_scripts=1`);
    for (const pos of [1, 2, 3]) {
      await same(`/verses/${k}/wazn?pos=${pos}`);
      await same(`/verses/${k}/spelling?pos=${pos}`);
    }
  }
  step("neighbours, all scripts, wazn, spellings");

  for (const [f, vals] of Object.entries({
    juz: [1, 10, 20, 30], hizb: [1, 30, 60], page: [1, 300, 604], manzil: [1, 4, 7], ruku: [1, 300, 556],
  })) for (const v of vals) await same(`/verses?${f}=${v}&limit=300`);
  await same("/verses?offset=6200&limit=300");
  step("navigation filters");

  for (const o of ["count", "forms", "letters", "alpha", "arabic"]) {
    await same(`/roots?order_by=${o}&limit=2000`);
    await same(`/roots?order_by=${o}&descending=false&limit=2000`);
  }
  for (const r of roots.filter(every(25))) {
    await same(`/roots/${enc(r)}`);
    await same(`/roots/${enc(r)}/forms`);
    await same(`/roots/${enc(r)}/occurrences?limit=3000`);
    await same(`/roots/${enc(r)}/linkages`);
    await same(`/roots/${enc(r)}/linkages?scope=adjacent&window=2&sort_by=count`);
  }
  step("roots (lists, detail, forms, occurrences, linkages)");

  const pairs = [["Allh", "rHm"], ["Amn", "Eml"], ["nfq", "Amn"], ["hdy", "Dll"], ["qwl", "Allh"], ["kfr", "Amn"]];
  for (const [a, b] of pairs) await same(`/roots/${a}/with/${b}?limit=500`);
  step("root pairs (shared verses, incl. over the limit)");

  const words = ["ٱلرَّحْمَٰنِ", "ٱلرَّحْمَـٰنِ", "صلوٰة", "إِيَّاكَ", "الله", "مِمَّا", "ٱلصَّلَوٰةَ"];
  for (const w of words) {
    await same(`/words/occurrences?surface=${enc(w)}`);
    await same(`/words/occurrences?surface=${enc(w)}&full=1`);
  }
  for (const q of ["الحمد لله", "يا ايها الذين امنوا", "رب العالمين", "لا اله الا هو"]) {
    await same(`/phrase-search?q=${enc(q)}&limit=300`);
    await post("/search", { text: q, top_k: 30 });
  }
  await post("/expression-search", { terms: [{ surface: "الصلاة", root: "Slw" }, { surface: "الزكاة", root: "zkw" }], mode: "roots" });
  await post("/expression-search", { terms: [{ surface: "الحمد" }, { surface: "لله" }], mode: "verbatim" });
  step("words, phrase, free-text and expression search");

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (diffs.length === 0) {
    console.log(`\n  ✔ ${checked.toLocaleString()} requests compared in ${secs}s — the cloud corpus answers exactly like the local one.`);
  } else {
    console.log(`\n  ✘ ${diffs.length} of ${checked.toLocaleString()} requests differ. First few:`);
    for (const d of diffs.slice(0, 6)) console.log(`\n  ${d.req}\n    sqlite: ${d.sqlite}\n    pg:     ${d.pg}`);
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`corpus:parity: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await corpusPool.end();
}
