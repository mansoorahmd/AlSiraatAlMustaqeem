// Link routes: what an āyah shares with the rest of the Book, and the markers that tie exactly a
// few āyāt together. Mounted by both hosts (see routes/content.ts).

import { Hono } from "hono";
import type { CorpusServices } from "../corpus-services.js";
import type { ExclusiveKind } from "../links.js";

const KINDS: readonly ExclusiveKind[] = ["root", "lemma", "form", "phrase"];
const int = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);

export function linkRoutes(svc: CorpusServices): Hono {
  const r = new Hono();

  // ?max= the most āyāt a marker may be in to be listed with its places (default 20)
  r.get("/verses/:key/links", async (c) => {
    const key = c.req.param("key");
    const max = int(c.req.query("max"));
    const links = await svc.links.linksForVerse(key, { max: max ? Math.min(max, 200) : undefined });
    if (!links) return c.json({ detail: `verse not found: ${key}` }, 404);
    return c.json(links);
  });

  // ?kind=root|lemma|form|phrase &n=2..5 &cross=1 &chapter= &limit= &offset=
  r.get("/links/exclusive", async (c) => {
    const kind = (c.req.query("kind") ?? "lemma") as ExclusiveKind;
    if (!KINDS.includes(kind)) return c.json({ detail: `kind must be one of ${KINDS.join(", ")}` }, 400);
    return c.json(await svc.links.exclusive({
      kind,
      n: int(c.req.query("n")),
      cross: c.req.query("cross") === "1",
      chapter: int(c.req.query("chapter")),
      limit: int(c.req.query("limit")),
      offset: int(c.req.query("offset")),
    }));
  });

  return r;
}
