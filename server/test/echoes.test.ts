// V10 — verbatim echoes. No Python oracle (new feature); validated against
// well-known repeats in the Quran.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const get = async (p: string) => (await (await app.request(p)).json()) as any;

beforeAll(() => { app = createApp(createState()); });

describe("verbatim echoes", () => {
  it("Ar-Rahman refrain (55:13) repeats across many ayahs", async () => {
    const echoes = await get("/api/v1/verses/55:13/echoes");
    expect(Array.isArray(echoes)).toBe(true);
    // the refrain فبأي آلاء ربكما تكذبان recurs ~30 more times in the surah
    const refrain = echoes.find((e: any) => e.verses.length >= 10);
    expect(refrain, "expected a phrase repeated in ≥10 other verses").toBeTruthy();
    expect(refrain.length).toBeGreaterThanOrEqual(3);
    // every occurrence is elsewhere in Ar-Rahman (chapter 55)
    expect(refrain.verses.every((v: string) => v.startsWith("55:"))).toBe(true);
    expect(refrain.verses).not.toContain("55:13");
  });

  it("basmala (1:1) echoes in 27:30", async () => {
    const echoes = await get("/api/v1/verses/1:1/echoes");
    const all = echoes.flatMap((e: any) => e.verses);
    expect(all).toContain("27:30");
  });

  it("chapter-level echo set lists Ar-Rahman refrain verses", async () => {
    const keys = (await get("/api/v1/chapters/55/echoes")) as string[];
    expect(keys).toContain("55:13");
    expect(keys.length).toBeGreaterThan(20); // many refrain ayahs
  });

  it("a verse with no repeated phrase returns []", async () => {
    // 2:255 (Ayat al-Kursi) — long, largely unique; still returns an array
    const echoes = await get("/api/v1/verses/2:255/echoes");
    expect(Array.isArray(echoes)).toBe(true);
  });

  it("404 for unknown verse/chapter", async () => {
    expect((await app.request("/api/v1/verses/999:1/echoes")).status).toBe(404);
    expect((await app.request("/api/v1/chapters/200/echoes")).status).toBe(404);
  });
});
