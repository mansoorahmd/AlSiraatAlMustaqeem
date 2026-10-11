// What the reader's research does, through /research on Postgres (PGlite): cases and their form
// research, trails, notes, root meanings, motifs, indications and refinements, comparisons,
// settings, provenance, and the outbound ledgers.

import { describe, it, expect, beforeAll } from "vitest";
import { researchHarness, client } from "./research-harness.js";

const READER = { id: "66666666-6666-4666-8666-666666666666", email: "reader@example.org", name: "Reader" };
let r: ReturnType<typeof client>;
let h: Awaited<ReturnType<typeof researchHarness>>;
const B = "/research";
const q = encodeURIComponent;
const json = async (res: Response | Promise<Response>) => (await res).json() as Promise<any>;

beforeAll(async () => {
  h = await researchHarness();
  await h.addUser(READER);
  r = client(h.as(READER));
});

describe("cases, trails, notes, root meanings", () => {
  it("cases + form-status + revisions", async () => {
    const c1 = (formMeaning: string) => ({
      id: "c1", subject: { type: "root", value: "امم" }, title: "ummah", status: "open",
      formResearch: { "أُمَّة": { status: "established", meaning: formMeaning } },
    });
    await r.put(`${B}/cases/c1`, c1("community"));
    expect((await r.get(`${B}/cases`)).map((c: any) => c.id)).toEqual(["c1"]);
    expect(await r.get(`${B}/form-status`)).toHaveLength(1);
    // change an established meaning → a revision is recorded
    await r.put(`${B}/cases/c1`, c1("a measured middle community"));
    expect(await r.get(`${B}/cases/c1/forms/${q("أُمَّة")}/revisions`)).toEqual([
      { meaning: "community", replaced_at: expect.any(Number) }]);
    expect((await r.del(`${B}/cases/c1`)).status).toBe(200);
    expect(await r.get(`${B}/cases`)).toHaveLength(0);
    expect(await r.get(`${B}/form-status`)).toHaveLength(0);   // its form research went with it
    expect((await r.put(`${B}/cases/c9`, { id: "other" })).status).toBe(400);
  });

  it("trails", async () => {
    await r.put(`${B}/trails/t1`, { id: "t1", name: "siraj", hops: [{ verseKey: "25:61", wordPosition: 5 }] });
    expect((await r.get(`${B}/trails`)).map((t: any) => t.id)).toEqual(["t1"]);
    expect((await r.del(`${B}/trails/t1`)).status).toBe(200);
    expect((await r.del(`${B}/trails/t1`)).status).toBe(404);
  });

  it("notes: answers + root/lemma cross-refs", async () => {
    await r.put(`${B}/notes/q1`, { id: "q1", verseKey: "55:13", wordPosition: 3, kind: "question", text: "meaning?", lemma: "ءَالَآء", root: "الو" });
    await r.put(`${B}/notes/q2`, { id: "q2", verseKey: "55:16", wordPosition: 3, kind: "question", text: "again", lemma: "ءَالَآء", root: "الو" });
    await r.put(`${B}/notes/n1`, { id: "n1", verseKey: "7:69", wordPosition: 5, kind: "note", text: "other form", lemma: "ءَالَاء", root: "الو" });
    const q1 = (await r.get(`${B}/notes?verse=55:13`))[0];
    await r.put(`${B}/notes/q1`, { ...q1, answer: "the favours", resolved: true });
    const back = (await r.get(`${B}/notes?verse=55:13`))[0];
    expect(back).toMatchObject({ answer: "the favours", resolved: true });
    expect((await r.get(`${B}/notes?root=${q("الو")}`)).map((n: any) => n.id).sort()).toEqual(["n1", "q1", "q2"]);
    expect((await r.get(`${B}/notes?lemma=${q("ءَالَآء")}`)).map((n: any) => n.id).sort()).toEqual(["q1", "q2"]);
    expect((await r.del(`${B}/notes/n1`)).status).toBe(200);
    expect((await h.as(READER).request(`${B}/notes/n1`)).status).toBe(404);
  });

  it("user root meanings: set / get / clear", async () => {
    expect((await r.get(`${B}/root-meanings/hdy`)).meaning).toBe("");
    await r.put(`${B}/root-meanings/hdy`, { meaning: "to guide, show the way" });
    expect((await r.get(`${B}/root-meanings/hdy`)).meaning).toBe("to guide, show the way");
    expect((await r.get(`${B}/root-meanings`)).map((m: any) => m.root)).toContain("hdy");
    await r.put(`${B}/root-meanings/hdy`, { meaning: "   " });   // saving empty clears it
    expect((await r.get(`${B}/root-meanings/hdy`)).meaning).toBe("");
    expect((await r.get(`${B}/root-meanings`)).map((m: any) => m.root)).not.toContain("hdy");
  });
});

describe("motifs", () => {
  it("create, tag roots, query by root, remove, delete", async () => {
    await r.put(`${B}/motifs/m1`, { id: "m1", name: "Light & darkness", note: "" });
    for (const root of ["nwr", "Zlm", "nwr"]) await r.put(`${B}/motifs/m1/roots/${root}`);   // idempotent
    expect((await r.get(`${B}/motifs/m1`)).roots.sort()).toEqual(["Zlm", "nwr"]);
    expect((await r.get(`${B}/motifs/by-root/nwr`)).map((m: any) => m.id)).toEqual(["m1"]);
    await r.del(`${B}/motifs/m1/roots/Zlm`);
    expect((await r.get(`${B}/motifs/m1`)).roots).toEqual(["nwr"]);
    expect((await r.del(`${B}/motifs/m1`)).status).toBe(200);
    expect(await r.get(`${B}/motifs/by-root/nwr`)).toHaveLength(0);
  });

  it("carry a source that re-saving doesn't flip", async () => {
    await r.put(`${B}/motifs/mine`, { id: "mine", name: "Mine", note: "" });
    await r.put(`${B}/motifs/ai`, { id: "ai", name: "Proposed", note: "", source: "ai" });
    expect((await r.get(`${B}/motifs/mine`)).source).toBe("me");
    expect((await r.get(`${B}/motifs/ai`)).source).toBe("ai");
    await r.put(`${B}/motifs/ai`, { id: "ai", name: "Renamed", note: "" });
    expect((await r.get(`${B}/motifs/ai`)).source).toBe("ai");
    expect((await h.as(READER).request(`${B}/motifs/nope`)).status).toBe(404);
  });
});

describe("word indications (root + refinements)", () => {
  const forWord = (lemma: string, root: string) => `${B}/indications/for-word?lemma=${q(lemma)}&root=${q(root)}`;

  it("root indications: first is primary, second isn't, primary can switch", async () => {
    expect(await json(r.put(`${B}/indications/A`, { id: "A", root: "فلح", label: "attain", meaning: "reach the goal" })))
      .toMatchObject({ scope: "root", primary: true });
    expect((await json(r.put(`${B}/indications/Bx`, { id: "Bx", root: "فلح", label: "cultivate", meaning: "till the soil" }))).primary)
      .toBe(false);
    await r.put(`${B}/indications/Bx/primary`);
    expect((await r.get(`${B}/indications/gloss`)).roots.find((x: any) => x.root === "فلح").text).toBe("cultivate");
    await r.put(`${B}/indications/A/primary`);   // back, so later assertions use A as primary
  });

  it("a refinement gives a form its own shade of a root indication", async () => {
    const ref = await json(r.put(`${B}/refinements/rA`, { id: "rA", parentId: "A", lemma: "أَفْلَحَ", label: "he prospered", meaning: "attained the aim" }));
    expect(ref).toMatchObject({ scope: "lemma", parentId: "A", lemma: "أَفْلَحَ" });
    const a = (await r.get(forWord("أَفْلَحَ", "فلح"))).rootIndications.find((s: any) => s.id === "A");
    expect(a.refinement.label).toBe("he prospered");
    expect(a.refinedCount).toBe(1);
    expect((await r.get(forWord("مُفْلِحُون", "فلح"))).rootIndications.find((s: any) => s.id === "A").refinement).toBe(null);
    // re-saving the same form updates the one refinement, keeping its id
    await r.put(`${B}/refinements/rA2`, { id: "rA2", parentId: "A", lemma: "أَفْلَحَ", label: "he truly prospered" });
    expect((await r.get(`${B}/indications/A/refinements`)).map((x: any) => [x.id, x.label])).toEqual([["rA", "he truly prospered"]]);
  });

  it("gloss uses the refinement for a refined form, the indication text otherwise", async () => {
    const g = await r.get(`${B}/indications/gloss`);
    expect(g.roots.find((x: any) => x.root === "فلح").text).toBe("attain");
    expect(g.refinements.find((x: any) => x.root === "فلح" && x.lemma === "أَفْلَحَ").text).toBe("he truly prospered");
  });

  it("refinements match by SURFACE form, falling back to the lemma key", async () => {
    await r.put(`${B}/indications/ind_s`, { id: "ind_s", root: "صلب", label: "backbone/loins", meaning: "the core" });
    await r.put(`${B}/refinements/r_surface`, { id: "r_surface", parentId: "ind_s", lemma: "أَصْلَٰبِ", label: "loins", meaning: "plural" });
    await r.put(`${B}/refinements/r_legacy`, { id: "r_legacy", parentId: "ind_s", lemma: "صُّلْب", label: "backbone", meaning: "singular" });
    const meaning = async (surface?: string) =>
      (await r.get(`${forWord("صُّلْب", "صلب")}${surface ? `&surface=${q(surface)}` : ""}`))
        .rootIndications.find((s: any) => s.id === "ind_s").refinement.meaning;
    expect(await meaning("أَصْلَٰبِ")).toBe("plural");     // the surface-keyed refinement wins
    expect(await meaning("صُّلْبِ")).toBe("singular");      // no own refinement → the lemma key
    expect(await meaning()).toBe("singular");              // no surface at all → the lemma key
  });

  it("deleting a root indication removes its refinements and promotes another", async () => {
    await r.del(`${B}/indications/A`);
    const w = await r.get(forWord("أَفْلَحَ", "فلح"));
    expect(w.rootIndications.map((s: any) => s.id)).toEqual(["Bx"]);
    expect(w.rootIndications[0].primary).toBe(true);
    expect((await r.get(`${B}/indications/gloss`)).refinements.find((x: any) => x.lemma === "أَفْلَحَ")).toBeUndefined();
  });

  it("a rootless word keeps a standalone lemma indication", async () => {
    await r.put(`${B}/indications/L1`, { id: "L1", lemma: "مِن", label: "from/of", meaning: "origin or part" });
    const w = await r.get(`${B}/indications/for-word?lemma=${q("مِن")}`);
    expect(w.lemmaIndications).toHaveLength(1);
    expect(w.lemmaIndications[0].primary).toBe(true);
    expect((await r.get(`${B}/indications/gloss`)).lemmas.find((x: any) => x.lemma === "مِن").text).toBe("from/of");
  });

  it("the community layer is absent — the app merges it live", async () => {
    const w = await r.get(forWord("فَلَاح", "فلح"));
    expect([w.communityRoot, w.communityLemma]).toEqual([[], []]);
  });

  it("refinement requires an existing root indication (404); a root or lemma is required (422)", async () => {
    expect((await r.put(`${B}/refinements/bad`, { id: "bad", parentId: "nope", lemma: "x", label: "y" })).status).toBe(404);
    expect((await r.put(`${B}/indications/none`, { id: "none", label: "y" })).status).toBe(422);
  });
});

describe("provenance", () => {
  it("defaults to the reader ('me'), stamped with their account", async () => {
    const n = await json(r.put(`${B}/notes/p_mine`, { id: "p_mine", verseKey: "2:2", kind: "note", text: "mine" }));
    expect(n.source ?? "me").toBe("me");
    const back = (await r.get(`${B}/notes?verse=2:2`)).find((x: any) => x.id === "p_mine");
    expect(back).toMatchObject({ source: "me", authorId: READER.id, origin: "local" });
  });

  it("an AI proposal is listed for review, and accepting it makes it the reader's own", async () => {
    await r.put(`${B}/notes/p_ai`, { id: "p_ai", verseKey: "2:3", kind: "question", text: "from the model", source: "ai" });
    await r.put(`${B}/indications/p_ind`, { id: "p_ind", root: "علم", label: "ai idea", meaning: "", source: "ai" });
    const proposed = await r.get(`${B}/proposed`);
    expect(proposed.notes.map((x: any) => x.id)).toEqual(["p_ai"]);
    expect(proposed.indications.map((x: any) => x.id)).toEqual(["p_ind"]);
    expect((await r.put(`${B}/proposed/note/p_ai/accept`)).status).toBe(200);
    expect((await r.put(`${B}/proposed/indication/p_ind/accept`)).status).toBe(200);
    expect(await r.get(`${B}/proposed`)).toEqual({ notes: [], indications: [] });
    expect((await r.get(`${B}/notes?verse=2:3`))[0].source).toBe("me");
  });

  it("accepting something that isn't AI-proposed is a 404; an unknown kind is a 422", async () => {
    expect((await r.put(`${B}/proposed/note/p_mine/accept`)).status).toBe(404);
    expect((await r.put(`${B}/proposed/note/nope/accept`)).status).toBe(404);
    expect((await r.put(`${B}/proposed/bogus/x/accept`)).status).toBe(422);
  });
});

describe("comparisons", () => {
  const base = `${B}/compare-sets`;
  it("creates, fills, dedupes, removes and deletes", async () => {
    expect(await json(r.put(`${base}/s1`, { id: "s1", title: "near-synonyms" })))
      .toMatchObject({ id: "s1", title: "near-synonyms", count: 0 });
    await r.put(`${base}/s1/items/i1`, { kind: "ayah", ref: "2:2" });
    await r.put(`${base}/s1/items/i2`, { kind: "root", ref: "Elm" });
    // the same (kind, ref) again is ignored — keeping the first item's id
    expect((await json(r.put(`${base}/s1/items/i9`, { kind: "ayah", ref: "2:2" }))).id).toBe("i1");
    expect((await r.get(base)).find((x: any) => x.id === "s1").count).toBe(2);
    await r.del(`${base}/s1/items/i2`);
    expect((await r.get(`${base}/s1/items`)).map((x: any) => x.ref)).toEqual(["2:2"]);
    await r.del(`${base}/s1/items`);                      // clear empties but keeps the set
    expect(await r.get(`${base}/s1/items`)).toEqual([]);
    await r.del(`${base}/s1`);
    expect((await r.get(base)).find((x: any) => x.id === "s1")).toBeUndefined();
  });

  it("rejects an item with no kind/ref (422)", async () => {
    await r.put(`${base}/s2`, { id: "s2", title: "x" });
    expect((await r.put(`${base}/s2/items/bad`, { ref: "2:2" })).status).toBe(422);
  });
});

describe("settings", () => {
  const get = async (k: string) => (await r.get(`${B}/settings/${k}`)).value;
  it("round-trip objects and scalars, null when unknown, overwrite on repeat", async () => {
    const prefs = { script: "imlaei", myGlossOn: false, fontScale: 1.3 };
    expect((await r.put(`${B}/settings/reading`, { value: prefs })).status).toBe(200);
    expect(await get("reading")).toEqual(prefs);
    await r.put(`${B}/settings/activeCompareSet`, { value: "cmp_123" });
    expect(await get("activeCompareSet")).toBe("cmp_123");
    expect(await get("does-not-exist")).toBeNull();
    await r.put(`${B}/settings/reading`, { value: { fontScale: 2 } });
    expect(await get("reading")).toEqual({ fontScale: 2 });
  });
});

describe("the outbound ledgers: what the reader has offered upstream", () => {
  it("the submission log records, replaces on re-submit, and lists", async () => {
    expect(await r.get(`${B}/submission-log/note_never`)).toBeNull();
    expect((await r.put(`${B}/submission-log/note_1`, { submissionId: "sub_abc", contentHash: "h1", kind: "question" })).status).toBe(200);
    expect(await r.get(`${B}/submission-log/note_1`)).toMatchObject({
      localRef: "note_1", submissionId: "sub_abc", contentHash: "h1", kind: "question", status: "submitted",
      submittedAt: expect.any(Number),
    });
    await r.put(`${B}/submission-log/note_1`, { submissionId: "sub_def", contentHash: "h2" });
    expect(await r.get(`${B}/submission-log/note_1`)).toMatchObject({ submissionId: "sub_def", contentHash: "h2" });
    await r.put(`${B}/submission-log/note_2`, { submissionId: "sub_ghi", contentHash: "h9" });
    const all = await r.get(`${B}/submission-log`);
    expect(all.filter((x: any) => x.localRef === "note_1")).toHaveLength(1);   // the chain head, not a second row
    expect(all.map((x: any) => x.localRef)).toContain("note_2");
    expect((await r.put(`${B}/submission-log/note_3`, { submissionId: "sub_x" })).status).toBe(422);
    expect((await r.put(`${B}/submission-log/note_3`, { contentHash: "h" })).status).toBe(422);
  });

  it("the proposed-claims ledger updates in place", async () => {
    const post = (hash: string) => r.send("POST", `${B}/proposals`, { subjectKind: "root", subjectValue: "هدي", contentHash: hash });
    await post("abc"); await post("def");
    expect(await r.get(`${B}/proposals?subjectKind=root&subjectValue=${q("هدي")}`)).toMatchObject({ contentHash: "def" });
    expect(await r.get(`${B}/proposals?subjectKind=root&subjectValue=none`)).toBeNull();
  });

  it("the derived_ prefix partitions the schema: only the outbox tables carry it", async () => {
    const tables = (await h.pglite.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'research' ORDER BY table_name")).rows
      .map((t) => t.table_name);
    expect(tables.filter((t) => t.startsWith("derived_"))).toEqual(["derived_proposed_claims", "derived_submissions"]);
    expect(tables.filter((t) => !t.startsWith("derived_"))).toEqual([
      "cases", "compare_items", "compare_sets", "form_research", "form_revisions", "motif_roots", "motifs",
      "notes", "settings", "trails", "user_root_meanings", "word_indications"]);
  });
});
