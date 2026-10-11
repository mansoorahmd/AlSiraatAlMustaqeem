// Expression search: pick several words from an āyah and find every āyah where
// they co-occur — either verbatim (the exact wording, vowel/alif-insensitive)
// or by root (each word's root appears, catching other inflections).

import type { Db } from "./db";
import { foldArabic } from "../text/normalize";

export interface ExprTerm {
  surface: string;              // the word as written
  rootBuckwalter: string | null; // its root, if any
}
export type ExprMode = "verbatim" | "roots";
export interface ExprHit { verse_key: string; text: string }

const skel = (s: string) => foldArabic(s ?? "").replaceAll("ا", "").trim();

interface VerseRow { verse_key: string; text_uthmani: string | null; text_imlaei_simple: string | null }

/** Āyāt where every term co-occurs (order-independent). */
export function expressionSearch(db: Db, terms: ExprTerm[], mode: ExprMode, limit = 300): ExprHit[] {
  const clean = terms.filter((t) => t.surface || t.rootBuckwalter);
  if (clean.length === 0) return [];

  // In roots mode, each term with a root narrows candidates by that root;
  // rootless terms (particles, names) fall back to a surface-skeleton match.
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
      if (!candidate) {
        candidate = vks;
      } else {
        const next = new Set<string>();
        candidate.forEach((v) => { if (vks.has(v)) next.add(v); });
        candidate = next;
      }
      if (candidate.size === 0) return [];
    }
  }

  // Remaining terms that still need a surface-skeleton check on the verse text:
  //  - verbatim mode: every term
  //  - roots mode: only the rootless terms
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
