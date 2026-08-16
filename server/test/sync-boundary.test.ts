// THE SAFETY INVARIANT (SHARED_RESEARCH.md §8, SHARED_RESEARCH_SCHEMA.md §2).
//
// Sync is a second writer that is not you. Whatever the remote sends, it must be structurally
// incapable of touching your own work: it may only ever write `derived_*` tables. Your cases,
// notes, indications, trails, motifs and — above all — your established meanings are yours.
//
// The `derived_` prefix is the audit handle. This test is why it exists: the protection is
// mechanical, not a matter of remembering. If someone later teaches sync to write `notes`
// directly, this fails.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "../src/db.js";
import { ResearchStore } from "../src/research.js";

const dir = mkdtempSync(join(tmpdir(), "alsiraat-syncb-"));
let db: Db;
let store: ResearchStore;

/** Every table a pull is allowed to write. Adding one here is a deliberate decision. */
const WRITABLE_BY_SYNC = ["derived_submissions"];

/** Tables holding the reader's OWN scholarship. Sync must never write these. */
const MINE = [
  "cases", "form_research", "form_revisions", "notes", "trails",
  "user_root_meanings", "motifs", "motif_roots", "word_indications",
  "compare_sets", "compare_items", "owner", "settings",
];

beforeAll(() => {
  db = new Db(join(dir, "research.db"));
  store = new ResearchStore(db);
});

describe("the write boundary", () => {
  it("every table sync may write is named derived_*", () => {
    for (const t of WRITABLE_BY_SYNC) expect(t.startsWith("derived_")).toBe(true);
  });

  it("no table holding the reader's own work is named derived_*", () => {
    for (const t of MINE) expect(t.startsWith("derived_")).toBe(false);
  });

  it("the derived_ prefix actually partitions the schema — nothing is unaccounted for", () => {
    const tables = db
      .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .map((r) => r.name);
    const derived = tables.filter((t) => t.startsWith("derived_"));
    const mine = tables.filter((t) => !t.startsWith("derived_"));

    // the two lists above describe the whole database: if a table appears that neither list
    // knows about, someone added it without deciding which side of the boundary it is on
    for (const t of derived) expect(WRITABLE_BY_SYNC, `unclassified derived table: ${t}`).toContain(t);
    for (const t of mine) expect(MINE, `unclassified table: ${t}`).toContain(t);
  });
});

describe("what sync may never do", () => {
  it("never marks a form established — establishment is the reader's act alone", () => {
    // the store exposes no way to write form_research except through saveCase (the reader's
    // own board), and nothing in the pull path touches it
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    expect(api).not.toContain("applyRemoteFormResearch");
    expect(api).not.toContain("establishFromRemote");
  });

  it("never sets an indication primary, or edits the reader's records", () => {
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    for (const forbidden of [
      "applyRemoteIndication", "applyRemoteNote", "applyRemoteCase",
      "setPrimaryFromRemote", "deleteFromRemote",
    ]) {
      expect(api).not.toContain(forbidden);
    }
  });

  it("the only sync-facing writer is the submission ledger", () => {
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    const remoteWriters = api.filter((m) => /remote|sync|pull/i.test(m));
    expect(remoteWriters).toEqual([]); // nothing yet: Phase 6 adds pulls, and they go to derived_*
  });
});

describe("the reader's work is untouched by anything sync-shaped", () => {
  it("a note written by the reader keeps origin='local' and their author id", () => {
    store.saveNote({ id: "n1", verseKey: "2:2", kind: "note", text: "mine" });
    const [n] = store.listNotes({ verse: "2:2" });
    expect(n!.origin).toBe("local");
    expect(n!.authorId).toBe(store.localId);
  });

  it("the submission ledger is drop-safe: clearing it loses no research", () => {
    store.recordSubmission({ localRef: "n1", submissionId: "sub_x", contentHash: "h", kind: "note" });
    expect(store.getSubmissionFor("n1")).toBeTruthy();

    db.exec("DELETE FROM derived_submissions");          // simulate dropping every derived table

    expect(store.getSubmissionFor("n1")).toBeUndefined();
    const [n] = store.listNotes({ verse: "2:2" });       // the work itself is still there
    expect(n!.text).toBe("mine");
  });
});
