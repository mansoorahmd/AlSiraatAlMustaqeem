// Research store: round-trip cases (+ form-status), trails, and notes
// (answers, root/lemma cross-refs) against a throwaway DB.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Db } from "../src/db.js";
import { ResearchStore } from "../src/research.js";

let dir: string;
let db: Db;
let store: ResearchStore;

beforeAll(() => {
  dir = mkdtempSync(resolve(tmpdir(), "research-"));
  db = new Db(resolve(dir, "research.db"));
  store = new ResearchStore(db);
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
  it("cases + form-status + revisions", () => {
    store.saveCase({
      id: "c1", subject: { type: "root", value: "امم" }, title: "ummah",
      status: "open", formResearch: { "أُمَّة": { status: "established", meaning: "community" } },
    });
    expect(store.listCases().map((c) => c.id)).toEqual(["c1"]);
    expect(store.formStatus()).toHaveLength(1);
    // change an established meaning → a revision is recorded
    store.saveCase({
      id: "c1", subject: { type: "root", value: "امم" }, title: "ummah", status: "open",
      formResearch: { "أُمَّة": { status: "established", meaning: "a measured middle community" } },
    });
    expect(store.revisions("c1", "أُمَّة")).toHaveLength(1);
    expect(store.deleteCase("c1")).toBe(true);
    expect(store.listCases()).toHaveLength(0);
  });

  it("trails", () => {
    store.saveTrail({ id: "t1", name: "siraj", hops: [{ verseKey: "25:61", wordPosition: 5 }] });
    expect(store.listTrails().map((t) => t.id)).toEqual(["t1"]);
    expect(store.deleteTrail("t1")).toBe(true);
  });

  it("notes: answers + root/lemma cross-refs", () => {
    store.saveNote({ id: "q1", verseKey: "55:13", wordPosition: 3, kind: "question", text: "meaning?", lemma: "ءَالَآء", root: "الو" });
    store.saveNote({ id: "q2", verseKey: "55:16", wordPosition: 3, kind: "question", text: "again", lemma: "ءَالَآء", root: "الو" });
    store.saveNote({ id: "n1", verseKey: "7:69", wordPosition: 5, kind: "note", text: "other form", lemma: "ءَالَاء", root: "الو" });
    // answer q1 → resolved + stored answer
    const q1 = store.listNotes({ verse: "55:13" })[0]!;
    store.saveNote({ ...q1, answer: "the favours", resolved: true });
    expect(store.listNotes({ verse: "55:13" })[0]!.answer).toBe("the favours");
    expect(store.listNotes({ verse: "55:13" })[0]!.resolved).toBe(true);
    expect(store.listNotes({ root: "الو" }).map((n) => n.id).sort()).toEqual(["n1", "q1", "q2"]);
    expect(store.listNotes({ lemma: "ءَالَآء" }).map((n) => n.id).sort()).toEqual(["q1", "q2"]);
    expect(store.deleteNote("n1")).toBe(true);
  });

  it("user root meanings: set / get / clear", () => {
    expect(store.getRootMeaning("hdy").meaning).toBe(""); // none yet
    store.setRootMeaning("hdy", "to guide, show the way");
    expect(store.getRootMeaning("hdy").meaning).toBe("to guide, show the way");
    expect(store.listRootMeanings().map((r) => r.root)).toContain("hdy");
    // saving empty clears it
    store.setRootMeaning("hdy", "   ");
    expect(store.getRootMeaning("hdy").meaning).toBe("");
    expect(store.listRootMeanings().map((r) => r.root)).not.toContain("hdy");
  });

  it("motifs: create, tag roots, query by root, remove, delete", () => {
    store.saveMotif({ id: "m1", name: "Light & darkness", note: "" });
    store.addMotifRoot("m1", "nwr");
    store.addMotifRoot("m1", "Zlm");
    store.addMotifRoot("m1", "nwr"); // idempotent
    const m = store.listMotifs().find((x) => x.id === "m1")!;
    expect(m.roots.sort()).toEqual(["Zlm", "nwr"]);
    expect(store.motifsForRoot("nwr").map((x) => x.id)).toEqual(["m1"]);
    store.removeMotifRoot("m1", "Zlm");
    expect(store.listMotifs().find((x) => x.id === "m1")!.roots).toEqual(["nwr"]);
    expect(store.deleteMotif("m1")).toBe(true);
    expect(store.motifsForRoot("nwr")).toHaveLength(0);
  });
});
