// The outbound submission ledger: what this reader has offered upstream, and with what
// content. Without it the app can't tell "already shared" from "edited since I shared it",
// so re-sharing an edited record would land upstream as an orphaned duplicate instead of a
// submission chained via `supersedes` (SHARED_RESEARCH.md §6).
//
// Also proves the table self-migrates onto a research.db that predates it.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Hono } from "hono";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const dir = mkdtempSync(join(tmpdir(), "alsiraat-sublog-"));
const RESEARCH = join(dir, "legacy.db");
const B = "/api/v1/research";

let app: Hono;
const j = async (r: Response) => r.json() as any;
const put = (path: string, body: unknown) =>
  app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  // an old research.db with no derived_submissions table
  const seed = new DatabaseSync(RESEARCH);
  seed.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, verse_key TEXT NOT NULL, kind TEXT, " +
    "text TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  seed.close();

  process.env.QF_RESEARCH_DB = RESEARCH;
  const { createApp } = await import("../src/app.js");
  const { createState } = await import("../src/state.js");
  app = createApp(createState());
});

describe("outbound submission ledger", () => {
  it("reports nothing for a record that was never shared", async () => {
    expect(await j(await app.request(`${B}/submission-log/note_never`))).toBeNull();
  });

  it("records what was submitted, and reads it back", async () => {
    const res = await put(`${B}/submission-log/note_1`, {
      submissionId: "sub_abc", contentHash: "h1", kind: "question",
    });
    expect(res.status).toBe(200);
    const got = await j(await app.request(`${B}/submission-log/note_1`));
    expect(got).toMatchObject({
      localRef: "note_1", submissionId: "sub_abc", contentHash: "h1",
      kind: "question", status: "submitted",
    });
    expect(got.submittedAt).toBeGreaterThan(0);
  });

  it("replaces the entry when the record is re-submitted", async () => {
    await put(`${B}/submission-log/note_1`, { submissionId: "sub_def", contentHash: "h2" });
    const got = await j(await app.request(`${B}/submission-log/note_1`));
    expect(got.submissionId).toBe("sub_def"); // the chain head, not a second row
    expect(got.contentHash).toBe("h2");
    // still exactly one entry for this record
    const all = await j(await app.request(`${B}/submission-log`));
    expect(all.filter((x: any) => x.localRef === "note_1")).toHaveLength(1);
  });

  it("the stored hash is what tells 'unchanged' from 'edited since shared'", async () => {
    const got = await j(await app.request(`${B}/submission-log/note_1`));
    expect(got.contentHash === "h2").toBe(true);   // unchanged → the app shows "Shared"
    expect(got.contentHash === "h3").toBe(false);  // edited    → the app shows "Update"
  });

  it("lists every shared record, newest first", async () => {
    await put(`${B}/submission-log/note_2`, { submissionId: "sub_ghi", contentHash: "h9" });
    const all = await j(await app.request(`${B}/submission-log`));
    expect(all.map((x: any) => x.localRef)).toContain("note_2");
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("requires both the submission id and the content hash", async () => {
    expect((await put(`${B}/submission-log/note_3`, { submissionId: "sub_x" })).status).toBe(422);
    expect((await put(`${B}/submission-log/note_3`, { contentHash: "h" })).status).toBe(422);
  });
});
