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
const WRITABLE_BY_SYNC = [
  "derived_submissions",     // my outbox: what I have offered upstream
  "derived_global_forms",    // the group's established readings
  "derived_dissents",        // the ledger of disagreement against them
  "derived_peer_indications", // the community's readings, shown beside my own
  "derived_proposed_claims", // my outbox: readings I have proposed upstream
  "derived_sync_state",      // how far each pull has got
];

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

  it("every sync-facing method is one we deliberately allowed", () => {
    // Adding a method whose name touches sync/pull/remote should be a conscious act, not
    // something that slips in. If you add one, add it here and be sure it writes derived_* only.
    const allowed = [
      "applyPull", "syncPosition", "syncCursors", "setSyncPosition", "resetPulled",
    ];
    const api = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    const syncFacing = api.filter((m) => /remote|sync|pull/i.test(m));
    expect(syncFacing.sort()).toEqual(allowed.sort());
  });

  it("applying a pull writes derived_* ONLY — proven by row counts, not by naming", () => {
    const counts = () => Object.fromEntries(MINE.map((t) =>
      [t, db.scalar<number>(`SELECT COUNT(*) FROM ${t}`) ?? 0]));

    const before = counts();
    store.applyPull({
      cursors: { globalForms: 4, dissents: 5, peerIndications: 0 },
      globalForms: [{
        subjectKind: "form", subjectValue: "هُدًى", claimId: "clm_x", version: 1,
        meaning: "guidance", authorId: "them", establishedAt: new Date().toISOString(),
        payload: { meaning: "guidance" }, schemaVersion: 1, seq: 4,
      }],
      dissents: [{
        id: "dsn_x", claimId: "clm_x", claimVersion: 1, authorId: "other",
        payload: {}, createdAt: new Date().toISOString(), schemaVersion: 1, seq: 5,
      }],
    });

    expect(counts()).toEqual(before);                                  // not one row of mine moved
    expect(db.scalar<number>("SELECT COUNT(*) FROM derived_global_forms")).toBe(1);
  });

  it("pulled community indications never become the reader's own indications", () => {
    // The riskiest change in the whole design: peer readings are SHOWN in the same list as
    // yours, so the temptation is to store them in the same table. They must not be — or a
    // pull could silently author, edit, or re-prioritise your work.
    store.saveIndication({ id: "ind_mine", root: "هدي", label: "guidance", meaning: "mine" });
    const mineBefore = store.rootIndications("هدي");
    expect(mineBefore).toHaveLength(1);
    expect(mineBefore[0]!.primary).toBe(true);

    store.applyPull({
      cursors: { globalForms: 0, dissents: 0, peerIndications: 8 },
      peerIndications: [
        {
          claimId: "clm_a", version: 1, authorId: "amina", subjectKind: "root",
          subjectValue: "هدي", status: "established", label: "a giving of direction",
          meaning: "theirs", payload: {}, createdAt: new Date().toISOString(),
          schemaVersion: 1, seq: 7,
        },
        {
          claimId: "clm_b", version: 1, authorId: "bilal", subjectKind: "form",
          subjectValue: "هُدًى", status: "proposed", label: "guidance", meaning: "also theirs",
          payload: {}, createdAt: new Date().toISOString(), schemaVersion: 1, seq: 8,
        },
      ],
    });

    // my indication list is byte-identical, still mine, still primary
    expect(store.rootIndications("هدي")).toEqual(mineBefore);
    expect(db.scalar<number>("SELECT COUNT(*) FROM word_indications")).toBe(1);

    // and theirs are visible, separately, under both scopes
    expect(store.peerIndications("root", "هدي")).toHaveLength(1);
    expect(store.peerIndications("form", "هُدًى")).toHaveLength(1);

    const forWord = store.indicationsForWord("هُدًى", "هدي");
    expect(forWord.rootIndications).toHaveLength(1);      // only mine in my array
    expect(forWord.communityRoot).toHaveLength(1);
    expect(forWord.communityLemma).toHaveLength(1);
    expect(forWord.communityRoot[0].status).toBe("established");
  });

  it("re-pulling the same reading updates it in place rather than duplicating it", () => {
    const one = {
      claimId: "clm_c", version: 1, authorId: "amina", subjectKind: "root",
      subjectValue: "نذر", status: "proposed", label: "warning", meaning: "v1",
      payload: {}, createdAt: new Date().toISOString(), schemaVersion: 1, seq: 10,
    };
    store.applyPull({ peerIndications: [one] });
    // the group later carries it — the SAME claim version, now established
    store.applyPull({ peerIndications: [{ ...one, status: "established", seq: 11 }] });

    const peers = store.peerIndications("root", "نذر");
    expect(peers).toHaveLength(1);
    expect(peers[0]!.status).toBe("established");
  });

  it("peerFormReadings gives a community root reading its per-form view", () => {
    store.applyPull({
      peerIndications: [
        { claimId: "f1", version: 1, authorId: "a", subjectKind: "form", subjectValue: "هَدَى",
          status: "established", label: "he guided", meaning: "verb reading",
          payload: {}, createdAt: new Date().toISOString(), schemaVersion: 1, seq: 20 },
        { claimId: "f2", version: 1, authorId: "a", subjectKind: "form", subjectValue: "هُدًى",
          status: "proposed", label: "guidance", meaning: "noun reading",
          payload: {}, createdAt: new Date().toISOString(), schemaVersion: 1, seq: 21 },
      ],
    });
    const map = store.peerFormReadings(["هَدَى", "هُدًى", "ٱهْتَدَىٰ"]);
    expect(Object.keys(map).sort()).toEqual(["هَدَى", "هُدًى"].sort());  // only forms with a reading
    expect(map["هُدًى"]!.label).toBe("guidance");
    expect(map["ٱهْتَدَىٰ"]).toBeUndefined();                            // no reading → absent
  });

  it("peerFormReadings keeps the best reading per form (established over proposed)", () => {
    store.applyPull({
      peerIndications: [
        { claimId: "g1", version: 1, authorId: "a", subjectKind: "form", subjectValue: "شَهِيد",
          status: "proposed", label: "witness (argued)", meaning: "p",
          payload: {}, createdAt: new Date(1).toISOString(), schemaVersion: 1, seq: 30 },
        { claimId: "g2", version: 1, authorId: "b", subjectKind: "form", subjectValue: "شَهِيد",
          status: "established", label: "witness (carried)", meaning: "e",
          payload: {}, createdAt: new Date(2).toISOString(), schemaVersion: 1, seq: 31 },
      ],
    });
    expect(store.peerFormReadings(["شَهِيد"])["شَهِيد"]!.status).toBe("established");
  });

  it("a peer reading exposes the per-form shades carried in its payload", () => {
    store.applyPull({
      peerIndications: [{
        claimId: "clm_r", version: 1, authorId: "amina", subjectKind: "root",
        subjectValue: "رشد", status: "established", label: "right-guidance", meaning: "the root",
        payload: { meaning: "the root", refinements: [
          { lemma: "رَشَد", label: "maturity", meaning: "sound judgement" },
          { lemma: "رَاشِد", label: "rightly-guided", meaning: "one on the right way" },
        ] },
        createdAt: new Date().toISOString(), schemaVersion: 1, seq: 40,
      }],
    });
    const [p] = store.peerIndications("root", "رشد");
    expect(p!.refinements).toHaveLength(2);
    expect(p!.refinements[0].lemma).toBe("رَشَد");
  });

  it("the proposed-claims ledger records and is drop-safe", () => {
    store.recordProposal({ subjectKind: "root", subjectValue: "هدي", contentHash: "abc" });
    expect(store.getProposal("root", "هدي")!.contentHash).toBe("abc");
    // re-proposing an updated reading replaces the hash, never stacks
    store.recordProposal({ subjectKind: "root", subjectValue: "هدي", contentHash: "def" });
    expect(store.getProposal("root", "هدي")!.contentHash).toBe("def");

    db.exec("DELETE FROM derived_proposed_claims");           // dropping loses only the record
    expect(store.getProposal("root", "هدي")).toBeUndefined();
    expect(store.rootIndications("هدي")).toHaveLength(1);     // the reading itself is untouched
  });

  it("dropping every derived table loses the community's readings and none of mine", () => {
    db.exec("DELETE FROM derived_peer_indications");
    expect(store.peerIndications("root", "هدي")).toHaveLength(0);
    expect(store.peerFormReadings(["هُدًى"])).toEqual({});
    expect(store.rootIndications("هدي")).toHaveLength(1);   // untouched
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
