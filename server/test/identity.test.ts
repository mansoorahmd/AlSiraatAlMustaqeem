// Phase 1 — local identity. The store mints one stable local_id, stamps every record
// the reader creates with author_id + origin='local', and backfills rows that predate the
// columns. This is what lets a future account bind to work done before signing in.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Hono } from "hono";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const dir = mkdtempSync(join(tmpdir(), "alsiraat-identity-"));
const RESEARCH = join(dir, "legacy.db");
const B = "/api/v1/research";

let app: Hono;
const j = async (r: Response) => r.json() as any;
const put = (path: string, body: unknown) =>
  app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  // an OLD research.db: the notes table exactly as it was BEFORE Phase 1 — everything
  // except author_id/origin — with a row in it, to prove those columns migrate + backfill.
  const seed = new DatabaseSync(RESEARCH);
  seed.exec(
    "CREATE TABLE notes (id TEXT PRIMARY KEY, verse_key TEXT NOT NULL, word_position INTEGER, " +
    "kind TEXT NOT NULL DEFAULT 'note', text TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', " +
    "resolved INTEGER NOT NULL DEFAULT 0, lemma TEXT, root TEXT, source TEXT NOT NULL DEFAULT 'me', " +
    "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  seed.exec("INSERT INTO notes (id, verse_key, kind, text, created_at, updated_at) VALUES " +
    "('legacy_1','2:1','note','from before identity',1,1)");
  seed.close();

  process.env.QF_RESEARCH_DB = RESEARCH;
  const { createApp } = await import("../src/app.js");
  const { createState } = await import("../src/state.js");
  app = createApp(createState()); // constructor mints local_id, migrates + backfills
});

describe("local identity", () => {
  it("mints a stable UUID local_id, exposed at /identity", async () => {
    const { localId } = await j(await app.request(`${B}/identity`));
    expect(localId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("backfills a row that predates the author_id/origin columns", async () => {
    const { localId } = await j(await app.request(`${B}/identity`));
    const notes = await j(await app.request(`${B}/notes?verse=2:1`));
    const legacy = notes.find((n: any) => n.id === "legacy_1");
    expect(legacy.authorId).toBe(localId); // no longer un-attributed
    expect(legacy.origin).toBe("local");
  });

  it("stamps new records with the same local_id and origin='local'", async () => {
    const { localId } = await j(await app.request(`${B}/identity`));
    await put(`${B}/notes/fresh_1`, { id: "fresh_1", verseKey: "2:1", kind: "note", text: "made now" });
    const row = (await j(await app.request(`${B}/notes?verse=2:1`))).find((n: any) => n.id === "fresh_1");
    expect(row.authorId).toBe(localId);
    expect(row.origin).toBe("local");
  });

  it("keeps the same local_id when the store is reopened on the same file", async () => {
    const { localId } = await j(await app.request(`${B}/identity`));
    const { Db } = await import("../src/db.js");
    const { ResearchStore } = await import("../src/research.js");
    const reopened = new ResearchStore(new Db(RESEARCH));
    expect(reopened.localId).toBe(localId); // stable across sessions
  });
});
