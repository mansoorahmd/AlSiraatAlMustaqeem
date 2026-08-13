// research.db backup — VACUUM INTO must produce a clean, complete copy of a live,
// WAL-dirty database: every row present, integrity ok, and no -wal/-shm sidecar the
// copy depends on. This is the safety net the whole shared-research build sits on.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Hono } from "hono";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const dir = mkdtempSync(join(tmpdir(), "alsiraat-backup-"));
const RESEARCH = join(dir, "research.db");
const N = 400;

let app: Hono;

beforeAll(async () => {
  process.env.QF_RESEARCH_DB = RESEARCH;
  const { createApp } = await import("../src/app.js");
  const { createState } = await import("../src/state.js");
  app = createApp(createState()); // ResearchStore puts the db in WAL mode

  // dirty the WAL: write many notes through the real API, no checkpoint
  for (let i = 0; i < N; i++) {
    const id = `note_${i}`;
    await app.request(`/api/v1/research/notes/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, verseKey: "2:255", kind: "note", text: `note ${i}` }),
    });
  }
});

const backup = async (dest?: string) =>
  app.request("/api/v1/research/backup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dest ? { dest } : {}),
  });

describe("research.db backup", () => {
  it("copies a live, WAL-dirty db into a clean, complete standalone file", async () => {
    // the live db really is carrying an uncheckpointed WAL sidecar
    expect(existsSync(`${RESEARCH}-wal`)).toBe(true);

    const dest = join(dir, "backup-1.db");
    const res = await backup(dest);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { path: string; bytes: number; at: number };
    expect(out.path).toBe(dest);
    expect(out.bytes).toBeGreaterThan(0);

    // the copy stands on its own: open it fresh, no sidecars beside it
    expect(existsSync(`${dest}-wal`)).toBe(false);
    expect(existsSync(`${dest}-shm`)).toBe(false);

    const copy = new DatabaseSync(dest);
    const count = (copy.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;
    expect(count).toBe(N); // every WAL-only row made it in
    const integrity = copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    expect(integrity.integrity_check).toBe("ok");
    copy.close();
  });

  it("defaults to a sibling backups/ folder when no dest is given", async () => {
    const res = await backup();
    expect(res.status).toBe(200);
    const out = (await res.json()) as { path: string };
    expect(out.path).toContain(join("backups", "research-"));
    expect(existsSync(out.path)).toBe(true);
    expect(statSync(out.path).size).toBeGreaterThan(0);
  });

  it("refuses to overwrite an existing file", async () => {
    const dest = join(dir, "backup-2.db");
    expect((await backup(dest)).status).toBe(200);
    const again = await backup(dest);
    expect(again.status).toBe(400);
    expect(((await again.json()) as { detail: string }).detail).toMatch(/overwrite/);
  });

  it("rejects a non-absolute or non-.db destination", async () => {
    expect((await backup("relative/path.db")).status).toBe(400);
    expect((await backup(join(dir, "nope.sqlite"))).status).toBe(400);
  });
});
