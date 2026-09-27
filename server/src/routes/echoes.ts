// Verbatim-echo routes (V10). Mounted by both hosts (see routes/content.ts).

import { Hono } from "hono";
import type { CorpusServices } from "../corpus-services.js";

export function echoRoutes(svc: CorpusServices): Hono {
  const r = new Hono();

  r.get("/chapters/:id/echoes", async (c) => {
    const id = Number(c.req.param("id"));
    if (!(await svc.content.getChapter(id))) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(await svc.echoes.chapterEchoes(id));
  });

  r.get("/verses/:key/echoes", async (c) => {
    const key = c.req.param("key");
    if (!(await svc.content.getVerse(key))) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(await svc.echoes.echoesForVerse(key));
  });

  return r;
}
