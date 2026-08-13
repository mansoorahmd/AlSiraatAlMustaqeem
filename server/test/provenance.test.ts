// Provenance: records proposed by an AI (via the MCP server) are tagged
// source='ai' so the reader can always tell them apart, review them, and either
// accept them as their own or discard them.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const j = async (r: Response) => r.json() as any;
const put = (path: string, body: unknown) =>
  app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const B = "/api/v1/research";

beforeAll(() => { app = createApp(createState()); });

describe("provenance of research records", () => {
  it("defaults to the reader ('me') when no source is given", async () => {
    const n = await j(await put(`${B}/notes/p_mine`, { id: "p_mine", verseKey: "2:2", kind: "note", text: "mine" }));
    expect(n.source ?? "me").toBe("me");
    const back = await j(await app.request(`${B}/notes?verse=2:2`));
    expect(back.find((x: any) => x.id === "p_mine").source).toBe("me");
  });

  it("keeps an AI-proposed note tagged, and lists it for review", async () => {
    await put(`${B}/notes/p_ai`, { id: "p_ai", verseKey: "2:3", kind: "question", text: "from the model", source: "ai" });
    const proposed = await j(await app.request(`${B}/proposed`));
    expect(proposed.notes.map((x: any) => x.id)).toContain("p_ai");
    expect(proposed.notes.every((x: any) => x.source === "ai")).toBe(true);
    // the reader's own note is not in the review list
    expect(proposed.notes.map((x: any) => x.id)).not.toContain("p_mine");
  });

  it("accepting a proposal makes it the reader's own", async () => {
    expect((await app.request(`${B}/proposed/note/p_ai/accept`, { method: "PUT" })).status).toBe(200);
    const proposed = await j(await app.request(`${B}/proposed`));
    expect(proposed.notes.map((x: any) => x.id)).not.toContain("p_ai");
    const notes = await j(await app.request(`${B}/notes?verse=2:3`));
    expect(notes.find((x: any) => x.id === "p_ai").source).toBe("me");
  });

  it("accepting something that isn't AI-proposed is a 404", async () => {
    expect((await app.request(`${B}/proposed/note/p_mine/accept`, { method: "PUT" })).status).toBe(404);
    expect((await app.request(`${B}/proposed/note/nope/accept`, { method: "PUT" })).status).toBe(404);
    expect((await app.request(`${B}/proposed/bogus/x/accept`, { method: "PUT" })).status).toBe(422);
  });

  it("stamps the reader's local identity and origin on records they create", async () => {
    const { localId } = await j(await app.request(`${B}/identity`));
    expect(localId).toBeTruthy();
    // a note the reader made carries their author_id and origin='local'
    const mine = (await j(await app.request(`${B}/notes?verse=2:2`))).find((x: any) => x.id === "p_mine");
    expect(mine.authorId).toBe(localId);
    expect(mine.origin).toBe("local");
    // an AI-proposed record is still local-origin (it lives in the reader's db) but
    // stays distinguishable by source='ai' — origin answers "local vs remote", not "who"
    const ai = (await j(await app.request(`${B}/notes?verse=2:3`))).find((x: any) => x.id === "p_ai");
    expect(ai.origin).toBe("local");
  });

  it("indications carry provenance too", async () => {
    await put(`${B}/indications/p_ind`, { id: "p_ind", root: "علم", label: "ai idea", meaning: "", source: "ai" });
    const proposed = await j(await app.request(`${B}/proposed`));
    expect(proposed.indications.map((x: any) => x.id)).toContain("p_ind");
    expect((await app.request(`${B}/proposed/indication/p_ind/accept`, { method: "PUT" })).status).toBe(200);
    expect((await j(await app.request(`${B}/proposed`))).indications.map((x: any) => x.id)).not.toContain("p_ind");
  });
});
