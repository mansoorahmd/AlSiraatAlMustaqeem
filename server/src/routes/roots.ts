// Roots, forms, occurrences, and linkages routes.
//
// Mounted by both hosts (see routes/content.ts). `ent.lexicons` lets a host leave out the
// dictionaries a caller's plan doesn't reach from a root's meanings.

import { Hono } from "hono";
import { qint, qstr, qbool } from "../http.js";
import type { CorpusServices, Entitlements } from "../corpus-services.js";

export function rootRoutes(svc: CorpusServices, ent: Entitlements = {}): Hono {
  const r = new Hono();

  r.get("/roots", async (c) => {
    const orderBy = qstr(c, "order_by", "count");
    if (!/^(count|forms|letters|alpha|arabic)$/.test(orderBy)) return c.json({ detail: "bad order_by" }, 422);
    return c.json(await svc.roots.listRoots({
      orderBy,
      descending: c.req.query("descending") == null ? true : qbool(c, "descending", true),
      limit: qint(c, "limit", 50, { min: 1, max: 2000}) ?? 50,
      offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
    }));
  });

  r.get("/roots/:root/forms", async (c) => c.json(await svc.roots.listForms(c.req.param("root"))));

  r.get("/roots/:root/occurrences", async (c) =>
    c.json(await svc.roots.occurrences(c.req.param("root"), {
      script: qstr(c, "script", "uthmani"),
      limit: qint(c, "limit", 100, { min: 1, max: 3000 }) ?? 100,
      offset: qint(c, "offset", 0, { min: 0 }) ?? 0,
    })),
  );

  // the āyāt where this root and another BOTH occur — the evidence for a collocation
  r.get("/roots/:root/with/:other", async (c) => {
    const root = c.req.param("root");
    const other = c.req.param("other");
    if ((await svc.roots.getRoot(root)) === null) return c.json({ detail: `root not found: ${root}` }, 404);
    if ((await svc.roots.getRoot(other)) === null) return c.json({ detail: `root not found: ${other}` }, 404);
    return c.json(await svc.linkages.sharedVerses(
      root, other,
      qstr(c, "script", "uthmani") ?? "uthmani",
      qint(c, "limit", 300, { min: 1, max: 500 }) ?? 300,
    ));
  });

  r.get("/roots/:root/linkages", async (c) => {
    const root = c.req.param("root");
    const links = await svc.linkages.coOccurringRoots(root, {
      scope: (qstr(c, "scope", "ayah") as "ayah" | "adjacent"),
      window: qint(c, "window", 1, { min: 1, max: 10 }) ?? 1,
      minCount: qint(c, "min_count", 2, { min: 1 }) ?? 2,
      limit: qint(c, "limit", 30, { min: 1, max: 500 }) ?? 30,
      sortBy: (qstr(c, "sort_by", "score") as "score" | "count"),
    });
    if (links.length === 0 && (await svc.roots.getRoot(root)) === null) {
      return c.json({ detail: `root not found: ${root}` }, 404);
    }
    return c.json(links);
  });

  r.get("/roots/:root", async (c) => {
    const allow = ent.lexicons ? await ent.lexicons(c) : undefined;
    const detail = await svc.roots.getRoot(c.req.param("root"), allow);
    if (detail === null) return c.json({ detail: `root not found: ${c.req.param("root")}` }, 404);
    return c.json(detail);
  });

  return r;
}
