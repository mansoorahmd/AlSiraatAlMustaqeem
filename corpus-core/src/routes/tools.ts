// Study-tool routes: every place a thing occurs, the Book's spelling variants, where speech opens,
// an āyah's pronouns, a wording check, the difference between two āyāt, where a set of roots
// spreads, where the Lord is addressed, and what a sūrah's opening shares with its close. They
// find and count; none interprets. Mounted by both hosts (see routes/content.ts).

import { Hono } from "hono";
import type { CorpusServices } from "../corpus-services.js";
import { OccurrenceRequestError, parseOccurrenceRequest } from "../occurrences.js";
import { speechOpeners, ayahPronouns, parseExtraRoots } from "../voices.js";
import { WordingTooLong } from "../wording.js";
import { parseSpreadRequest, rootSpread, SpreadRequestError } from "../spread.js";
import { isSupplicationOpening, supplications, SUPPLICATION_OPENINGS } from "../supplications.js";
import { FRAME_DEFAULT_N, FRAME_MAX_N, surahFrame } from "../frame.js";

const int = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);
const VERSE_KEY = /^\d{1,3}:\d{1,3}$/;

export function toolRoutes(svc: CorpusServices): Hono {
  const r = new Hono();

  // body: { kind, key, query?, limit?, offset? }
  r.post("/occurrences", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    let q;
    try {
      q = parseOccurrenceRequest(body);
    } catch (e) {
      if (e instanceof OccurrenceRequestError) return c.json({ detail: e.message }, 400);
      throw e;
    }
    return c.json(await svc.occurrences.find(q));
  });

  // ?kind= one kind of difference &q= Arabic to look for &sort=alpha (by the Arabic alphabet) &limit= &offset=
  r.get("/spellings", async (c) =>
    c.json(await svc.spellings.list({
      kind: c.req.query("kind") || undefined,
      q: c.req.query("q") || undefined,
      sort: c.req.query("sort") === "alpha" ? "alpha" : undefined,
      limit: int(c.req.query("limit")),
      offset: int(c.req.query("offset")),
    })));

  r.get("/spellings/:key", async (c) => {
    const key = c.req.param("key");
    const g = await svc.spellings.group(key);
    if (!g) return c.json({ detail: `no spelling group: ${key}` }, 404);
    return c.json(g);
  });

  // ?roots= extra roots in Arabic letters, comma-separated (at most 10); unknown ones find nothing
  r.get("/chapters/:id/speech-openers", async (c) => {
    const id = c.req.param("id");
    let roots: string[];
    try {
      roots = parseExtraRoots(c.req.query("roots"));
    } catch (e) {
      if (e instanceof RangeError) return c.json({ detail: e.message }, 422);
      throw e;
    }
    const out = /^\d+$/.test(id) ? await speechOpeners(svc.corpus, Number(id), roots) : null;
    if (!out) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(out);
  });

  // ?verbs=1 also the person, number and gender each verb carries
  r.get("/verses/:key/pronouns", async (c) => {
    const key = c.req.param("key");
    const out = VERSE_KEY.test(key) ? await ayahPronouns(svc.corpus, key, { verbs: c.req.query("verbs") === "1" }) : null;
    if (!out) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(out);
  });

  // body: { text } — at most 200 words
  r.post("/wording-check", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { text?: unknown } | undefined;
    if (!body || typeof body.text !== "string") return c.json({ detail: "the body must be a JSON object with `text`" }, 422);
    try {
      return c.json(await svc.wording.check(body.text));
    } catch (e) {
      if (e instanceof WordingTooLong) return c.json({ detail: e.message }, 422);
      throw e;
    }
  });

  // body: { roots: string[] } — 1 to 60 roots, Arabic letters or Buckwalter
  r.post("/spread", async (c) => {
    let roots: string[];
    try {
      roots = parseSpreadRequest(await c.req.json().catch(() => undefined));
    } catch (e) {
      if (e instanceof SpreadRequestError) return c.json({ detail: e.message }, 422);
      throw e;
    }
    return c.json(await rootSpread(svc.corpus, roots));
  });

  // ?opening=rabbana|rabbi|allahumma
  r.get("/supplications", async (c) => {
    const opening = c.req.query("opening") || undefined;
    if (opening !== undefined && !isSupplicationOpening(opening)) {
      return c.json({ detail: `opening must be one of ${SUPPLICATION_OPENINGS.map((o) => o.id).join(", ")}` }, 422);
    }
    return c.json(await supplications(svc.corpus, opening));
  });

  // ?n= āyāt at each end, 1 to 10 (default 3)
  r.get("/chapters/:id/frame", async (c) => {
    const id = c.req.param("id");
    const nq = c.req.query("n");
    const n = nq === undefined || nq === "" ? FRAME_DEFAULT_N : int(nq);
    if (n === undefined || n < 1 || n > FRAME_MAX_N) return c.json({ detail: `n must be a whole number from 1 to ${FRAME_MAX_N}` }, 422);
    const out = /^\d+$/.test(id) ? await surahFrame(svc.corpus, Number(id), n) : null;
    if (!out) return c.json({ detail: `chapter not found: ${id}` }, 404);
    return c.json(out);
  });

  // ?a=2:35&b=7:19
  r.get("/diff", async (c) => {
    const a = c.req.query("a") ?? "";
    const b = c.req.query("b") ?? "";
    if (!a || !b) return c.json({ detail: "a and b are required (verse keys, e.g. a=2:35&b=7:19)" }, 422);
    const out = await svc.wording.diff(a, b);
    if (!out) return c.json({ detail: `verse not found: ${a} or ${b}` }, 404);
    return c.json(out);
  });

  return r;
}
