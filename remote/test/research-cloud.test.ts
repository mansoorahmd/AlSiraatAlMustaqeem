// Research in the cloud. Three things must hold:
//
//  1. PARITY — the research server answers every research call exactly as a research.db file
//     does: one scripted session is run against both (the same shared routes, SQLite vs the
//     shared `research` schema under row-level security, on PGlite) and every response is
//     compared, timestamps aside.
//  2. PRIVACY — each account sees only its own research: a draft is reachable by its owner alone,
//     and row-level security holds even against SQL written to reach across accounts.
//  3. THE AI BOUNDARY — a request made with an API token may only propose: tagged 'ai', never
//     primary, never deleting, never touching the reader's own records or conclusions.

import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { Db } from "../../server/src/db.js";
import { sqliteResearch } from "../../server/src/research-db.js";
import { ResearchStore } from "../../server/src/research.js";
import { researchDataRoutes } from "../../server/src/routes/research.js";
import type { Env, Principal } from "../src/roles.js";
import { researchApp, type ResearchPool } from "../src/research/serve.js";
import { forgetOwners, bindResearchUser } from "../src/research/schema.js";
import { runMigrations } from "../src/migrate.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

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

/** A research row references its account, so every test account is a real user. */
const addUser = (u: { id: string; email: string; name: string }) =>
  pglite.query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [u.id, u.email, u.name]);

beforeAll(async () => {
  pglite = new PGlite();
  const runner = {
    exec: async (sql: string) => { await pglite.exec(sql); },
    query: async (sql: string, params: unknown[] = []) => (await pglite.query(sql, params)).rows as Record<string, unknown>[],
  };
  await runMigrations(runner, MIGR);
  await addUser(AMINA); await addUser(BILAL);
  forgetOwners();
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

  it("one shared schema, each row carrying its account", async () => {
    // as the server's own (superuser) login, outside any request: both accounts' rows are there
    const owners = (await pglite.query<{ user_id: string }>(
      "SELECT DISTINCT user_id FROM research.notes ORDER BY user_id")).rows.map((r) => r.user_id);
    expect(owners).toEqual([AMINA.id, BILAL.id]);
  });
});

describe("row-level security holds against SQL written to reach across accounts", () => {
  const conn = {
    query: async (sql: string, params: unknown[] = []) => {
      const r = await pglite.query(sql, params);
      return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length };
    },
  };
  /** Run `fn` inside a transaction bound to `who`, exactly as a request is — then roll back. */
  async function as<T>(who: typeof AMINA, fn: () => Promise<T>): Promise<T> {
    await pglite.query("BEGIN");
    try {
      await bindResearchUser(conn, who.id, async () => who);
      return await fn();
    } finally { await pglite.query("ROLLBACK"); }
  }
  const q = async (sql: string, params: unknown[] = []) => (await pglite.query(sql, params)).rows;

  it("bound to Amina, even an explicit query for Bilal's rows returns nothing", async () => {
    const rows = await as(AMINA, () => q("SELECT id FROM research.notes WHERE user_id = $1", [BILAL.id]));
    expect(rows).toEqual([]);
    const all = await as(AMINA, () => q("SELECT DISTINCT user_id FROM notes"));
    expect(all.map((r: any) => r.user_id)).toEqual([AMINA.id]);
  });

  it("can't write a row into another account, or move one there", async () => {
    await expect(as(AMINA, () => q(
      "INSERT INTO notes (user_id, id, verse_key, created_at, updated_at) VALUES ($1, 'planted', '1:1', 1, 1)", [BILAL.id])))
      .rejects.toThrow(/row-level security/);
    await expect(as(AMINA, () => q("UPDATE notes SET user_id = $1 WHERE id = 'q1'", [BILAL.id])))
      .rejects.toThrow(/row-level security/);
  });

  it("can't change or delete another account's rows (they're simply not there)", async () => {
    const upd = await as(AMINA, () => pglite.query("UPDATE research.notes SET text = 'hijacked' WHERE user_id = $1", [BILAL.id]));
    expect(upd.affectedRows ?? 0).toBe(0);
    const del = await as(AMINA, () => pglite.query("DELETE FROM research.notes WHERE user_id = $1", [BILAL.id]));
    expect(del.affectedRows ?? 0).toBe(0);
    const bilals = (await pglite.query("SELECT text FROM research.notes WHERE user_id = $1", [BILAL.id])).rows as any[];
    expect(bilals.map((n) => n.text)).toEqual(["Bilal's own"]);
  });

  it("with no account bound, the research role sees nothing and can write nothing", async () => {
    await pglite.query("BEGIN");
    try {
      await pglite.query("SET LOCAL ROLE mqrg_research");
      expect((await pglite.query("SELECT 1 FROM research.notes")).rows).toEqual([]);
      await expect(pglite.query("INSERT INTO research.notes (id, verse_key, created_at, updated_at) VALUES ('x', '1:1', 1, 1)"))
        .rejects.toThrow();
    } finally { await pglite.query("ROLLBACK"); }
  });

  it("the research role can't escape: no superuser, no bypass, no other tables", async () => {
    const role = (await pglite.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'mqrg_research'")).rows[0]!;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    await expect(as(AMINA, () => q("SELECT email FROM public.users"))).rejects.toThrow(/permission denied/);
    // turning row_security off doesn't turn the policy off for a non-owner: it makes reads that
    // would be filtered fail instead of returning another account's rows
    await expect(as(AMINA, async () => {
      await pglite.query("SET LOCAL row_security = off");
      return q("SELECT id FROM research.notes");
    })).rejects.toThrow(/row-level security/);
  });

  it("deleting an account deletes its research", async () => {
    const GONE = { id: "55555555-5555-4555-8555-555555555555", email: "gone@example.org", name: "Gone" };
    await addUser(GONE); profiles.set(GONE.id, GONE);
    await send(cloudAs(GONE), ["PUT", "/research/notes/g1", { id: "g1", verseKey: "1:1", text: "soon gone" }]);
    expect((await pglite.query("SELECT 1 FROM research.notes WHERE user_id = $1", [GONE.id])).rows).toHaveLength(1);
    await pglite.query("DELETE FROM users WHERE id = $1", [GONE.id]);
    expect((await pglite.query("SELECT 1 FROM research.notes WHERE user_id = $1", [GONE.id])).rows).toHaveLength(0);
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

describe("bringing research in, and taking a copy out", () => {
  const post = (app: Hono<any>, bytes: Uint8Array) =>
    app.request("/research/import", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });

  /** A research.db as the local app would have it, owned by Amina. */
  async function fileWith(fill: (s: ResearchStore) => Promise<void>): Promise<Uint8Array> {
    const path = join(mkdtempSync(join(tmpdir(), "alsiraat-import-")), "research.db");
    const db = new Db(path);
    const s = await ResearchStore.open(sqliteResearch(db));
    await s.setOwner(AMINA.email, AMINA.name);
    await fill(s);
    db.exec("PRAGMA journal_mode = DELETE");
    db.close();
    const { readFileSync } = await import("node:fs");
    return new Uint8Array(readFileSync(path));
  }

  it("imports a research.db into a new account: everything arrives", async () => {
    const CARA = { id: "33333333-3333-4333-8333-333333333333", email: "cara@example.org", name: "Cara" };
    profiles.set(CARA.id, CARA);
    await addUser(CARA);
    const bytes = await fileWith(async (s) => {
      await s.saveCase({ id: "k1", subject: { type: "root", value: "صبر" }, title: "patience",
        formResearch: { "صَبْر": { status: "established", meaning: "holding firm" } } });
      await s.saveNote({ id: "kn1", verseKey: "2:153", text: "with the patient" });
      await s.saveIndication({ id: "ki1", root: "صبر", label: "hold firm" });
      await s.saveMotif({ id: "km1", name: "steadfastness" });
      await s.addMotifRoot("km1", "صبر");
      await s.setSetting("reading", { size: 2 });
    });
    const res = await post(cloudAs(CARA), bytes);
    expect(res.status).toBe(200);
    const out = await res.json() as { copied: number };
    expect(out.copied).toBeGreaterThanOrEqual(7);
    const cara = cloudAs(CARA);
    expect((await (await cara.request("/research/cases/k1")).json() as { title: string }).title).toBe("patience");
    expect(await (await cara.request("/research/form-status")).json()).toHaveLength(1);
    expect((await (await cara.request("/research/motifs/km1")).json() as { roots: string[] }).roots).toEqual(["صبر"]);
    expect((await (await cara.request("/research/settings/reading")).json() as { value: unknown }).value).toEqual({ size: 2 });
    // importing the same file again adds nothing
    expect((await (await post(cara, bytes)).json() as { copied: number }).copied).toBe(0);
  });

  it("merges into an account that already has research — never overwriting it", async () => {
    const bytes = await fileWith(async (s) => {
      await s.saveNote({ id: "q1", verseKey: "55:13", text: "an OLD version from the file" });   // same id as the cloud's
      await s.saveNote({ id: "from_file", verseKey: "3:3", text: "only in the file" });
    });
    const res = await post(cloudAs(AMINA), bytes);
    expect((await res.json() as { tables: Record<string, { copied: number; alreadyThere: number }> }).tables.notes)
      .toEqual({ copied: 1, alreadyThere: 1 });
    const notes = await (await cloudAs(AMINA).request("/research/notes")).json() as { id: string; text: string }[];
    expect(notes.find((n) => n.id === "q1")!.text).toBe("meaning?");            // the account's version kept
    expect(notes.map((n) => n.id)).toContain("from_file");
  });

  it("refuses what isn't a research file, and refuses a token", async () => {
    expect((await post(cloudAs(AMINA), new TextEncoder().encode("not a database"))).status).toBe(422);
    const bytes = await fileWith(async () => {});
    expect((await post(cloudAs(AMINA, "token"), bytes)).status).toBe(403);
  });

  it("exports the account's research as a research.db that opens and re-imports", async () => {
    const res = await cloudAs(AMINA).request("/research/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="research-\d{8}\.db"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { writeFileSync } = await import("node:fs");
    const path = join(mkdtempSync(join(tmpdir(), "alsiraat-export-")), "research.db");
    writeFileSync(path, bytes);
    const store = await ResearchStore.open(sqliteResearch(new Db(path)));
    expect((await store.getOwner())!.email).toBe(AMINA.email);
    const cloudNotes = await (await cloudAs(AMINA).request("/research/notes")).json() as { id: string }[];
    expect((await store.listNotes()).map((n) => n.id)).toEqual(cloudNotes.map((n) => n.id));
    expect((await store.glossData()).roots).toHaveLength(1);
    // and taking it back in is a no-op
    expect((await (await post(cloudAs(AMINA), bytes)).json() as { copied: number }).copied).toBe(0);
  });
});

describe("the Postgres research tables and a research.db file have the same shape", () => {
  it("every table, every column — plus the owning user_id in Postgres", async () => {
    const { RESEARCH_TABLES } = await import("../../server/src/research-transfer.js");
    const file = new Db(join(mkdtempSync(join(tmpdir(), "alsiraat-shape-")), "research.db"));
    await ResearchStore.open(sqliteResearch(file));
    for (const table of [...RESEARCH_TABLES, "owner"]) {
      const sqlite = file.query<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name).sort();
      const pg = (await pglite.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'research' AND table_name = $1",
        [table])).rows.map((c) => c.column_name).filter((c) => c !== "user_id").sort();
      expect(pg, table).toEqual(sqlite);
    }
    file.close();
  });
});
