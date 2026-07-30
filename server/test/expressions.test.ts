// Expression search — new feature; validated against known co-occurrences.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const expr = async (terms: { surface?: string; root?: string | null }[], mode: string) =>
  (await (await app.request("/api/v1/expression-search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms, mode }),
  })).json()) as { verse_key: string; text: string }[];

beforeAll(() => { app = createApp(createState()); });

describe("expression search", () => {
  it("verbatim: الحمد + لله co-occur (incl. 1:2)", async () => {
    const hits = await expr([{ surface: "الحمد" }, { surface: "لله" }], "verbatim");
    expect(hits.some((h) => h.verse_key === "1:2")).toBe(true);
  });

  it("roots: رحمن + رحيم co-occur (incl. 1:3)", async () => {
    const hits = await expr(
      [{ surface: "الرحمن", root: "rHm" }, { surface: "الرحيم", root: "rHm" }],
      "roots",
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("empty terms → []", async () => {
    expect(await expr([], "verbatim")).toEqual([]);
  });
});
