// Parity: content routes must reproduce the Python content endpoints exactly.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf-8"));

let app: Hono;
const get = async (p: string) => {
  const r = await app.request(p);
  return { status: r.status, body: await r.json() };
};

beforeAll(() => {
  app = createApp(createState());
});

describe("content parity with Python", () => {
  it("chapters list", async () => {
    expect((await get("/api/v1/chapters")).body).toEqual(fixture("chapters.json"));
  });
  it("single chapter", async () => {
    expect((await get("/api/v1/chapters/2")).body).toEqual(fixture("chapter_2.json"));
  });
  it("verse with words", async () => {
    expect((await get("/api/v1/verses/2:143?words=true")).body).toEqual(fixture("verse_2_143.json"));
  });
  it("verse all scripts", async () => {
    expect((await get("/api/v1/verses/1:1?all_scripts=true")).body).toEqual(fixture("verse_1_1_all.json"));
  });
  it("chapter verses with words", async () => {
    expect((await get("/api/v1/chapters/112/verses?words=true")).body).toEqual(fixture("chapter_112_verses.json"));
  });
  it("verses page", async () => {
    expect((await get("/api/v1/verses?limit=10")).body).toEqual(fixture("verses_page.json"));
  });
  it("neighbours", async () => {
    expect((await get("/api/v1/verses/2:143/neighbours?radius=2")).body).toEqual(fixture("neighbours_2_143.json"));
  });
  it("phrase search", async () => {
    const body = (await get("/api/v1/phrase-search?q=" + encodeURIComponent("الحمد لله"))).body as any[];
    expect(body.map((v) => v.verse_key)).toEqual(fixture("phrase_alhamd.json"));
  });
  it("words", async () => {
    expect((await get("/api/v1/verses/1:1/words")).body).toEqual(fixture("words_1_1.json"));
  });
  it("translations", async () => {
    expect((await get("/api/v1/verses/1:1/translations")).body).toEqual(fixture("translations_1_1.json"));
  });
  it("404 + 422", async () => {
    expect((await get("/api/v1/verses/999:1")).status).toBe(404);
    expect((await get("/api/v1/verses/2:143?script=nope")).status).toBe(422);
  });
});
