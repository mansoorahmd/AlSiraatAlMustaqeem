// Comparisons (saveable boards of pinned āyāt & roots) — new feature.
// Exercises the full lifecycle over the /research/compare-sets routes.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const j = async (r: Response) => r.json() as any;
const base = "/api/v1/research/compare-sets";

beforeAll(() => { app = createApp(createState()); });

describe("comparisons", () => {
  it("creates, fills, dedupes, removes and deletes", async () => {
    // create a set
    const s = await j(await app.request(`${base}/c1`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "c1", title: "near-synonyms" }),
    }));
    expect(s).toMatchObject({ id: "c1", title: "near-synonyms", count: 0 });

    // add two items
    await app.request(`${base}/c1/items/i1`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "ayah", ref: "2:2" }),
    });
    await app.request(`${base}/c1/items/i2`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "root", ref: "Elm" }),
    });

    // duplicate (same set+kind+ref) is ignored — keeps the first item's id
    const dup = await j(await app.request(`${base}/c1/items/i9`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "ayah", ref: "2:2" }),
    }));
    expect(dup.id).toBe("i1");

    // list reflects count = 2 (dup didn't add)
    const sets = await j(await app.request(base));
    expect(sets.find((x: any) => x.id === "c1").count).toBe(2);

    // remove one item
    await app.request(`${base}/c1/items/i2`, { method: "DELETE" });
    const items = await j(await app.request(`${base}/c1/items`));
    expect(items.map((x: any) => x.ref)).toEqual(["2:2"]);

    // clear empties but keeps the set
    await app.request(`${base}/c1/items`, { method: "DELETE" });
    expect(await j(await app.request(`${base}/c1/items`))).toEqual([]);

    // delete the set
    await app.request(`${base}/c1`, { method: "DELETE" });
    const after = await j(await app.request(base));
    expect(after.find((x: any) => x.id === "c1")).toBeUndefined();
  });

  it("rejects an item with no kind/ref (422)", async () => {
    await app.request(`${base}/c2`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "c2", title: "x" }),
    });
    const res = await app.request(`${base}/c2/items/bad`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: "2:2" }),
    });
    expect(res.status).toBe(422);
  });
});
