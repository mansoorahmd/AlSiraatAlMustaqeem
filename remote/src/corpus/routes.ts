// The corpus over HTTP, from Postgres — mounted at /corpus behind requireCorpusAccess.
//
// Same paths, same query parameters and same JSON as the local API's content routes
// (server/src/routes/content.ts), so a client moves by changing its base URL and nothing else:
//   local   GET /api/v1/verses/2:255?words=true
//   cloud   GET /corpus/verses/2:255?words=true
// Translations are filtered to what the caller's plan reaches (corpus-access.ts).

import { Hono, type Context } from "hono";
import type { SqlRunner } from "../migrate.js";
import type { Env } from "../roles.js";
import { translationFilter } from "../corpus-access.js";
import { PgQuranContent, SCRIPTS, HttpError } from "./content.js";

// query coercion identical to server/src/http.ts (qbool / qint / qstr)
function qbool(c: Context, name: string, dflt = false): boolean {
  const v = c.req.query(name);
  if (v == null) return dflt;
  return v === "true" || v === "1" || v === "yes";
}
function qint(c: Context, name: string, dflt: number | null = null, b?: { min?: number; max?: number }): number | null {
  const v = c.req.query(name);
  if (v == null || v === "") return dflt;
  let n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  if (b?.min != null) n = Math.max(b.min, n);
  if (b?.max != null) n = Math.min(b.max, n);
  return n;
}
const qstr = (c: Context, name: string, dflt = ""): string => c.req.query(name) ?? dflt;

type Handler = (c: Context<Env>) => Promise<Response>;
/** The server maps HttpError to `{ detail }` in app.onError; do the same, per route. */
const h = (fn: Handler): Handler => async (c) => {
  try { return await fn(c); } catch (e) {
    if (e instanceof HttpError) return c.json({ detail: e.message }, e.status as 400);
    throw e;
  }
};

export function corpusRoutes(r: SqlRunner): Hono<Env> {
  const app = new Hono<Env>();
  const content = new PgQuranContent(r);
  const allowFor = (c: Context<Env>) => translationFilter(r, c.get("user"));

  app.get("/scripts", (c) => c.json(Object.keys(SCRIPTS).sort()));

  app.get("/chapters", h(async (c) => c.json(await content.listChapters())));

  app.get("/chapters/:id", h(async (c) => {
    const id = Number(c.req.param("id"));
    const ch = await content.getChapter(id);
    if (!ch) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(ch);
  }));

  app.get("/chapters/:id/verses", h(async (c) => {
    const id = Number(c.req.param("id"));
    if (!(await content.getChapter(id))) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(await content.chapterVerses(id, {
      script: qstr(c, "script", "uthmani"),
      allScripts: qbool(c, "all_scripts"),
      withWords: qbool(c, "words"),
      limit: qint(c, "limit", null, { min: 1, max: 300 }),
      offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
    }));
  }));

  app.get("/verses", h(async (c) => c.json(await content.listVerses({
    script: qstr(c, "script", "uthmani"),
    limit: qint(c, "limit", 50, { min: 1, max: 300 }) ?? 50,
    offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
    chapter: qint(c, "chapter", null, { min: 1, max: 114 }) ?? undefined,
    juz: qint(c, "juz", null, { min: 1, max: 30 }) ?? undefined,
    hizb: qint(c, "hizb", null, { min: 1, max: 60 }) ?? undefined,
    page: qint(c, "page", null, { min: 1, max: 604 }) ?? undefined,
    ruku: qint(c, "ruku", null, { min: 1 }) ?? undefined,
    manzil: qint(c, "manzil", null, { min: 1, max: 7 }) ?? undefined,
  }))));

  app.get("/verses/:key/neighbours", h(async (c) => {
    const key = c.req.param("key") ?? "";
    const rows = await content.verseNeighbours(key, {
      radius: qint(c, "radius", 2, { min: 1, max: 20 }) ?? 2,
      script: qstr(c, "script", "uthmani"),
    });
    if (rows === null) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(rows);
  }));

  app.get("/verses/:key/words", h(async (c) => {
    const key = c.req.param("key") ?? "";
    if (!(await content.getVerse(key))) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(await content.verseWords(key));
  }));

  app.get("/verses/:key/translations", h(async (c) => {
    const key = c.req.param("key") ?? "";
    if (!(await content.getVerse(key))) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(await content.verseTranslations(key, await allowFor(c)));
  }));

  app.get("/verses/:key", h(async (c) => {
    const key = c.req.param("key") ?? "";
    const v = await content.getVerse(key, {
      script: qstr(c, "script", "uthmani"),
      allScripts: qbool(c, "all_scripts"),
      withWords: qbool(c, "words"),
      withTranslations: qbool(c, "translations"),
      allow: await allowFor(c),
    });
    if (!v) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(v);
  }));

  app.get("/translation-resources", h(async (c) =>
    c.json(await content.listTranslationResources(await allowFor(c)))));

  return app;
}
