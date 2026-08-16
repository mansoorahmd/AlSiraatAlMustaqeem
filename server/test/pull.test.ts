// Phase 6 — applying a pull, and the divergence it reveals.
//
// The guarantees that matter:
//   • a pull writes ONLY derived_* tables — your own work is untouched, always
//   • applying is idempotent, so re-delivering a row (which the cursor deliberately allows)
//     changes nothing
//   • dropping everything pulled is safe: a resync rebuilds it and no research is lost
//   • "where I stand apart" shows both readings side by side and changes NEITHER

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "../src/db.js";
import { ResearchStore } from "../src/research.js";

let db: Db;
let store: ResearchStore;

const page = (over: Record<string, unknown> = {}) => ({
  cursor: 12,
  globalForms: [{
    subjectKind: "form", subjectValue: "هُدًى", claimId: "clm_a", version: 1,
    meaning: "guidance", authorId: "them", establishedAt: new Date().toISOString(),
    payload: { meaning: "guidance", evidence: [{ verseKey: "2:2" }], futureField: "kept" },
    schemaVersion: 1, seq: 11,
  }],
  dissents: [{
    id: "dsn_1", claimId: "clm_a", claimVersion: 1, authorId: "someone",
    payload: { comment: "6:71 reads against this" },
    createdAt: new Date().toISOString(), schemaVersion: 1, seq: 12,
  }],
  ...over,
});

beforeEach(() => {
  db = new Db(join(mkdtempSync(join(tmpdir(), "alsiraat-pull-")), "research.db"));
  store = new ResearchStore(db);
});

describe("applying a pull", () => {
  it("stores the group's reading and advances the cursor", () => {
    const out = store.applyPull(page());
    expect(out).toMatchObject({ globalForms: 1, dissents: 1, cursor: 12 });

    const g = store.groupReading("form", "هُدًى")!;
    expect(g.meaning).toBe("guidance");
    expect(g.dissents).toBe(1);
    expect(store.syncPosition("main")).toBe(12);
  });

  it("is idempotent — the same page twice changes nothing", () => {
    store.applyPull(page());
    store.applyPull(page());
    expect(db.scalar<number>("SELECT COUNT(*) FROM derived_global_forms")).toBe(1);
    expect(db.scalar<number>("SELECT COUNT(*) FROM derived_dissents")).toBe(1);
  });

  it("keeps unknown payload fields verbatim (an old client must not drop what a new one wrote)", () => {
    store.applyPull(page());
    const raw = db.scalar<string>("SELECT payload FROM derived_global_forms")!;
    expect(JSON.parse(raw)).toMatchObject({ futureField: "kept" });
  });

  it("a later page replaces the reading when the group changes its mind", () => {
    store.applyPull(page());
    store.applyPull(page({
      cursor: 20,
      globalForms: [{
        subjectKind: "form", subjectValue: "هُدًى", claimId: "clm_b", version: 1,
        meaning: "a giving of direction", authorId: "other",
        establishedAt: new Date().toISOString(), payload: { meaning: "a giving of direction" },
        schemaVersion: 1, seq: 19,
      }],
      dissents: [],
    }));
    expect(store.groupReading("form", "هُدًى")!.meaning).toBe("a giving of direction");
    expect(db.scalar<number>("SELECT COUNT(*) FROM derived_global_forms")).toBe(1); // one per subject
  });
});

describe("the write boundary holds", () => {
  it("a pull never touches the reader's own tables", () => {
    store.saveNote({ id: "n1", verseKey: "2:2", kind: "note", text: "mine" });
    const before = {
      notes: db.scalar<number>("SELECT COUNT(*) FROM notes"),
      cases: db.scalar<number>("SELECT COUNT(*) FROM cases"),
      forms: db.scalar<number>("SELECT COUNT(*) FROM form_research"),
      indications: db.scalar<number>("SELECT COUNT(*) FROM word_indications"),
    };

    store.applyPull(page());

    expect({
      notes: db.scalar<number>("SELECT COUNT(*) FROM notes"),
      cases: db.scalar<number>("SELECT COUNT(*) FROM cases"),
      forms: db.scalar<number>("SELECT COUNT(*) FROM form_research"),
      indications: db.scalar<number>("SELECT COUNT(*) FROM word_indications"),
    }).toEqual(before);
    expect(store.listNotes({ verse: "2:2" })[0]!.text).toBe("mine");
  });

  it("dropping everything pulled loses no research, and a resync starts clean", () => {
    store.saveNote({ id: "n1", verseKey: "2:2", kind: "note", text: "mine" });
    store.applyPull(page());

    store.resetPulled();

    expect(store.groupReading("form", "هُدًى")).toBeUndefined();
    expect(store.syncPosition("main")).toBe(0);              // full resync next time
    expect(store.listNotes({ verse: "2:2" })[0]!.text).toBe("mine");  // untouched
  });
});

describe("where I stand apart", () => {
  /** Establish a form locally, the way the case board does. */
  const establishLocally = (lemma: string, meaning: string) => {
    store.saveCase({
      id: "c1", subject: { type: "root", value: "هدي" },
      formResearch: { [lemma]: { status: "established", meaning, establishedAt: Date.now() } },
    });
  };

  it("lists a form where my reading and the group's differ, showing both", () => {
    establishLocally("هُدًى", "guidance as an act");
    store.applyPull(page());                                  // the group says "guidance"

    const [d] = store.divergences();
    expect(d).toMatchObject({
      lemma: "هُدًى", mine: "guidance as an act", theirs: "guidance", dissents: 1,
    });
  });

  it("says nothing when the readings agree", () => {
    establishLocally("هُدًى", "guidance");
    store.applyPull(page());
    expect(store.divergences()).toHaveLength(0);
  });

  it("ignores case and surrounding space — a divergence must be a real difference", () => {
    establishLocally("هُدًى", "  Guidance  ");
    store.applyPull(page());
    expect(store.divergences()).toHaveLength(0);
  });

  it("only considers forms I have actually established", () => {
    store.saveCase({
      id: "c2", subject: { type: "root", value: "هدي" },
      formResearch: { "هُدًى": { status: "open", meaning: "still thinking" } },
    });
    store.applyPull(page());
    expect(store.divergences()).toHaveLength(0);
  });

  it("changes NEITHER reading — it only reports", () => {
    establishLocally("هُدًى", "guidance as an act");
    store.applyPull(page());
    store.divergences();

    expect(store.formStatus().find((f) => f.lemma === "هُدًى")!.meaning).toBe("guidance as an act");
    expect(store.groupReading("form", "هُدًى")!.meaning).toBe("guidance");
  });
});
