// Parity: similarity engine + free-text search match Python. Tie order can
// differ (both use stable sort over different candidate iteration order), so
// we assert same membership, same scores, and identical shared/pattern/run
// per verse — plus that results are score-monotonic.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

const fx = (n: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", n), "utf-8"));
let app: Hono;

beforeAll(() => { app = createApp(createState()); });

function compareMatches(gotAll: any[], wantAll: any[]) {
  // The top_k cutoff can fall inside a group of equal-scoring verses; which of
  // those tie-members land in the slice is order-dependent (Python sets vs JS
  // Maps) and not a meaningful difference. Compare only the unambiguous region
  // strictly above the lowest returned score on either side.
  const cutoff = Math.max(
    Math.min(...gotAll.map((m) => m.score)),
    Math.min(...wantAll.map((m) => m.score)),
  );
  const got = gotAll.filter((m) => m.score > cutoff);
  const want = wantAll.filter((m) => m.score > cutoff);
  const g = Object.fromEntries(got.map((m) => [m.verse_key, m]));
  const w = Object.fromEntries(want.map((m) => [m.verse_key, m]));
  expect(Object.keys(g).sort()).toEqual(Object.keys(w).sort());
  for (const k of Object.keys(w)) {
    expect(g[k].score).toBeCloseTo(w[k].score, 4);
    expect(g[k].overlap).toBeCloseTo(w[k].overlap, 4);
    expect(g[k].phrase).toBeCloseTo(w[k].phrase, 4);
    expect(g[k].morphology).toBeCloseTo(w[k].morphology, 4);
    expect([...g[k].shared].sort()).toEqual([...w[k].shared].sort());
    expect(g[k].pattern).toEqual(w[k].pattern);
    expect(g[k].phrase_run).toEqual(w[k].phrase_run);
  }
  // score-monotonic (non-increasing)
  for (let i = 1; i < got.length; i++) expect(got[i - 1].score).toBeGreaterThanOrEqual(got[i].score);
}

describe("similarity parity", () => {
  for (const key of ["2:143", "55:13", "1:1", "112:1"]) {
    it(`similar to ${key}`, async () => {
      const got = (await (await app.request(`/api/v1/verses/${key}/similar?top_k=40`)).json()) as any[];
      compareMatches(got, fx(`similar_${key.replace(":", "_")}.json`));
    });
  }

  it("free-text search", async () => {
    const cases = fx("search.json") as { query: string; result: any }[];
    for (const { query, result } of cases) {
      const got = (await (await app.request("/api/v1/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: query, top_k: 30 }),
      })).json()) as any;
      expect(got.resolved).toEqual(result.resolved);
      expect(got.unresolved).toEqual(result.unresolved);
      compareMatches(got.matches, result.matches);
    }
  });
});
