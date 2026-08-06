// Content & metadata routes — ports of the FastAPI content endpoints.

import { Hono } from "hono";
import type { AppState } from "../state.js";
import { SCRIPTS } from "../content.js";
import { waznForWord } from "../wazn.js";
import { qbool, qint, qstr } from "../http.js";

export function contentRoutes(state: AppState): Hono {
  const r = new Hono();

  r.get("/scripts", (c) => c.json(Object.keys(SCRIPTS).sort()));

  r.get("/chapters", (c) => c.json(state.content.listChapters()));

  r.get("/chapters/:id", (c) => {
    const id = Number(c.req.param("id"));
    const ch = state.content.getChapter(id);
    if (!ch) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(ch);
  });

  r.get("/chapters/:id/verses", (c) => {
    const id = Number(c.req.param("id"));
    if (!state.content.getChapter(id)) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(
      state.content.chapterVerses(id, {
        script: qstr(c, "script", "uthmani"),
        allScripts: qbool(c, "all_scripts"),
        withWords: qbool(c, "words"),
        limit: qint(c, "limit", null, { min: 1, max: 300 }),
        offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
      }),
    );
  });

  r.get("/verses", (c) =>
    c.json(
      state.content.listVerses({
        script: qstr(c, "script", "uthmani"),
        limit: qint(c, "limit", 50, { min: 1, max: 300 }) ?? 50,
        offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
        chapter: qint(c, "chapter", null, { min: 1, max: 114 }) ?? undefined,
        juz: qint(c, "juz", null, { min: 1, max: 30 }) ?? undefined,
        hizb: qint(c, "hizb", null, { min: 1, max: 60 }) ?? undefined,
        page: qint(c, "page", null, { min: 1, max: 604 }) ?? undefined,
        ruku: qint(c, "ruku", null, { min: 1 }) ?? undefined,
        manzil: qint(c, "manzil", null, { min: 1, max: 7 }) ?? undefined,
      }),
    ),
  );

  r.get("/phrase-search", (c) => {
    const q = qstr(c, "q");
    if (!q) return c.json({ detail: "q is required" }, 422);
    return c.json(
      state.content.phraseSearch(q, {
        script: qstr(c, "script", "uthmani"),
        limit: qint(c, "limit", 50, { min: 1, max: 300 }) ?? 50,
      }),
    );
  });

  r.get("/verses/:key/neighbours", (c) => {
    const key = c.req.param("key");
    const rows = state.content.verseNeighbours(key, {
      radius: qint(c, "radius", 2, { min: 1, max: 20 }) ?? 2,
      script: qstr(c, "script", "uthmani"),
    });
    if (rows === null) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(rows);
  });

  r.get("/verses/:key/words", (c) => {
    const key = c.req.param("key");
    if (!state.content.getVerse(key)) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(state.content.verseWords(key));
  });

  // every place a word is written exactly this way (rasm; vowel marks ignored).
  // Powers "follow this exact word" — works for particles and names with no root.
  r.get("/words/occurrences", (c) => {
    const surface = qstr(c, "surface");
    if (!surface) return c.json({ detail: "surface is required" }, 422);
    return c.json(state.wordForms.occurrences(surface, qint(c, "limit", 3000, { min: 1, max: 6000 }) ?? 3000));
  });

  // verses in a chapter that contain rasm-variant words (+ their positions)
  r.get("/chapters/:id/variants", (c) => {
    const id = Number(c.req.param("id"));
    if (!state.content.getChapter(id)) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(state.spellings.chapterVariants(id));
  });

  // wazn (صرف pattern) of one word — ?pos= the 1-based word position
  r.get("/verses/:key/wazn", (c) => {
    const key = c.req.param("key");
    const pos = qint(c, "pos", null, { min: 1 });
    if (pos == null) return c.json({ detail: "pos is required" }, 422);
    return c.json(waznForWord(state.quran, key, pos));
  });

  // spelling / rasm variants of one word (same word written ≥2 ways)
  r.get("/verses/:key/spelling", (c) => {
    const key = c.req.param("key");
    const pos = qint(c, "pos", null, { min: 1 });
    if (pos == null) return c.json({ detail: "pos is required" }, 422);
    return c.json(state.spellings.variantsForWord(key, pos));
  });

  r.get("/verses/:key/translations", (c) => {
    const key = c.req.param("key");
    if (!state.content.getVerse(key)) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(state.content.verseTranslations(key));
  });

  r.get("/verses/:key", (c) => {
    const key = c.req.param("key");
    const v = state.content.getVerse(key, {
      script: qstr(c, "script", "uthmani"),
      allScripts: qbool(c, "all_scripts"),
      withWords: qbool(c, "words"),
      withTranslations: qbool(c, "translations"),
    });
    if (!v) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(v);
  });

  r.get("/translation-resources", (c) => c.json(state.content.listTranslationResources()));

  return r;
}
