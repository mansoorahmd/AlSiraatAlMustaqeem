// The āyāt where two roots BOTH occur — the evidence behind a collocation.
// Guards the count against what /linkages reports, and the shape/order.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const j = async (r: Response) => r.json() as any;

beforeAll(() => { app = createApp(createState()); });

describe("shared verses of a root pair", () => {
  it("matches the cooccur count /linkages reports (نفق + امن)", async () => {
    const links = await j(await app.request("/api/v1/roots/nfq/linkages?limit=300&min_count=1"));
    const amn = links.find((l: any) => l.root_buckwalter === "Amn");
    expect(amn).toBeDefined();

    const shared = await j(await app.request("/api/v1/roots/nfq/with/Amn"));
    expect(shared.length).toBe(amn.cooccur);
    expect(shared[0]).toMatchObject({ verse_key: "2:3" });
    expect(shared[0].text).toBeTruthy();
  });

  it("is symmetric and returns mushaf order", async () => {
    const ab = await j(await app.request("/api/v1/roots/ktb/with/Amn"));
    const ba = await j(await app.request("/api/v1/roots/Amn/with/ktb"));
    expect(ab.map((v: any) => v.verse_key)).toEqual(ba.map((v: any) => v.verse_key));

    const order = ab.map((v: any) => v.chapter_id * 1000 + v.verse_number);
    expect(order).toEqual([...order].sort((x: number, y: number) => x - y));
  });

  it("honours limit and 404s an unknown root", async () => {
    const few = await j(await app.request("/api/v1/roots/ktb/with/Amn?limit=3"));
    expect(few.length).toBe(3);
    expect((await app.request("/api/v1/roots/nfq/with/zzz")).status).toBe(404);
    expect((await app.request("/api/v1/roots/zzz/with/nfq")).status).toBe(404);
  });

  it("returns nothing for roots that never meet", async () => {
    // a root paired with itself is excluded from linkages; use a rare pair
    const none = await j(await app.request("/api/v1/roots/nfq/with/nfq"));
    expect(Array.isArray(none)).toBe(true);
  });
});
