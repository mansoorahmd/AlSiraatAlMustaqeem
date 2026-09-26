// Content & metadata routes — ports of the FastAPI content endpoints.
//
// Mounted by BOTH hosts over the same services (corpus-services.ts): the local server at
// /api/v1 (SQLite) and the cloud remote at /corpus (Postgres). `ent` lets a host filter
// translations by the caller's plan; absent, nothing is filtered.

import { Hono } from "hono";
import { SCRIPTS } from "../content.js";
import { waznForWord } from "../wazn.js";
import { qbool, qint, qstr } from "../http.js";
import type { CorpusServices, Entitlements } from "../corpus-services.js";

export function contentRoutes(svc: CorpusServices, ent: Entitlements = {}): Hono {
  const r = new Hono();
  const allowT = (c: Parameters<NonNullable<Entitlements["translations"]>>[0]) =>
    ent.translations ? ent.translations(c) : Promise.resolve(undefined);

  r.get("/scripts", (c) => c.json(Object.keys(SCRIPTS).sort()));

  r.get("/chapters", async (c) => c.json(await svc.content.listChapters()));

  r.get("/chapters/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const ch = await svc.content.getChapter(id);
    if (!ch) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(ch);
  });

  r.get("/chapters/:id/verses", async (c) => {
    const id = Number(c.req.param("id"));
    if (!(await svc.content.getChapter(id))) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(
      await svc.content.chapterVerses(id, {
        script: qstr(c, "script", "uthmani"),
        allScripts: qbool(c, "all_scripts"),
        withWords: qbool(c, "words"),
        limit: qint(c, "limit", null, { min: 1, max: 300 }),
        offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
      }),
    );
  });

  r.get("/verses", async (c) =>
    c.json(
      await svc.content.listVerses({
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

  r.get("/phrase-search", async (c) => {
    const q = qstr(c, "q");
    if (!q) return c.json({ detail: "q is required" }, 422);
    return c.json(
      await svc.content.phraseSearch(q, {
        script: qstr(c, "script", "uthmani"),
        limit: qint(c, "limit", 50, { min: 1, max: 300 }) ?? 50,
      }),
    );
  });

  r.get("/verses/:key/neighbours", async (c) => {
    const key = c.req.param("key");
    const rows = await svc.content.verseNeighbours(key, {
      radius: qint(c, "radius", 2, { min: 1, max: 20 }) ?? 2,
      script: qstr(c, "script", "uthmani"),
    });
    if (rows === null) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(rows);
  });

  r.get("/verses/:key/words", async (c) => {
    const key = c.req.param("key");
    if (!(await svc.content.getVerse(key))) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(await svc.content.verseWords(key));
  });

  // every place a word is written exactly this way (rasm; vowel marks ignored).
  // Powers "follow this exact word" — works for particles and names with no root.
  // ?full=1 keeps each occurrence's written surface, and adds the total and related forms —
  // what the MCP's trace_word reports; the default contract stays {verse_key, word_position}.
  r.get("/words/occurrences", async (c) => {
    const surface = qstr(c, "surface");
    if (!surface) return c.json({ detail: "surface is required" }, 422);
    const limit = qint(c, "limit", 3000, { min: 1, max: 6000 }) ?? 3000;
    const list = await svc.wordForms.occurrences(surface, limit);
    if (qbool(c, "full")) {
      return c.json({
        occurrences: list,
        total: await svc.wordForms.total(surface),
        related: await svc.wordForms.relatedForms(surface, qint(c, "related", 12, { min: 0, max: 100 }) ?? 12),
      });
    }
    return c.json(list.map(({ verse_key, word_position }) => ({ verse_key, word_position })));
  });

  // verses in a chapter that contain rasm-variant words (+ their positions)
  r.get("/chapters/:id/variants", async (c) => {
    const id = Number(c.req.param("id"));
    if (!(await svc.content.getChapter(id))) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(await svc.spellings.chapterVariants(id));
  });

  // wazn (صرف pattern) of one word — ?pos= the 1-based word position
  r.get("/verses/:key/wazn", async (c) => {
    const key = c.req.param("key");
    const pos = qint(c, "pos", null, { min: 1 });
    if (pos == null) return c.json({ detail: "pos is required" }, 422);
    return c.json(await waznForWord(svc.corpus, key, pos));
  });

  // spelling / rasm variants of one word (same word written ≥2 ways)
  r.get("/verses/:key/spelling", async (c) => {
    const key = c.req.param("key");
    const pos = qint(c, "pos", null, { min: 1 });
    if (pos == null) return c.json({ detail: "pos is required" }, 422);
    return c.json(await svc.spellings.variantsForWord(key, pos));
  });

  r.get("/verses/:key/translations", async (c) => {
    const key = c.req.param("key");
    if (!(await svc.content.getVerse(key))) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(await svc.content.verseTranslations(key, await allowT(c)));
  });

  r.get("/verses/:key", async (c) => {
    const key = c.req.param("key");
    const v = await svc.content.getVerse(key, {
      script: qstr(c, "script", "uthmani"),
      allScripts: qbool(c, "all_scripts"),
      withWords: qbool(c, "words"),
      withTranslations: qbool(c, "translations"),
      allow: await allowT(c),
    });
    if (!v) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(v);
  });

  r.get("/translation-resources", async (c) =>
    c.json(await svc.content.listTranslationResources(await allowT(c))));

  return r;
}
