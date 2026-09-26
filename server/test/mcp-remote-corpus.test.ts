// The MCP reads the corpus over HTTP now (mcp/src/corpus-client.ts). This proves the remote path
// answers every corpus tool EXACTLY as the local services do: the same tools run twice — once on
// localReads(services), once on remoteReads() whose requests are routed into an in-process app
// serving the shared /corpus routes over the same quran.db. So what's under test is the client:
// its URLs, parameter names, and the "404 means nothing there" mapping. (That Postgres answers
// like SQLite is proved separately, by corpus:parity.)

import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Db } from "../src/db.js";
import { sqliteCorpus } from "../src/corpus-db.js";
import { createCorpusServices } from "../src/corpus-services.js";
import { HttpError } from "../src/content.js";
import { contentRoutes } from "../src/routes/content.js";
import { rootRoutes } from "../src/routes/roots.js";
import { similarityRoutes } from "../src/routes/similarity.js";
import { echoRoutes } from "../src/routes/echoes.js";
import { ResearchStore } from "../src/research.js";
import { localReads, remoteReads, CorpusAccessError } from "../../mcp/src/corpus-client.js";
import { TOOLS } from "../../mcp/src/tools.js";

const QURAN = process.env.QF_QURAN_DB ?? resolve(import.meta.dirname, "..", "..", "quran.db");
let local: any, remote: any;

beforeAll(() => {
  const svc = createCorpusServices(sqliteCorpus(new Db(QURAN, { readOnly: true })));
  const corpus = new Hono();
  corpus.onError((err, c) => err instanceof HttpError
    ? c.json({ detail: err.message }, err.status as 400) : c.json({ detail: String(err) }, 500));
  for (const r of [contentRoutes(svc), rootRoutes(svc), similarityRoutes(svc), echoRoutes(svc)]) corpus.route("/", r);
  const app = new Hono().route("/corpus", corpus);

  const research = new ResearchStore(new Db(join(mkdtempSync(join(tmpdir(), "alsiraat-mcpr-")), "r.db")));
  local = { ...localReads(svc), research };
  remote = { ...remoteReads("http://corpus.test", "mqrg_test", (url, init) => app.request(url, init)), research };
});

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

const CASES: [string, Record<string, unknown>][] = [
  ["study_root", { root: "فلح", occurrences: 3 }],
  ["study_root", { root: "nope", occurrences: 3 }],
  ["read_ayah", { verse_key: "2:255", script: "uthmani" }],
  ["read_ayah", { verse_key: "1:1", script: "imlaei" }],
  ["read_ayah", { verse_key: "999:1", script: "uthmani" }],
  ["find_where_roots_meet", { root_a: "hdy", root_b: "Dll", script: "uthmani", limit: 20 }],
  ["trace_word", { word: "صلو", exact: false, limit: 5 }],
  ["trace_word", { word: "صلوٰة", exact: true, limit: 5 }],
  ["trace_word", { word: "إياك", exact: true, limit: 5 }],
  ["search_quran", { query: "الحمد لله", mode: "phrase", limit: 5, script: "uthmani" }],
  ["search_quran", { query: "الحمد لله رب العالمين", mode: "related", limit: 5, script: "uthmani" }],
  ["search_quran", { query: "الصلاة الزكاة", mode: "expression", limit: 5, script: "uthmani" }],
  ["compare_forms", { root: "رحم", per_form: 2 }],
  ["get_root", { root: "hdy" }],
  ["get_root", { root: "nope" }],
  ["list_roots", { order_by: "count", limit: 5, offset: 0 }],
  ["list_roots", { order_by: "alpha", limit: 5, offset: 0 }],
  ["get_verses", { chapter: 1, limit: 3, offset: 1, script: "uthmani" }],
  ["get_linkages", { root: "hdy", scope: "ayah", limit: 5 }],
  ["get_linkages", { root: "hdy", scope: "adjacent", limit: 5 }],
  ["get_echoes", { verse_key: "1:1" }],
  ["get_wazn", { verse_key: "2:2", word_position: 2 }],
  ["get_spelling_variants", { verse_key: "1:1", word_position: 3 }],
  ["get_similar_ayat", { verse_key: "1:1", limit: 5 }],
];

describe("the MCP's corpus tools answer the same over HTTP as locally", () => {
  for (const [name, args] of CASES) {
    it(`${name} ${JSON.stringify(args)}`, async () => {
      const a = JSON.stringify(await tool(name).run(local, args));
      const b = JSON.stringify(await tool(name).run(remote, args));
      expect(b).toBe(a);
    });
  }
});

describe("a refused or unreachable corpus says what to do", () => {
  const refusing = (status: number, body: unknown) =>
    remoteReads("http://corpus.test", undefined, async () => new Response(JSON.stringify(body), { status }));

  it("401 → tells the user to create a token", async () => {
    await expect(refusing(401, {}).roots.getRoot("hdy")).rejects.toThrow(/REMOTE_TOKEN/);
  });
  it("402 → names the plan needed", async () => {
    await expect(refusing(402, { plan: "scholar" }).roots.getRoot("hdy")).rejects.toThrow(/scholar plan/);
  });
  it("unreachable → says so, and how to read offline", async () => {
    const offline = remoteReads("http://nowhere.test", "t", async () => { throw new TypeError("fetch failed"); });
    await expect(offline.content.getVerse("1:1")).rejects.toBeInstanceOf(CorpusAccessError);
    await expect(offline.content.getVerse("1:1")).rejects.toThrow(/MQ_CORPUS=local/);
  });
});
