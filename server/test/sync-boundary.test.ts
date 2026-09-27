// THE SAFETY INVARIANT (SHARED_RESEARCH.md §8, SHARED_RESEARCH_SCHEMA.md §2).
//
// With monetization the group's readings are no longer MIRRORED into research.db — community
// data (globally-established forms, dissents, peer indications, divergence) is read live from the
// remote and gated behind a plan (see remote/ + REMOTE.md). What remains of the sync world on
// this disk is only the reader's OWN outbound record: derived_submissions (what I've offered
// upstream) and derived_proposed_claims (readings I've proposed).
//
// The invariant is unchanged and, if anything, stronger: no one else's work lands here at all,
// and the `derived_` prefix still partitions the schema so a bug can never touch the one
// irreplaceable file. This test is why the prefix exists — the protection is mechanical.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "../src/db.js";
import { ResearchStore } from "../src/research.js";
import { sqliteResearch } from "../src/research-db.js";

const dir = mkdtempSync(join(tmpdir(), "alsiraat-syncb-"));
let db: Db;
let store: ResearchStore;

/** Every derived_* table that remains — each one the reader's OWN outbound record, drop-safe.
 *  Adding one here is a deliberate decision. */
const DERIVED = [
  "derived_submissions",     // my outbox: what I have offered upstream
  "derived_proposed_claims", // my outbox: readings I have proposed upstream
];

/** Tables holding the reader's own scholarship. Never named derived_*. */
const MINE = [
  "cases", "form_research", "form_revisions", "notes", "trails",
  "user_root_meanings", "motifs", "motif_roots", "word_indications",
  "compare_sets", "compare_items", "owner", "settings",
];

beforeAll(async () => {
  db = new Db(join(dir, "research.db"));
  store = await ResearchStore.open(sqliteResearch(db));
});

describe("the write boundary", () => {
  it("every remaining derived table is named derived_*", async () => {
    for (const t of DERIVED) expect(t.startsWith("derived_")).toBe(true);
  });

  it("no table holding the reader's own work is named derived_*", async () => {
    for (const t of MINE) expect(t.startsWith("derived_")).toBe(false);
  });

  it("the derived_ prefix actually partitions the schema — nothing is unaccounted for", async () => {
    const tables = db
      .query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .map((r) => r.name);
    // if a table appears that neither list knows about, someone added it without deciding which
    // side of the boundary it is on
    for (const t of tables.filter((t) => t.startsWith("derived_")))
      expect(DERIVED, `unclassified derived table: ${t}`).toContain(t);
    for (const t of tables.filter((t) => !t.startsWith("derived_")))
      expect(MINE, `unclassified table: ${t}`).toContain(t);
  });
});

describe("no one else's work can be written locally at all", () => {
  it("the store exposes no sync/pull/remote-facing write method", async () => {
    // The local mirror is gone: community data is read live from the remote, never applied here.
    // If someone re-adds a method that lands remote data on this disk, that is a deliberate act —
    // and if it writes anything but a derived_* outbox table, it does not belong.
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    const syncFacing = api.filter((m) => /remote|sync|pull/i.test(m));
    expect(syncFacing).toEqual([]);
  });

  it("no method exists to establish or re-author the reader's work from outside", async () => {
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    for (const forbidden of [
      "applyPull", "resetPulled", "applyRemoteFormResearch", "establishFromRemote",
      "applyRemoteIndication", "applyRemoteNote", "applyRemoteCase",
      "setPrimaryFromRemote", "deleteFromRemote",
    ]) expect(api).not.toContain(forbidden);
  });

  it("the community layer is absent from a word's indications — the app merges it live", async () => {
    (await store.saveIndication({ id: "ind_mine", root: "هدي", label: "guidance", meaning: "mine" }));
    const forWord = (await store.indicationsForWord("هُدًى", "هدي"));
    expect(forWord.rootIndications).toHaveLength(1);   // only mine
    expect(forWord.communityRoot).toEqual([]);          // never from a local mirror
    expect(forWord.communityLemma).toEqual([]);
  });
});

describe("the reader's OWN outbound ledgers are drop-safe", () => {
  it("the proposed-claims ledger records, updates in place, and drops without losing research", async () => {
    (await store.recordProposal({ subjectKind: "root", subjectValue: "هدي", contentHash: "abc" }));
    expect((await store.getProposal("root", "هدي"))!.contentHash).toBe("abc");
    (await store.recordProposal({ subjectKind: "root", subjectValue: "هدي", contentHash: "def" })); // replaces, never stacks
    expect((await store.getProposal("root", "هدي"))!.contentHash).toBe("def");

    db.exec("DELETE FROM derived_proposed_claims");            // dropping loses only the record
    expect((await store.getProposal("root", "هدي"))).toBeUndefined();
    expect((await store.rootIndications("هدي"))).toHaveLength(1);      // the reading itself is untouched
  });

  it("the submission ledger is drop-safe: clearing it loses no research", async () => {
    (await store.saveNote({ id: "n1", verseKey: "2:2", kind: "note", text: "mine" }));
    (await store.recordSubmission({ localRef: "n1", submissionId: "sub_x", contentHash: "h", kind: "note" }));
    expect((await store.getSubmissionFor("n1"))).toBeTruthy();

    db.exec("DELETE FROM derived_submissions");                // simulate dropping every derived table

    expect((await store.getSubmissionFor("n1"))).toBeUndefined();
    const [n] = (await store.listNotes({ verse: "2:2" }));             // the work itself is still there
    expect(n!.text).toBe("mine");
    expect(n!.origin).toBe("local");                           // still the reader's own
    expect(n!.authorId).toBe(store.localId);
  });
});
