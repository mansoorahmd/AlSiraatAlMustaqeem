// Similarity + free-text search routes.

import { Hono } from "hono";
import type { AppState } from "../state.js";
import { qint } from "../http.js";
import { expressionSearch, type ExprTerm, type ExprMode } from "../expressions.js";

function weights(c: { req: { query: (k: string) => string | undefined } }) {
  const g = (k: string) => {
    const v = c.req.query(k);
    return v == null ? undefined : parseFloat(v);
  };
  const w: Record<string, number> = {};
  const o = g("w_overlap"), p = g("w_phrase"), m = g("w_morphology");
  if (o != null && !Number.isNaN(o)) w.overlap = o;
  if (p != null && !Number.isNaN(p)) w.phrase = p;
  if (m != null && !Number.isNaN(m)) w.morphology = m;
  return Object.keys(w).length ? w : undefined;
}

export function similarityRoutes(state: AppState): Hono {
  const r = new Hono();

  r.get("/verses/:key/similar", (c) => {
    const key = c.req.param("key");
    const matches = state.engine.similarVerses(key, {
      topK: qint(c, "top_k", 20, { min: 1, max: 200 }) ?? 20,
      minShared: qint(c, "min_shared", 1, { min: 1 }) ?? 1,
      weights: weights(c),
    });
    if (matches.length === 0) return c.json({ detail: `verse not found or has no roots: ${key}` }, 404);
    return c.json(matches);
  });

  r.post("/search", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? v : undefined);
    const w: Record<string, number> = {};
    if (num(body.w_overlap) != null) w.overlap = body.w_overlap as number;
    if (num(body.w_phrase) != null) w.phrase = body.w_phrase as number;
    if (num(body.w_morphology) != null) w.morphology = body.w_morphology as number;
    const result = state.freetext.search(String(body.text ?? ""), {
      topK: (num(body.top_k) as number) ?? 20,
      minShared: (num(body.min_shared) as number) ?? 1,
      weights: Object.keys(w).length ? w : undefined,
    });
    return c.json(result);
  });

  r.post("/expression-search", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      terms?: { surface?: string; root?: string | null }[];
      mode?: ExprMode;
      limit?: number;
    };
    const terms: ExprTerm[] = (body.terms ?? []).map((t) => ({
      surface: t.surface ?? "",
      rootBuckwalter: t.root ?? null,
    }));
    const mode: ExprMode = body.mode === "roots" ? "roots" : "verbatim";
    return c.json(expressionSearch(state.quran, terms, mode, body.limit ?? 300));
  });

  return r;
}
