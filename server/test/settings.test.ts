// Device-independent UI settings: a key -> JSON value store in research.db, so reading
// prefs and the active comparison persist with the reader's data instead of the browser's
// per-origin IndexedDB. Also proves the settings table self-migrates onto an old db.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Hono } from "hono";

const dir = mkdtempSync(join(tmpdir(), "alsiraat-settings-"));
const RESEARCH = join(dir, "legacy.db");

let app: Hono;

beforeAll(async () => {
  // an OLD research.db with no settings table, to prove the schema migrates it in
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const seed = new DatabaseSync(RESEARCH);
  seed.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, verse_key TEXT, kind TEXT, text TEXT, created_at INTEGER, updated_at INTEGER)");
  seed.close();

  process.env.QF_RESEARCH_DB = RESEARCH;
  const { createApp } = await import("../src/app.js");
  const { createState } = await import("../src/state.js");
  app = createApp(createState());
});

const get = async (k: string) => (await app.request(`/api/v1/research/settings/${k}`)).json();
const put = (k: string, value: unknown) =>
  app.request(`/api/v1/research/settings/${k}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }),
  });

describe("research settings", () => {
  it("round-trips an object value (reading prefs)", async () => {
    const prefs = { script: "imlaei", myGlossOn: false, fontScale: 1.3 };
    expect((await put("reading", prefs)).status).toBe(200);
    expect((await get("reading") as any).value).toEqual(prefs);
  });

  it("round-trips a scalar value (active comparison)", async () => {
    await put("activeCompareSet", "cmp_123");
    expect((await get("activeCompareSet") as any).value).toBe("cmp_123");
  });

  it("returns null for an unknown key", async () => {
    expect((await get("does-not-exist") as any).value).toBeNull();
  });

  it("overwrites on repeat", async () => {
    await put("reading", { fontScale: 1 });
    await put("reading", { fontScale: 2 });
    expect((await get("reading") as any).value).toEqual({ fontScale: 2 });
  });
});
