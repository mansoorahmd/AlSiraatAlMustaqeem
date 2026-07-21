// Tiny query-param helpers so route handlers stay declarative and match the
// FastAPI coercion behaviour (bool from "true"/"1", ints with optional bounds).

import type { Context } from "hono";

export function qbool(c: Context, name: string, dflt = false): boolean {
  const v = c.req.query(name);
  if (v == null) return dflt;
  return v === "true" || v === "1" || v === "yes";
}

export function qint(
  c: Context,
  name: string,
  dflt: number | null = null,
  bounds?: { min?: number; max?: number },
): number | null {
  const v = c.req.query(name);
  if (v == null || v === "") return dflt;
  let n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  if (bounds?.min != null) n = Math.max(bounds.min, n);
  if (bounds?.max != null) n = Math.min(bounds.max, n);
  return n;
}

export function qstr(c: Context, name: string, dflt = ""): string {
  return c.req.query(name) ?? dflt;
}
