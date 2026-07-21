// Parity: roots / forms / occurrences / linkages match Python.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

const fx = (n: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures", n), "utf-8"));
let app: Hono;
const get = async (p: string) => (await (await app.request(p)).json()) as any;

beforeAll(() => { app = createApp(createState()); });

describe("roots parity", () => {
  it("top roots", async () => {
    expect(await get("/api/v1/roots?order_by=count&limit=30")).toEqual(fx("roots_top.json"));
  });

  for (const r of ["hdy", "Amm", "slm"]) {
    it(`root ${r} detail + forms + occurrences`, async () => {
      expect(await get(`/api/v1/roots/${r}`)).toEqual(fx(`root_${r}.json`));
      expect(await get(`/api/v1/roots/${r}/forms`)).toEqual(fx(`forms_${r}.json`));
      expect(await get(`/api/v1/roots/${r}/occurrences?limit=50`)).toEqual(fx(`occ_${r}.json`));
    });

    it(`root ${r} linkages (same set + values)`, async () => {
      const got = await get(`/api/v1/roots/${r}/linkages?limit=40`);
      const want = fx(`linkages_${r}.json`);
      const key = (l: any) => l.root_buckwalter;
      // order can differ on ties; compare as maps of root → numeric fields
      const norm = (arr: any[]) => Object.fromEntries(arr.map((l) => [key(l), l]));
      const g = norm(got), w = norm(want);
      expect(Object.keys(g).sort()).toEqual(Object.keys(w).sort());
      for (const k of Object.keys(w)) {
        expect(g[k].cooccur).toBe(w[k].cooccur);
        expect(g[k].score).toBeCloseTo(w[k].score, 4);
        expect(g[k].npmi).toBeCloseTo(w[k].npmi, 4);
      }
    });
  }
});
