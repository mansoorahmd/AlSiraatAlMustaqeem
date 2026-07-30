// Expression search: given several picked words, find every āyah where they
// co-occur — verbatim (exact wording, vowel/alif-insensitive) or by root (each
// word's root appears, catching other inflections). Ported from mobile.

import type { Db } from "./db.js";
import { foldArabic } from "./text/normalize.js";

export interface ExprTerm {
  surface: string;
  rootBuckwalter: string | null;
}
export type ExprMode = "verbatim" | "roots";
export interface ExprHit { verse_key: string; text: string }

const skel = (s: string) => foldArabic(s ?? "").replaceAll("ا", "").trim();

interface VerseRow { verse_key: string; text_uthmani: string | null; text_imlaei_simple: string | null }

export function expressionSearch(db: Db, terms: ExprTerm[], mode: ExprMode, limit = 300): ExprHit[] {
  const clean = terms.filter((t) => t.surface || t.rootBuckwalter);
  if (clean.length === 0) return [];

  let candidate: Set<string> | null = null;
  if (mode === "roots") {
    for (const t of clean) {
      if (!t.rootBuckwalter) continue;
      const vks = new Set<string>(
        db.query<{ verse_key: string }>(
          "SELECT DISTINCT verse_key FROM word_segments WHERE root_buckwalter = ?",
          [t.rootBuckwalter],
        ).map((r) => r.verse_key),
      );
      if (!candidate) candidate = vks;
      else {
        const next = new Set<string>();
        candidate.forEach((v) => { if (vks.has(v)) next.add(v); });
        candidate = next;
      }
      if (candidate.size === 0) return [];
    }
  }

  const surfaceSkels = (mode === "verbatim" ? clean : clean.filter((t) => !t.rootBuckwalter))
    .map((t) => skel(t.surface))
    .filter(Boolean);

  const out: ExprHit[] = [];
  const rows = db.query<VerseRow>(
    "SELECT verse_key, text_uthmani, text_imlaei_simple FROM verses ORDER BY chapter_id, verse_number",
  );
  for (const r of rows) {
    if (candidate && !candidate.has(r.verse_key)) continue;
    if (surfaceSkels.length) {
      const hay = skel((r.text_imlaei_simple as string) ?? "");
      if (!surfaceSkels.every((s) => hay.includes(s))) continue;
    }
    out.push({ verse_key: r.verse_key, text: (r.text_uthmani as string) ?? "" });
    if (out.length >= limit) break;
  }
  return out;
}
