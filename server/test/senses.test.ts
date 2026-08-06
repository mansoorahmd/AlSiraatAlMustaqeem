// Word senses — meanings anchored at the ROOT (one primary per root), each with
// per-form refinements. A form's gloss = its refinement of the primary sense,
// else the sense's own text. Rootless words keep standalone lemma senses.

import { describe, it, expect, beforeAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { createState } from "../src/state.js";

let app: Hono;
const j = async (r: Response) => r.json() as any;
const put = (path: string, body: unknown) =>
  app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const B = "/api/v1/research";
const forWord = (lemma: string, root: string) =>
  `${B}/senses/for-word?lemma=${encodeURIComponent(lemma)}&root=${encodeURIComponent(root)}`;

beforeAll(() => { app = createApp(createState()); });

describe("word senses (root + refinements)", () => {
  it("root senses: first is primary, second isn't, primary can switch", async () => {
    const a = await j(await put(`${B}/senses/A`, { id: "A", root: "فلح", label: "attain", meaning: "reach the goal" }));
    expect(a).toMatchObject({ scope: "root", primary: true });
    const b = await j(await put(`${B}/senses/Bx`, { id: "Bx", root: "فلح", label: "cultivate", meaning: "till the soil" }));
    expect(b.primary).toBe(false);

    await put(`${B}/senses/Bx/primary`, {});
    const gloss = await j(await app.request(`${B}/senses/gloss`));
    expect(gloss.roots.find((r: any) => r.root === "فلح").text).toBe("cultivate");
    // switch back so later assertions use A as primary
    await put(`${B}/senses/A/primary`, {});
  });

  it("a refinement gives a form its own shade of a root sense", async () => {
    // refine sense A for the verb form أَفْلَحَ
    const ref = await j(await put(`${B}/refinements/rA`, { id: "rA", parentId: "A", lemma: "أَفْلَحَ", label: "he prospered", meaning: "attained the aim" }));
    expect(ref).toMatchObject({ scope: "lemma", parentId: "A", lemma: "أَفْلَحَ" });

    // for-word on the verb: sense A carries this form's refinement; the other form is empty
    const verb = await j(await app.request(forWord("أَفْلَحَ", "فلح")));
    const senseA = verb.rootSenses.find((s: any) => s.id === "A");
    expect(senseA.refinement.label).toBe("he prospered");
    expect(senseA.refinedCount).toBe(1);
    const part = await j(await app.request(forWord("مُفْلِحُون", "فلح")));
    expect(part.rootSenses.find((s: any) => s.id === "A").refinement).toBe(null); // needs completion
  });

  it("gloss uses the refinement for a refined form, the sense text otherwise", async () => {
    const g = await j(await app.request(`${B}/senses/gloss`));
    // primary is A ("attain"); the verb form has a refinement
    expect(g.roots.find((r: any) => r.root === "فلح").text).toBe("attain");
    const rf = g.refinements.find((x: any) => x.root === "فلح" && x.lemma === "أَفْلَحَ");
    expect(rf.text).toBe("he prospered");
  });

  it("deleting a root sense removes its refinements and promotes another", async () => {
    await app.request(`${B}/senses/A`, { method: "DELETE" });
    const senses = await j(await app.request(forWord("أَفْلَحَ", "فلح")));
    expect(senses.rootSenses.map((s: any) => s.id)).toEqual(["Bx"]); // A gone
    expect(senses.rootSenses[0].primary).toBe(true); // Bx promoted
    // A's refinement is gone with it
    const g = await j(await app.request(`${B}/senses/gloss`));
    expect(g.refinements.find((x: any) => x.lemma === "أَفْلَحَ")).toBeUndefined();
  });

  it("rootless word keeps a standalone lemma sense", async () => {
    await put(`${B}/senses/L1`, { id: "L1", lemma: "مِن", label: "from/of", meaning: "origin or part" });
    const w = await j(await app.request(`${B}/senses/for-word?lemma=${encodeURIComponent("مِن")}`));
    expect(w.lemmaSenses).toHaveLength(1);
    expect(w.lemmaSenses[0].primary).toBe(true);
    const g = await j(await app.request(`${B}/senses/gloss`));
    expect(g.lemmas.find((x: any) => x.lemma === "مِن").text).toBe("from/of");
  });

  it("refinement requires an existing root sense (404)", async () => {
    const res = await put(`${B}/refinements/bad`, { id: "bad", parentId: "nope", lemma: "x", label: "y", meaning: "z" });
    expect(res.status).toBe(404);
  });
});
