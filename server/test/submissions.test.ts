// Phase 4 — outbound additive submissions. Against real Postgres (PGlite, in-process).
//
// The properties that matter: a submission is a FROZEN snapshot, submitting the same bundle
// twice is idempotent rather than duplicating, only non-conflicting (additive) kinds are
// accepted yet, oversized items are refused, and you can only supersede your own work.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import {
  createSubmission, listMine, getSubmission, SubmissionError, MAX_ITEM_BYTES, SCHEMA_VERSION,
} from "../src/submissions.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db: PGlite;
let r: SqlRunner;
let author: string;
let other: string;

const note = (text: string) => ({
  kind: "note" as const, subjectKind: "ayah", subjectValue: "2:255",
  payload: { id: "n1", verseKey: "2:255", text },
});

beforeAll(async () => {
  db = new PGlite();
  r = {
    exec: (sql) => db.exec(sql).then(() => undefined),
    query: async (sql, params = []) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[],
  };
  await runMigrations(r, MIGR);
});

beforeEach(async () => {
  await db.exec("DELETE FROM submission_items; DELETE FROM submissions; DELETE FROM users;");
  const rows = (await r.query(
    `INSERT INTO users (email, role) VALUES
       ('author@example.org','researcher'), ('other@example.org','researcher')
     RETURNING id, email`,
  )) as { id: string; email: string }[];
  author = rows.find((x) => x.email.startsWith("author"))!.id;
  other = rows.find((x) => x.email.startsWith("other"))!.id;
});

describe("creating a submission", () => {
  it("stores the item and reports it back", async () => {
    const out = await createSubmission(r, { authorId: author, items: [note("as I read it")] });
    expect(out.id).toMatch(/^sub_[a-z2-7]{26}$/);
    expect(out).toMatchObject({ status: "submitted", targetKind: "additive", items: 1, supersedes: null });
    expect(await getSubmission(r, out.id)).toMatchObject({ id: out.id });
  });

  it("records the schema version on every item, for forward-compat", async () => {
    const out = await createSubmission(r, { authorId: author, items: [note("x")] });
    const rows = await r.query("SELECT schema_version FROM submission_items WHERE submission_id = $1", [out.id]);
    expect(rows[0]!.schema_version).toBe(SCHEMA_VERSION);
  });

  it("is idempotent — the same bundle twice is one submission", async () => {
    const a = await createSubmission(r, { authorId: author, items: [note("same")] });
    const b = await createSubmission(r, { authorId: author, items: [note("same")] });
    expect(b.id).toBe(a.id);
    expect(await listMine(r, author)).toHaveLength(1);
    const items = await r.query("SELECT id FROM submission_items WHERE submission_id = $1", [a.id]);
    expect(items).toHaveLength(1); // not duplicated either
  });

  it("different content is a different submission", async () => {
    const a = await createSubmission(r, { authorId: author, items: [note("first")] });
    const b = await createSubmission(r, { authorId: author, items: [note("second")] });
    expect(b.id).not.toBe(a.id);
    expect(await listMine(r, author)).toHaveLength(2);
  });

  it("two authors submitting identical content get distinct submissions", async () => {
    const a = await createSubmission(r, { authorId: author, items: [note("same")] });
    const b = await createSubmission(r, { authorId: other, items: [note("same")] });
    expect(b.id).not.toBe(a.id);
  });
});

describe("the frozen snapshot", () => {
  it("keeps the payload as submitted, even after the local record changes", async () => {
    const out = await createSubmission(r, { authorId: author, items: [note("as submitted")] });
    // the reader edits their local note afterwards and submits the new text
    await createSubmission(r, { authorId: author, items: [note("edited later")] });
    const rows = await r.query(
      "SELECT payload_json FROM submission_items WHERE submission_id = $1", [out.id]);
    expect((rows[0]!.payload_json as { text: string }).text).toBe("as submitted");
  });
});

describe("superseding", () => {
  it("links a re-submission to the one it replaces", async () => {
    const first = await createSubmission(r, { authorId: author, items: [note("v1")] });
    const second = await createSubmission(r, {
      authorId: author, items: [note("v2")], supersedes: first.id,
    });
    expect(second.supersedes).toBe(first.id);
    expect(await getSubmission(r, first.id)).not.toBeNull(); // the original survives
  });

  it("refuses to supersede a submission that isn't yours", async () => {
    const mine = await createSubmission(r, { authorId: other, items: [note("theirs")] });
    await expect(createSubmission(r, {
      authorId: author, items: [note("mine")], supersedes: mine.id,
    })).rejects.toThrow(/isn't yours/);
  });

  it("refuses to supersede something that doesn't exist", async () => {
    await expect(createSubmission(r, {
      authorId: author, items: [note("x")], supersedes: "sub_nope",
    })).rejects.toThrow(/no such submission/);
  });
});

describe("what may be submitted", () => {
  it("rejects a competing kind — those need the claim machinery (Phase 5)", async () => {
    await expect(createSubmission(r, {
      authorId: author,
      items: [{ kind: "indication" as never, payload: { meaning: "guidance" } }],
    })).rejects.toThrow(/only additive kinds/);
  });

  it("rejects an empty submission", async () => {
    await expect(createSubmission(r, { authorId: author, items: [] })).rejects.toThrow(SubmissionError);
  });

  it("rejects an item over the 1 MB cap, naming the fix", async () => {
    const huge = { kind: "note" as const, payload: { text: "ا".repeat(MAX_ITEM_BYTES) } };
    await expect(createSubmission(r, { authorId: author, items: [huge] }))
      .rejects.toThrow(/split this submission/);
  });

  it("accepts all three additive kinds together", async () => {
    const out = await createSubmission(r, {
      authorId: author,
      items: [
        { kind: "note", payload: { text: "a note" } },
        { kind: "question", payload: { text: "why هُدًى here?" } },
        { kind: "evidence", subjectKind: "root", subjectValue: "هدي", payload: { verseKey: "2:2" } },
      ],
    });
    expect(out.items).toBe(3);
  });
});

describe("the outbox", () => {
  it("lists only your own submissions, newest first", async () => {
    await createSubmission(r, { authorId: author, items: [note("mine 1")] });
    await createSubmission(r, { authorId: other, items: [note("theirs")] });
    await createSubmission(r, { authorId: author, items: [note("mine 2")] });
    const mine = await listMine(r, author);
    expect(mine).toHaveLength(2);
    expect(mine.every((s) => s.status === "submitted")).toBe(true);
  });
});
