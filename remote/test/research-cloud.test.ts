// Research in the cloud. Three things must hold:
//
//  1. PARITY — the research server answers every research call exactly as a research.db file
//     does: one scripted session is run against both (the same shared routes, SQLite vs the
//     user's Postgres schema on PGlite) and every response is compared, timestamps aside.
//  2. PRIVACY — each account sees only its own research; nothing is shared unless published.
//  3. THE AI BOUNDARY — a request made with an API token may only propose: tagged 'ai', never
//     primary, never deleting, never touching the reader's own records or conclusions.

import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { Db } from "../../server/src/db.js";
import { sqliteResearch } from "../../server/src/research-db.js";
import { ResearchStore } from "../../server/src/research.js";
import { researchDataRoutes } from "../../server/src/routes/research.js";
import type { Env, Principal } from "../src/roles.js";
import { researchApp, type ResearchPool } from "../src/research/serve.js";
import { forgetReadySchemas, schemaFor } from "../src/research/schema.js";

const AMINA = { id: "11111111-1111-4111-8111-111111111111", email: "amina@example.org", name: "Amina" };
const BILAL = { id: "22222222-2222-4222-8222-222222222222", email: "bilal@example.org", name: "Bilal" };
const profiles = new Map([[AMINA.id, AMINA], [BILAL.id, BILAL]]);

let pglite: PGlite;
let local: Hono;
const cloudAs = (who: typeof AMINA, via: "session" | "token" = "session") => {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("user", { id: who.id, role: "reader", plan: "free", via } satisfies Principal);
    await next();
  });
  app.route("/", researchApp(pool, async (id) => profiles.get(id)!) as unknown as Hono<Env>);
  return app;
};

// PGlite is one connection: hand it out one request at a time
let chain: Promise<void> = Promise.resolve();
const pool: ResearchPool = {
  connect: () => new Promise((resolve) => {
    chain = chain.then(() => new Promise<void>((release) => resolve({
      query: async (sql, params = []) => {
        const r = await pglite.query(sql, params as unknown[]);
        return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length };
      },
      release,
    })));
  }),
};

beforeAll(async () => {
  pglite = new PGlite();
  forgetReadySchemas();
  const file = new Db(join(mkdtempSync(join(tmpdir(), "alsiraat-rcloud-")), "research.db"));
  const store = await ResearchStore.open(sqliteResearch(file));
  await store.setOwner(AMINA.email, AMINA.name);        // the same person as the cloud account
  local = new Hono().route("/", researchDataRoutes(() => store));
});

/** Timestamps differ run to run; everything else must match exactly. */
const stable = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) =>
      [k, /(At|_at)$/.test(k) && typeof x === "number" ? "<time>" : stable(x)]));
  }
  return v;
};

type Step = [method: string, path: string, body?: unknown];
const SESSION: Step[] = [
  // cases, their form research and revisions
  ["PUT", "/research/cases/c1", { id: "c1", subject: { type: "root", value: "امم" }, title: "ummah", status: "open",
    formResearch: { "أُمَّة": { status: "established", meaning: "community" } } }],
  ["PUT", "/research/cases/c1", { id: "c1", subject: { type: "root", value: "امم" }, title: "ummah", status: "open",
    formResearch: { "أُمَّة": { status: "established", meaning: "a measured middle community" } } }],
  ["PUT", "/research/cases/c2", { id: "c2", subject: { type: "phrase", value: "سواء السبيل" }, title: "the even path" }],
  ["GET", "/research/cases"], ["GET", "/research/cases/c1"], ["GET", "/research/cases/nope"],
  ["GET", "/research/form-status"], ["GET", "/research/cases/c1/forms/أُمَّة/revisions"],
  ["PUT", "/research/cases/c9", { id: "other" }],
  // trails
  ["PUT", "/research/trails/t1", { id: "t1", name: "siraj", hops: [{ verseKey: "25:61", wordPosition: 5 }] }],
  ["GET", "/research/trails"],
  // notes and questions, with cross-references
  ["PUT", "/research/notes/q1", { id: "q1", verseKey: "55:13", wordPosition: 3, kind: "question", text: "meaning?", lemma: "ءَالَآء", root: "الو" }],
  ["PUT", "/research/notes/q2", { id: "q2", verseKey: "55:16", wordPosition: 3, kind: "question", text: "again", lemma: "ءَالَآء", root: "الو" }],
  ["PUT", "/research/notes/n1", { id: "n1", verseKey: "7:69", kind: "note", text: "other form", root: "الو" }],
  ["PUT", "/research/notes/q1", { id: "q1", verseKey: "55:13", wordPosition: 3, kind: "question", text: "meaning?", answer: "the favours", resolved: true, lemma: "ءَالَآء", root: "الو" }],
  ["GET", "/research/notes"], ["GET", "/research/notes?verse=55:13"], ["GET", "/research/notes?root=الو"],
  ["PUT", "/research/notes/p_ai", { id: "p_ai", verseKey: "2:3", kind: "note", text: "from the ai", source: "ai" }],
  ["GET", "/research/proposed"], ["PUT", "/research/proposed/note/p_ai/accept"], ["GET", "/research/proposed"],
  // the reader's own root meanings
  ["PUT", "/research/root-meanings/hdy", { meaning: "guidance that arrives" }],
  ["GET", "/research/root-meanings"], ["GET", "/research/root-meanings/hdy"], ["GET", "/research/root-meanings/none"],
  // motifs
  ["PUT", "/research/motifs/m1", { id: "m1", name: "light", note: "نور and its kin" }],
  ["PUT", "/research/motifs/m1/roots/نور"], ["PUT", "/research/motifs/m1/roots/ضوء"], ["PUT", "/research/motifs/m1/roots/نور"],
  ["PUT", "/research/motifs/m2", { id: "m2", name: "darkness" }], ["PUT", "/research/motifs/m2/roots/ظلم"],
  ["GET", "/research/motifs"], ["GET", "/research/motifs/by-root/نور"], ["GET", "/research/motifs/m1"],
  ["DELETE", "/research/motifs/m1/roots/ضوء"], ["GET", "/research/motifs/m1"],
  // indications: root, a second one, switching primary, refinements, the word view, gloss
  ["PUT", "/research/indications/A", { id: "A", root: "فلح", label: "attain", meaning: "to reach the good" }],
  ["PUT", "/research/indications/B", { id: "B", root: "فلح", label: "cultivate", meaning: "to till" }],
  ["PUT", "/research/refinements/r1", { id: "r1", parentId: "A", lemma: "أَفْلَحَ", label: "he prospered" }],
  ["PUT", "/research/refinements/r2", { id: "r2", parentId: "A", lemma: "ٱلْمُفْلِحُونَ", label: "the successful" }],
  ["PUT", "/research/refinements/r1b", { id: "r1b", parentId: "A", lemma: "أَفْلَحَ", label: "he truly prospered" }],
  ["PUT", "/research/indications/L", { id: "L", lemma: "إِيَّاكَ", label: "you alone" }],
  ["GET", "/research/indications/for-word?root=فلح&lemma=أَفْلَحَ"],
  ["GET", "/research/indications/for-word?lemma=إِيَّاكَ"],
  ["GET", "/research/indications/A/refinements"], ["GET", "/research/indications/gloss"],
  ["PUT", "/research/indications/B/primary"], ["GET", "/research/indications/gloss"],
  ["DELETE", "/research/indications/B"], ["GET", "/research/indications/for-word?root=فلح"],
  ["PUT", "/research/refinements/bad", { id: "bad", parentId: "nope", lemma: "x" }],
  // comparisons, deduped by (kind, ref)
  ["PUT", "/research/compare-sets/s1", { id: "s1", title: "near-synonyms" }],
  ["PUT", "/research/compare-sets/s1/items/i1", { kind: "ayah", ref: "2:255" }],
  ["PUT", "/research/compare-sets/s1/items/i2", { kind: "root", ref: "هدي", label: "guidance" }],
  ["PUT", "/research/compare-sets/s1/items/i3", { kind: "ayah", ref: "2:255" }],
  ["GET", "/research/compare-sets"], ["GET", "/research/compare-sets/s1/items"],
  ["DELETE", "/research/compare-sets/s1/items/i1"], ["GET", "/research/compare-sets"],
  // the outbox: what was published
  ["PUT", "/research/submission-log/q2", { submissionId: "sub_1", contentHash: "h1", kind: "question" }],
  ["GET", "/research/submission-log"], ["GET", "/research/submission-log/q2"], ["GET", "/research/submission-log/zz"],
  ["POST", "/research/proposals", { subjectKind: "root", subjectValue: "فلح", contentHash: "h2" }],
  ["GET", "/research/proposals?subjectKind=root&subjectValue=فلح"],
  // settings
  ["PUT", "/research/settings/reading", { value: { script: "uthmani", size: 3 } }],
  ["GET", "/research/settings/reading"], ["GET", "/research/settings/none"],
  // deletes
  ["DELETE", "/research/notes/n1"], ["DELETE", "/research/notes/n1"], ["DELETE", "/research/cases/c2"],
  ["DELETE", "/research/trails/t1"], ["DELETE", "/research/motifs/m2"], ["DELETE", "/research/compare-sets/s1"],
  ["GET", "/research/cases"], ["GET", "/research/notes"], ["GET", "/research/motifs"],
];

const send = (app: Hono<any>, [method, path, body]: Step) =>
  app.request(path, body === undefined ? { method } : {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

describe("parity: the research server answers exactly as a research.db file does", () => {
  it(`${SESSION.length} calls, every response identical (timestamps aside)`, async () => {
    const cloud = cloudAs(AMINA);
    let ok = 0, withContent = 0;
    for (const step of SESSION) {
      const [a, b] = [await send(local, step), await send(cloud, step)];
      const label = `${step[0]} ${step[1]}`;
      expect(b.status, label).toBe(a.status);
      const body = await b.json();
      expect(stable(body), label).toEqual(stable(await a.json()));
      if (b.status < 300) ok++;
      if (body && JSON.stringify(body).length > 20) withContent++;
    }
    // not a vacuous pass: the session really did the work (a few steps are deliberate 400/404s)
    expect(ok).toBeGreaterThan(SESSION.length - 10);
    expect(withContent).toBeGreaterThan(SESSION.length / 2);
    const gloss = await (await cloud.request("/research/indications/gloss")).json() as { roots: unknown[]; refinements: unknown[] };
    expect(gloss.roots.length).toBe(1);
    expect(gloss.refinements.length).toBe(2);
  });

  it("the account's research carries its owner — the same identity a research.db of theirs has", async () => {
    const id = await (await cloudAs(AMINA).request("/research/identity")).json() as { owner: { email: string }; localId: string };
    expect(id.owner.email).toBe(AMINA.email);
    const note = (await (await cloudAs(AMINA).request("/research/notes?verse=55:13")).json() as { authorId: string }[])[0]!;
    expect(note.authorId).toBe(id.localId);
  });
});

describe("privacy: each account sees only its own research", () => {
  it("another account's research is simply not there", async () => {
    const bilal = cloudAs(BILAL);
    expect(await (await bilal.request("/research/notes")).json()).toEqual([]);
    expect(await (await bilal.request("/research/cases")).json()).toEqual([]);
    expect((await bilal.request("/research/cases/c1")).status).toBe(404);
    // and Bilal writing the same id doesn't touch Amina's
    await send(bilal, ["PUT", "/research/notes/q1", { id: "q1", verseKey: "1:1", text: "Bilal's own" }]);
    const aminas = await (await cloudAs(AMINA).request("/research/notes?verse=55:13")).json() as { text: string }[];
    expect(aminas[0]!.text).toBe("meaning?");
  });

  it("each account is its own schema", async () => {
    const schemas = (await pglite.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'research_%' ORDER BY nspname")).rows.map((r) => r.nspname);
    expect(schemas).toEqual([schemaFor(AMINA.id), schemaFor(BILAL.id)]);
  });
});

describe("the AI boundary: a token may only propose", () => {
  const ai = () => cloudAs(AMINA, "token");
  const put = (path: string, body: unknown) => send(ai(), ["PUT", path, body]);

  it("adds a note — tagged as the AI's, awaiting review", async () => {
    const res = await put("/research/notes/ai_n1", { id: "ai_n1", verseKey: "2:2", text: "a thought", source: "me" });
    expect(res.status).toBe(200);
    const proposed = await (await cloudAs(AMINA).request("/research/proposed")).json() as { notes: { id: string }[] };
    expect(proposed.notes.map((n) => n.id)).toContain("ai_n1");
  });

  it("can't overwrite the reader's own note", async () => {
    const res = await put("/research/notes/q1", { id: "q1", verseKey: "55:13", text: "rewritten by ai" });
    expect(res.status).toBe(403);
  });

  it("never makes an indication primary — even the first one for a root", async () => {
    await put("/research/indications/ai_i1", { id: "ai_i1", root: "نذر", label: "vow", primary: true });
    const d = await (await cloudAs(AMINA).request("/research/indications/ai_i1")).json() as { primary: boolean; source: string };
    expect(d).toMatchObject({ primary: false, source: "ai" });
    expect((await send(ai(), ["PUT", "/research/indications/ai_i1/primary"])).status).toBe(403);
  });

  it("can't delete, accept its own proposals, publish, or change settings", async () => {
    for (const step of [
      ["DELETE", "/research/notes/ai_n1"], ["DELETE", "/research/cases/c1"],
      ["PUT", "/research/proposed/note/ai_n1/accept"],
      ["PUT", "/research/submission-log/ai_n1", { submissionId: "s", contentHash: "h" }],
      ["PUT", "/research/settings/reading", { value: 1 }],
      ["PUT", "/research/root-meanings/hdy", { meaning: "ai says" }],
    ] as Step[]) {
      expect((await send(ai(), step)).status, `${step[0]} ${step[1]}`).toBe(403);
    }
  });

  it("on the reader's case: may add its own items, never touch theirs or the conclusions", async () => {
    const mine = { id: "c_mine", subject: { type: "root", value: "رحم" }, title: "mine", verdict: "my verdict",
      status: "partial", formResearch: { "رَحْمَة": { status: "established", meaning: "mercy" } },
      cards: [{ id: "card_me", verseKey: "1:1" }], slips: [], threads: [], clusters: [] };
    await send(cloudAs(AMINA), ["PUT", "/research/cases/c_mine", mine]);
    // adding its own card, while trying to rewrite the verdict: the card lands, the verdict doesn't
    const add = await put("/research/cases/c_mine", { ...mine, verdict: "ai verdict", status: "closed", formResearch: {},
      cards: [...mine.cards, { id: "card_ai", verseKey: "1:2", source: "ai" }] });
    expect(add.status).toBe(200);
    const after = await (await cloudAs(AMINA).request("/research/cases/c_mine")).json() as Record<string, any>;
    expect(after.cards.map((c: any) => c.id)).toEqual(["card_me", "card_ai"]);
    expect(after).toMatchObject({ verdict: "my verdict", status: "partial", title: "mine" });
    expect(after.formResearch).toEqual(mine.formResearch);
    // removing or editing the reader's card is refused
    expect((await put("/research/cases/c_mine", { ...after, cards: [after.cards[1]] })).status).toBe(403);
    expect((await put("/research/cases/c_mine", { ...after, cards: [{ ...after.cards[0], verseKey: "9:9" }, after.cards[1]] })).status).toBe(403);
    // an untagged new item is refused too
    expect((await put("/research/cases/c_mine", { ...after, cards: [...after.cards, { id: "sneaky", verseKey: "3:3" }] })).status).toBe(403);
  });

  it("may edit a motif it proposed, but not the reader's", async () => {
    await put("/research/motifs/ai_m", { id: "ai_m", name: "ai grouping" });
    expect((await send(ai(), ["PUT", "/research/motifs/ai_m/roots/قلب"])).status).toBe(200);
    await send(cloudAs(AMINA), ["PUT", "/research/motifs/m_me", { id: "m_me", name: "mine" }]);
    expect((await send(ai(), ["PUT", "/research/motifs/m_me/roots/قلب"])).status).toBe(403);
    expect((await put("/research/motifs/m_me", { id: "m_me", name: "renamed by ai" })).status).toBe(403);
  });
});
