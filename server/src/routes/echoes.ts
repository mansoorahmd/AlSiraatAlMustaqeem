// Verbatim-echo routes (V10).

import { Hono } from "hono";
import type { AppState } from "../state.js";

export function echoRoutes(state: AppState): Hono {
  const r = new Hono();

  r.get("/chapters/:id/echoes", (c) => {
    const id = Number(c.req.param("id"));
    if (!state.content.getChapter(id)) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(state.echoes.chapterEchoes(id));
  });

  r.get("/verses/:key/echoes", (c) => {
    const key = c.req.param("key");
    if (!state.content.getVerse(key)) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(state.echoes.echoesForVerse(key));
  });

  return r;
}
