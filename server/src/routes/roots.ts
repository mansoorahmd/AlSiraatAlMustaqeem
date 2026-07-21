// Roots, forms, occurrences, and linkages routes.

import { Hono } from "hono";
import type { AppState } from "../state.js";
import { qint, qstr, qbool } from "../http.js";

export function rootRoutes(state: AppState): Hono {
  const r = new Hono();

  r.get("/roots", (c) => {
    const orderBy = qstr(c, "order_by", "count");
    if (!/^(count|forms|letters|alpha|arabic)$/.test(orderBy)) return c.json({ detail: "bad order_by" }, 422);
    return c.json(state.roots.listRoots({
      orderBy,
      descending: c.req.query("descending") == null ? true : qbool(c, "descending", true),
      limit: qint(c, "limit", 50, { min: 1, max: 2000}) ?? 50,
      offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
    }));
  });

  r.get("/roots/:root/forms", (c) => c.json(state.roots.listForms(c.req.param("root"))));

  r.get("/roots/:root/occurrences", (c) =>
    c.json(state.roots.occurrences(c.req.param("root"), {
      script: qstr(c, "script", "uthmani"),
      limit: qint(c, "limit", 100, { min: 1, max: 3000 }) ?? 100,
      offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
    })),
  );

  r.get("/roots/:root/linkages", (c) => {
    const root = c.req.param("root");
    const links = state.linkages.coOccurringRoots(root, {
      scope: (qstr(c, "scope", "ayah") as "ayah" | "adjacent"),
      window: qint(c, "window", 1, { min: 1, max: 10 }) ?? 1,
      minCount: qint(c, "min_count", 2, { min: 1 }) ?? 2,
      limit: qint(c, "limit", 30, { min: 1, max: 500 }) ?? 30,
      sortBy: (qstr(c, "sort_by", "score") as "score" | "count"),
    });
    if (links.length === 0 && state.roots.getRoot(root) === null) {
      return c.json({ detail: `root not found: ${root}` }, 404);
    }
    return c.json(links);
  });

  r.get("/roots/:root", (c) => {
    const detail = state.roots.getRoot(c.req.param("root"));
    if (detail === null) return c.json({ detail: `root not found: ${c.req.param("root")}` }, 404);
    return c.json(detail);
  });

  return r;
}
