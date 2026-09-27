// Research store: round-trip cases (+ form-status), trails, and notes
// (answers, root/lemma cross-refs) against a throwaway DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Db } from "../src/db.js";
import { ResearchStore } from "../src/research.js";
import { sqliteResearch } from "../src/research-db.js";

let dir: string;
let db: Db;
let store: ResearchStore;

beforeAll(async () => {
  dir = mkdtempSync(resolve(tmpdir(), "research-"));
  db = new Db(resolve(dir, "research.db"));
  store = await ResearchStore.open(sqliteResearch(db));
});
afterAll(() => {
  // close the connection first — Windows locks the file until we do
  db.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    /* best-effort temp cleanup; a leftover temp dir is harmless */
  }
});

describe("research store round-trip", () => {
  it("cases + form-status + revisions", async () => {
    (await store.saveCase({
      id: "c1", subject: { type: "root", value: "امم" }, title: "ummah",
      status: "open", formResearch: { "أُمَّة": { status: "established", meaning: "community" } },
    }));
    expect((await store.listCases()).map((c) => c.id)).toEqual(["c1"]);
    expect((await store.formStatus())).toHaveLength(1);
    // change an established meaning → a revision is recorded
    (await store.saveCase({
      id: "c1", subject: { type: "root", value: "امم" }, title: "ummah", status: "open",
      formResearch: { "أُمَّة": { status: "established", meaning: "a measured middle community" } },
    }));
    expect((await store.revisions("c1", "أُمَّة"))).toHaveLength(1);
    expect((await store.deleteCase("c1"))).toBe(true);
    expect((await store.listCases())).toHaveLength(0);
  });

  it("trails", async () => {
    (await store.saveTrail({ id: "t1", name: "siraj", hops: [{ verseKey: "25:61", wordPosition: 5 }] }));
    expect((await store.listTrails()).map((t) => t.id)).toEqual(["t1"]);
    expect((await store.deleteTrail("t1"))).toBe(true);
  });

  it("notes: answers + root/lemma cross-refs", async () => {
    (await store.saveNote({ id: "q1", verseKey: "55:13", wordPosition: 3, kind: "question", text: "meaning?", lemma: "ءَالَآء", root: "الو" }));
    (await store.saveNote({ id: "q2", verseKey: "55:16", wordPosition: 3, kind: "question", text: "again", lemma: "ءَالَآء", root: "الو" }));
    (await store.saveNote({ id: "n1", verseKey: "7:69", wordPosition: 5, kind: "note", text: "other form", lemma: "ءَالَاء", root: "الو" }));
    // answer q1 → resolved + stored answer
    const q1 = (await store.listNotes({ verse: "55:13" }))[0]!;
    (await store.saveNote({ ...q1, answer: "the favours", resolved: true }));
    expect((await store.listNotes({ verse: "55:13" }))[0]!.answer).toBe("the favours");
    expect((await store.listNotes({ verse: "55:13" }))[0]!.resolved).toBe(true);
    expect((await store.listNotes({ root: "الو" })).map((n) => n.id).sort()).toEqual(["n1", "q1", "q2"]);
    expect((await store.listNotes({ lemma: "ءَالَآء" })).map((n) => n.id).sort()).toEqual(["q1", "q2"]);
    expect((await store.deleteNote("n1"))).toBe(true);
  });

  it("user root meanings: set / get / clear", async () => {
    expect((await store.getRootMeaning("hdy")).meaning).toBe(""); // none yet
    (await store.setRootMeaning("hdy", "to guide, show the way"));
    expect((await store.getRootMeaning("hdy")).meaning).toBe("to guide, show the way");
    expect((await store.listRootMeanings()).map((r) => r.root)).toContain("hdy");
    // saving empty clears it
    (await store.setRootMeaning("hdy", "   "));
    expect((await store.getRootMeaning("hdy")).meaning).toBe("");
    expect((await store.listRootMeanings()).map((r) => r.root)).not.toContain("hdy");
  });

  it("motifs: create, tag roots, query by root, remove, delete", async () => {
    (await store.saveMotif({ id: "m1", name: "Light & darkness", note: "" }));
    (await store.addMotifRoot("m1", "nwr"));
    (await store.addMotifRoot("m1", "Zlm"));
    (await store.addMotifRoot("m1", "nwr")); // idempotent
    const m = (await store.listMotifs()).find((x) => x.id === "m1")!;
    expect(m.roots.sort()).toEqual(["Zlm", "nwr"]);
    expect((await store.motifsForRoot("nwr")).map((x) => x.id)).toEqual(["m1"]);
    (await store.removeMotifRoot("m1", "Zlm"));
    expect((await store.listMotifs()).find((x) => x.id === "m1")!.roots).toEqual(["nwr"]);
    expect((await store.deleteMotif("m1"))).toBe(true);
    expect((await store.motifsForRoot("nwr"))).toHaveLength(0);
  });

  it("motifs carry a source; getMotif reads it back", async () => {
    (await store.saveMotif({ id: "mine", name: "Mine", note: "" }));                 // default 'me'
    (await store.saveMotif({ id: "ai", name: "Proposed", note: "", source: "ai" }));
    expect((await store.getMotif("mine"))!.source).toBe("me");
    expect((await store.getMotif("ai"))!.source).toBe("ai");
    // re-saving doesn't flip an existing motif's source
    (await store.saveMotif({ id: "ai", name: "Renamed", note: "" }));
    expect((await store.getMotif("ai"))!.source).toBe("ai");
    expect((await store.getMotif("nope"))).toBeUndefined();
    (await store.deleteMotif("mine")); (await store.deleteMotif("ai"));
  });

  it("refinements match by SURFACE form, falling back to the lemma key", async () => {
    // a root indication with two per-form refinements: one keyed by a surface form (new),
    // one keyed by a lemma (as written before the switch)
    const ind = (await store.saveIndication({ id: "ind_s", root: "صلب", label: "backbone/loins", meaning: "the core" }));
    (await store.saveRefinement({ id: "r_surface", parentId: ind.id, lemma: "أَصْلَٰبِ", label: "loins", meaning: "plural" }));
    (await store.saveRefinement({ id: "r_legacy", parentId: ind.id, lemma: "صُّلْب", label: "backbone", meaning: "singular" }));

    // surface given → the surface-keyed refinement wins
    const bySurface = (await store.indicationsForWord("صُّلْب", "صلب", "أَصْلَٰبِ"))
      .rootIndications.find((s: { id: string }) => s.id === ind.id);
    expect(bySurface.refinement.meaning).toBe("plural");

    // surface with no own refinement → falls back to the lemma key
    const byLemma = (await store.indicationsForWord("صُّلْب", "صلب", "صُّلْبِ"))
      .rootIndications.find((s: { id: string }) => s.id === ind.id);
    expect(byLemma.refinement.meaning).toBe("singular");

    // no surface at all → still matches by lemma (old callers keep working)
    const legacy = (await store.indicationsForWord("صُّلْب", "صلب"))
      .rootIndications.find((s: { id: string }) => s.id === ind.id);
    expect(legacy.refinement.meaning).toBe("singular");
  });
});
