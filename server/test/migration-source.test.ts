// Regression: opening an EXISTING research.db whose notes / word_indications
// predate the `source` column must migrate cleanly, not crash.
//
// This is the class of bug that shipped twice (parent_id, then source): an index
// placed in SCHEMA runs on db.exec(SCHEMA) BEFORE the ALTER that adds its column.
// The unit tests all used fresh databases, so none of them caught it. This one
// builds the old schema on disk first, the way a real user's file looks.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Db } from "../src/db.js";
import { ResearchStore } from "../src/research.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const dir = mkdtempSync(join(tmpdir(), "alsiraat-mig-"));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));

describe("migrating a research.db from before `source`", () => {
  it("adds source to notes + word_indications, keeps rows, tags them 'me'", () => {
    const path = join(dir, "legacy.db");

    // an older research.db: both tables exist WITHOUT a source column, with data
    const seed = new DatabaseSync(path);
    seed.exec(`
      CREATE TABLE notes (id TEXT PRIMARY KEY, verse_key TEXT NOT NULL, word_position INTEGER,
        kind TEXT NOT NULL DEFAULT 'note', text TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '',
        resolved INTEGER NOT NULL DEFAULT 0, lemma TEXT, root TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO notes VALUES ('n1','2:2',NULL,'question','why here?','',0,NULL,'ريب',1,1);
      CREATE TABLE word_indications (id TEXT PRIMARY KEY, lemma TEXT, root TEXT,
        scope TEXT NOT NULL DEFAULT 'lemma', parent_id TEXT, label TEXT NOT NULL DEFAULT '',
        meaning TEXT NOT NULL DEFAULT '', is_primary INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO word_indications VALUES ('i1','مُفْلِحُون','فلح','root',NULL,'the prosperers','',1,1,1);
    `);
    seed.close();

    // opening the store runs the migrations — must not throw
    const db = new Db(path);
    expect(() => new ResearchStore(db)).not.toThrow();
    const store = new ResearchStore(db);

    const note = store.listNotes({ verse: "2:2" })[0]!;
    expect(note.source).toBe("me");
    const ind = store.getIndication("i1")!;
    expect(ind.source).toBe("me");
    // and a fresh AI write is distinguishable
    store.saveNote({ id: "n_ai", verseKey: "2:3", kind: "note", text: "from ai", source: "ai" });
    expect(store.listProposed().notes.map((n: any) => n.id)).toEqual(["n_ai"]);

    db.close();
  });
});
