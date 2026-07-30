// Wazn (صرف pattern) — new feature (no Python oracle); checked against known words.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const wazn = async (key: string, pos: number) =>
  (await (await app.request(`/api/v1/verses/${key}/wazn?pos=${pos}`)).json()) as any;

beforeAll(() => { app = createApp(createState()); });

describe("wazn", () => {
  it("iqraʾ (96:1 w1) is a Form I imperative verb", async () => {
    const w = await wazn("96:1", 1);
    expect(w.kind).toBe("verb");
    expect(w.form).toBe("I");
    expect(w.aspect).toContain("command");
  });

  it("ihdinā (1:6 w1) is a verb of root ه‑د‑ي", async () => {
    const w = await wazn("1:6", 1);
    expect(w.kind).toBe("verb");
    expect(w.radicals).toEqual(["ه", "د", "ي"]);
  });

  it("a plain noun (1:2 w1, al-ḥamd) has no wazn", async () => {
    expect(await wazn("1:2", 1)).toBeNull();
  });

  it("missing pos → 422", async () => {
    expect((await app.request("/api/v1/verses/1:1/wazn")).status).toBe(422);
  });
});
