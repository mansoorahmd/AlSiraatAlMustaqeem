// "Follow this exact word" — occurrences of one written surface (rasm), which is
// the only way to walk particles and proper names, since they have no root.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const occ = async (surface: string) =>
  (await (await app.request(`/api/v1/words/occurrences?surface=${encodeURIComponent(surface)}`)).json()) as
    { verse_key: string; word_position: number }[];

beforeAll(() => { app = createApp(createState()); });

describe("exact-word occurrences", () => {
  it("walks a rooted word — ٱلْمُفْلِحُونَ, starting at 2:5", async () => {
    const rows = await occ("ٱلْمُفْلِحُونَ");
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0]).toEqual({ verse_key: "2:5", word_position: 8 });
    // mushaf order: chapter then verse
    const chapters = rows.map((r) => Number(r.verse_key.split(":")[0]));
    expect(chapters).toEqual([...chapters].sort((a, b) => a - b));
  });

  it("walks a ROOTLESS particle — مِن (impossible with a root thread)", async () => {
    const rows = await occ("مِن");
    expect(rows.length).toBeGreaterThan(1000);
  });

  it("is exact about spelling: prefixed forms are a different thread", async () => {
    const bare = await occ("مُفْلِحُونَ");
    const withArticle = await occ("ٱلْمُفْلِحُونَ");
    const keys = new Set(bare.map((r) => `${r.verse_key}#${r.word_position}`));
    // no occurrence appears in both lists — the written words differ
    expect(withArticle.every((r) => !keys.has(`${r.verse_key}#${r.word_position}`))).toBe(true);
  });

  it("respects limit, and rejects a missing surface", async () => {
    const res = await app.request("/api/v1/words/occurrences?surface=%D9%85%D9%90%D9%86&limit=5");
    expect(((await res.json()) as unknown[]).length).toBe(5);
    expect((await app.request("/api/v1/words/occurrences")).status).toBe(422);
  });
});
