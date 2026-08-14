// Whose research is this? The answer lives INSIDE the database file, so the file is
// self-describing: back it up, restore it on another machine, hand it to a colleague — it still
// knows. That's what makes "copy the file" a complete way to move your work.
//
// The uuid is derived from the email, so the same person gets the same id everywhere, and that
// id is what a remote account binds to.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Hono } from "hono";
import { ownerIdFor } from "../src/identity.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const dir = mkdtempSync(join(tmpdir(), "alsiraat-owner-"));
const RESEARCH = join(dir, "research.db");
const B = "/api/v1/research";
const ME = "mansoor@example.org";

let app: Hono;
const j = async (r: Response) => r.json() as any;
const put = (path: string, body: unknown) =>
  app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  // an existing research.db with no owner table — the common upgrade case
  const seed = new DatabaseSync(RESEARCH);
  seed.exec(
    "CREATE TABLE notes (id TEXT PRIMARY KEY, verse_key TEXT NOT NULL, word_position INTEGER, " +
    "kind TEXT NOT NULL DEFAULT 'note', text TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', " +
    "resolved INTEGER NOT NULL DEFAULT 0, lemma TEXT, root TEXT, source TEXT NOT NULL DEFAULT 'me', " +
    "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  seed.close();

  process.env.QF_RESEARCH_DB = RESEARCH;
  const { createApp } = await import("../src/app.js");
  const { createState } = await import("../src/state.js");
  app = createApp(createState());
});

describe("an unclaimed database", () => {
  it("reports no owner, so the app knows to ask", async () => {
    const id = await j(await app.request(`${B}/identity`));
    expect(id.owner).toBeNull();
    expect(id.databasePath).toBe(RESEARCH);
  });

  it("still works — reading and writing never wait for an owner", async () => {
    const res = await put(`${B}/notes/n_before`, {
      id: "n_before", verseKey: "2:1", kind: "note", text: "written before claiming",
    });
    expect(res.status).toBe(200);
  });
});

describe("claiming it", () => {
  it("stamps the email and a uuid DERIVED from it", async () => {
    const owner = await j(await put(`${B}/owner`, { email: " Mansoor@Example.org " }));
    expect(owner.email).toBe(ME);                 // trimmed + lowercased
    expect(owner.uuid).toBe(ownerIdFor(ME));      // same email → same id, on any machine
    expect(owner.claimedAt).toBeGreaterThan(0);
  });

  it("is reported by /identity, and becomes the id work is attributed to", async () => {
    const id = await j(await app.request(`${B}/identity`));
    expect(id.owner.email).toBe(ME);
    expect(id.localId).toBe(ownerIdFor(ME));      // what the remote account binds to
  });

  it("stamps newly written research with that id", async () => {
    await put(`${B}/notes/n_after`, { id: "n_after", verseKey: "2:2", kind: "note", text: "after" });
    const notes = await j(await app.request(`${B}/notes?verse=2:2`));
    expect(notes.find((n: any) => n.id === "n_after").authorId).toBe(ownerIdFor(ME));
  });

  it("survives reopening the file — it's in the database, not beside it", async () => {
    const { Db } = await import("../src/db.js");
    const { ResearchStore } = await import("../src/research.js");
    const reopened = new ResearchStore(new Db(RESEARCH));
    expect(reopened.getOwner()!.email).toBe(ME);
    expect(reopened.localId).toBe(ownerIdFor(ME));
  });
});

describe("re-assigning it", () => {
  it("can be corrected — you hold the file, so you may fix a typo or hand it on", async () => {
    const next = "someone@example.org";
    const owner = await j(await put(`${B}/owner`, { email: next }));
    expect(owner.email).toBe(next);
    expect(owner.uuid).toBe(ownerIdFor(next));
    // and the work already in the file is untouched
    const notes = await j(await app.request(`${B}/notes?verse=2:1`));
    expect(notes.map((n: any) => n.id)).toContain("n_before");
    await put(`${B}/owner`, { email: ME }); // put it back for later tests
  });

  it("refuses something that isn't an email", async () => {
    expect((await put(`${B}/owner`, { email: "nope" })).status).toBe(422);
    expect((await put(`${B}/owner`, {})).status).toBe(422);
  });
});

describe("choosing a database file", () => {
  it("lists the one that's open, with its owner", async () => {
    const out = await j(await app.request(`${B}/databases`));
    expect(out.current.path).toBe(RESEARCH);
    expect(out.current.owner.email).toBe(ME);
  });

  it("opens another file, and reads ITS owner from inside it", async () => {
    const other = join(dir, "colleague.db");
    const res = await app.request(`${B}/databases/open`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: other }),
    });
    expect(res.status).toBe(200);
    const out = await res.json() as any;
    expect(out.path).toBe(other);
    expect(out.owner).toBeNull();          // a brand-new file: unclaimed, so the app will ask

    // it is now the open database, and the previous one is remembered
    const dbs = await j(await app.request(`${B}/databases`));
    expect(dbs.current.path).toBe(other);
    expect(dbs.recent.map((r: any) => r.path)).toContain(RESEARCH);

    // switch back, and the original owner is still there
    await app.request(`${B}/databases/open`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: RESEARCH }),
    });
    expect((await j(await app.request(`${B}/identity`))).owner.email).toBe(ME);
  });

  it("insists on a .db file", async () => {
    const res = await app.request(`${B}/databases/open`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: join(dir, "notes.txt") }),
    });
    expect(res.status).toBe(400);
  });
});
