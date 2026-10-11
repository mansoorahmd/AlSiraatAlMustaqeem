// Research in the account. Two things must hold:
//
//  1. PRIVACY — each account sees only its own research: a draft is reachable by its owner alone,
//     and row-level security holds even against SQL written to reach across accounts.
//  2. THE AI BOUNDARY — a request made with an API token may only propose: tagged 'ai', never
//     primary, never deleting, never touching the reader's own records or conclusions.
//
// What the research does (cases, notes, indications, …) is research-store.test.ts.

import { describe, it, expect, beforeAll } from "vitest";
import { bindResearchUser } from "../src/research/schema.js";
import { researchHarness, client, type ResearchHarness } from "./research-harness.js";

const AMINA = { id: "11111111-1111-4111-8111-111111111111", email: "amina@example.org", name: "Amina" };
const BILAL = { id: "22222222-2222-4222-8222-222222222222", email: "bilal@example.org", name: "Bilal" };

let h: ResearchHarness;
const amina = () => client(h.as(AMINA));

beforeAll(async () => {
  h = await researchHarness();
  await h.addUser(AMINA); await h.addUser(BILAL);
  const a = amina();
  await a.put("/research/notes/q1", { id: "q1", verseKey: "55:13", kind: "question", text: "meaning?", root: "الو" });
  await a.put("/research/cases/c1", { id: "c1", subject: { type: "root", value: "امم" }, title: "ummah" });
  await a.put("/research/root-meanings/hdy", { meaning: "guidance that arrives" });
});

describe("privacy: each account sees only its own research", () => {
  it("another account's research is simply not there", async () => {
    const bilal = client(h.as(BILAL));
    expect(await bilal.get("/research/notes")).toEqual([]);
    expect(await bilal.get("/research/cases")).toEqual([]);
    expect((await h.as(BILAL).request("/research/cases/c1")).status).toBe(404);
    // and Bilal writing the same id doesn't touch Amina's
    await bilal.put("/research/notes/q1", { id: "q1", verseKey: "1:1", text: "Bilal's own" });
    const aminas = await amina().get("/research/notes?verse=55:13") as { text: string }[];
    expect(aminas[0]!.text).toBe("meaning?");
  });

  it("one shared schema, each row carrying its account — and authored by it", async () => {
    // as the server's own (superuser) login, outside any request: both accounts' rows are there
    const rows = (await h.pglite.query<{ user_id: string; author_id: string }>(
      "SELECT user_id, author_id FROM research.notes ORDER BY user_id")).rows;
    expect(rows.map((r) => r.user_id)).toEqual([AMINA.id, BILAL.id]);
    for (const r of rows) expect(r.author_id).toBe(r.user_id);
  });

  it("signed out, there is no research at all", async () => {
    const { Hono } = await import("hono");
    const { researchApp } = await import("../src/research/serve.js");
    const anon = new Hono().route("/", researchApp(h.pool) as never);
    expect((await anon.request("/research/notes")).status).toBe(401);
  });
});

describe("row-level security holds against SQL written to reach across accounts", () => {
  const conn = {
    query: async (sql: string, params: unknown[] = []) => {
      const r = await h.pglite.query(sql, params);
      return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length };
    },
  };
  /** Run `fn` inside a transaction bound to `who`, exactly as a request is — then roll back. */
  async function as<T>(who: typeof AMINA, fn: () => Promise<T>): Promise<T> {
    await h.pglite.query("BEGIN");
    try {
      await bindResearchUser(conn, who.id);
      return await fn();
    } finally { await h.pglite.query("ROLLBACK"); }
  }
  const q = async (sql: string, params: unknown[] = []) => (await h.pglite.query(sql, params)).rows;

  it("every research table is under row-level security, forced", async () => {
    const tables = (await h.pglite.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'research' AND c.relkind = 'r'`)).rows;
    expect(tables.length).toBeGreaterThanOrEqual(14);
    for (const t of tables) expect([t.relname, t.relrowsecurity, t.relforcerowsecurity]).toEqual([t.relname, true, true]);
  });

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
    const upd = await as(AMINA, () => h.pglite.query("UPDATE research.notes SET text = 'hijacked' WHERE user_id = $1", [BILAL.id]));
    expect(upd.affectedRows ?? 0).toBe(0);
    const del = await as(AMINA, () => h.pglite.query("DELETE FROM research.notes WHERE user_id = $1", [BILAL.id]));
    expect(del.affectedRows ?? 0).toBe(0);
    const bilals = (await h.pglite.query("SELECT text FROM research.notes WHERE user_id = $1", [BILAL.id])).rows as any[];
    expect(bilals.map((n) => n.text)).toEqual(["Bilal's own"]);
  });

  it("with no account bound, the research role sees nothing and can write nothing", async () => {
    await h.pglite.query("BEGIN");
    try {
      await h.pglite.query("SET LOCAL ROLE mqrg_research");
      expect((await h.pglite.query("SELECT 1 FROM research.notes")).rows).toEqual([]);
      await expect(h.pglite.query("INSERT INTO research.notes (id, verse_key, created_at, updated_at) VALUES ('x', '1:1', 1, 1)"))
        .rejects.toThrow();
    } finally { await h.pglite.query("ROLLBACK"); }
  });

  it("the research role can't escape: no superuser, no bypass, no other tables", async () => {
    const role = (await h.pglite.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'mqrg_research'")).rows[0]!;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    await expect(as(AMINA, () => q("SELECT email FROM public.users"))).rejects.toThrow(/permission denied/);
    // turning row_security off doesn't turn the policy off for a non-owner: it makes reads that
    // would be filtered fail instead of returning another account's rows
    await expect(as(AMINA, async () => {
      await h.pglite.query("SET LOCAL row_security = off");
      return q("SELECT id FROM research.notes");
    })).rejects.toThrow(/row-level security/);
  });

  it("deleting an account deletes its research", async () => {
    const GONE = { id: "55555555-5555-4555-8555-555555555555", email: "gone@example.org", name: "Gone" };
    await h.addUser(GONE);
    await client(h.as(GONE)).put("/research/notes/g1", { id: "g1", verseKey: "1:1", text: "soon gone" });
    expect((await h.pglite.query("SELECT 1 FROM research.notes WHERE user_id = $1", [GONE.id])).rows).toHaveLength(1);
    await h.pglite.query("DELETE FROM users WHERE id = $1", [GONE.id]);
    expect((await h.pglite.query("SELECT 1 FROM research.notes WHERE user_id = $1", [GONE.id])).rows).toHaveLength(0);
  });
});

describe("the AI boundary: a token may only propose", () => {
  const ai = () => client(h.as(AMINA, "token"));

  it("adds a note — tagged as the AI's, awaiting review", async () => {
    const res = await ai().put("/research/notes/ai_n1", { id: "ai_n1", verseKey: "2:2", text: "a thought", source: "me" });
    expect(res.status).toBe(200);
    const proposed = await amina().get("/research/proposed") as { notes: { id: string }[] };
    expect(proposed.notes.map((n) => n.id)).toContain("ai_n1");
  });

  it("can't overwrite the reader's own note", async () => {
    const res = await ai().put("/research/notes/q1", { id: "q1", verseKey: "55:13", text: "rewritten by ai" });
    expect(res.status).toBe(403);
  });

  it("never makes an indication primary — even the first one for a root", async () => {
    await ai().put("/research/indications/ai_i1", { id: "ai_i1", root: "نذر", label: "vow", primary: true });
    const d = await amina().get("/research/indications/ai_i1") as { primary: boolean; source: string };
    expect(d).toMatchObject({ primary: false, source: "ai" });
    expect((await ai().put("/research/indications/ai_i1/primary")).status).toBe(403);
  });

  it("can't delete, accept its own proposals, publish, or change settings", async () => {
    for (const [method, path, body] of [
      ["DELETE", "/research/notes/ai_n1"], ["DELETE", "/research/cases/c1"],
      ["PUT", "/research/proposed/note/ai_n1/accept"],
      ["PUT", "/research/submission-log/ai_n1", { submissionId: "s", contentHash: "h" }],
      ["PUT", "/research/settings/reading", { value: 1 }],
      ["PUT", "/research/root-meanings/hdy", { meaning: "ai says" }],
    ] as [string, string, unknown?][]) {
      expect((await ai().send(method, path, body)).status, `${method} ${path}`).toBe(403);
    }
  });

  it("on the reader's case: may add its own items, never touch theirs or the conclusions", async () => {
    const mine = { id: "c_mine", subject: { type: "root", value: "رحم" }, title: "mine", verdict: "my verdict",
      status: "partial", formResearch: { "رَحْمَة": { status: "established", meaning: "mercy" } },
      cards: [{ id: "card_me", verseKey: "1:1" }], slips: [], threads: [], clusters: [] };
    await amina().put("/research/cases/c_mine", mine);
    // adding its own card, while trying to rewrite the verdict: the card lands, the verdict doesn't
    const add = await ai().put("/research/cases/c_mine", { ...mine, verdict: "ai verdict", status: "closed", formResearch: {},
      cards: [...mine.cards, { id: "card_ai", verseKey: "1:2", source: "ai" }] });
    expect(add.status).toBe(200);
    const after = await amina().get("/research/cases/c_mine") as Record<string, any>;
    expect(after.cards.map((c: any) => c.id)).toEqual(["card_me", "card_ai"]);
    expect(after).toMatchObject({ verdict: "my verdict", status: "partial", title: "mine" });
    expect(after.formResearch).toEqual(mine.formResearch);
    // removing or editing the reader's card is refused
    expect((await ai().put("/research/cases/c_mine", { ...after, cards: [after.cards[1]] })).status).toBe(403);
    expect((await ai().put("/research/cases/c_mine", { ...after, cards: [{ ...after.cards[0], verseKey: "9:9" }, after.cards[1]] })).status).toBe(403);
    // an untagged new item is refused too
    expect((await ai().put("/research/cases/c_mine", { ...after, cards: [...after.cards, { id: "sneaky", verseKey: "3:3" }] })).status).toBe(403);
  });

  it("may edit a motif it proposed, but not the reader's", async () => {
    await ai().put("/research/motifs/ai_m", { id: "ai_m", name: "ai grouping" });
    expect((await ai().put("/research/motifs/ai_m/roots/قلب")).status).toBe(200);
    await amina().put("/research/motifs/m_me", { id: "m_me", name: "mine" });
    expect((await ai().put("/research/motifs/m_me/roots/قلب")).status).toBe(403);
    expect((await ai().put("/research/motifs/m_me", { id: "m_me", name: "renamed by ai" })).status).toBe(403);
  });
});
