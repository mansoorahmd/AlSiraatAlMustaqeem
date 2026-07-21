// The focus lens: pin a case and the reader lights every echo of it.
//  - root case  → the root (gold) + linked roots (soft) + all its occurrences
//    across the Book as jump targets.
//  - ayah case  → the subject ayah's content roots (gold) + ayahs the
//    similarity engine relates by shared roots and by POS structure (tint),
//    all as jump targets.

import { api } from "../../api/client";
import { archive } from "../../persistence/db";
import { normalizeCase } from "../../cases/ops";
import type { Script } from "../../api/types";

export interface FocusReason {
  shared: string[];   // shared roots (Arabic)
  pattern: string[];  // matched POS sequence
  run: string[];      // longest contiguous shared-root phrase (Arabic)
  phrase: number;     // phrase-match strength [0..1]
}

export interface FocusBase {
  kind: "root" | "ayah";
  /** what every match is compared against: a verse key, or the root (Arabic) */
  label: string;
  /** subject ayah's own POS structure (ayah case), for side-by-side */
  pattern: string[];
}

export interface FocusSpec {
  caseId: string;
  kind: "root" | "ayah";
  label: string;
  /** the subject the whole lens is measured against */
  base: FocusBase;
  roots: Set<string>;        // gold — shared roots
  linkedRoots: Set<string>;  // soft tint — the root's neighbourhood
  patternKeys: Set<string>;  // ayahs matching by POS structure (tint)
  jumpKeys: string[];        // ordered verse keys to step through (whole Book)
  jumpSet: Set<string>;      // same, for O(1) membership
  /** why each matching ayah is in the focus */
  reasons: Map<string, FocusReason>;
}

const spaced = (r: string) => r.split("").join(" ");
const vsort = (k: string) => {
  const [c, v] = k.split(":").map((n) => parseInt(n, 10) || 0);
  return c * 1_000_000 + v;
};

export async function buildFocusSpec(caseId: string, script: Script): Promise<FocusSpec | null> {
  const raw = await archive.cases.get(caseId);
  if (!raw) return null;
  const c = normalizeCase(raw);

  if (c.subject.type === "root") {
    const root = c.subject.value;
    const roots = new Set([root]);
    const linkedRoots = new Set<string>();
    try {
      const links = await api.rootLinkages(root, { limit: 12 });
      for (const l of links) if (l.root_arabic) linkedRoots.add(l.root_arabic);
    } catch { /* offline is fine */ }
    const jumpKeys: string[] = [];
    try {
      const occ = await api.rootOccurrences(root, script);
      const seen = new Set<string>();
      for (const o of occ) {
        if (!seen.has(o.verse_key)) { seen.add(o.verse_key); jumpKeys.push(o.verse_key); }
      }
      jumpKeys.sort((a, b) => vsort(a) - vsort(b));
    } catch { /* offline is fine */ }
    const reasons = new Map<string, FocusReason>();
    for (const k of jumpKeys) reasons.set(k, { shared: [root], pattern: [], run: [], phrase: 0 });
    return {
      caseId, kind: "root", label: `root ${spaced(root)}`,
      base: { kind: "root", label: root, pattern: [] },
      roots, linkedRoots, patternKeys: new Set(),
      jumpKeys, jumpSet: new Set(jumpKeys), reasons,
    };
  }

  // ayah case → same lens as an ad-hoc ayah focus
  return buildAyahFocus(c.subject.value, script, caseId);
}

/** Focus on any ayah — with or without a saved case behind it. */
export async function buildAyahFocus(
  key: string, _script: Script, caseId = `ayah:${key}`,
): Promise<FocusSpec> {
  const roots = new Set<string>();
  const basePattern: string[] = [];
  try {
    const words = await api.verseWords(key);
    for (const w of words) {
      if (w.root) roots.add(w.root);
      if (w.pos_class) basePattern.push(w.pos_class);
    }
  } catch { /* offline is fine */ }
  const patternKeys = new Set<string>();
  const jumpSet = new Set<string>();
  const reasons = new Map<string, FocusReason>();
  // keep engine order so we can rank the trail by closeness, not mushaf order
  const ranked: string[] = [];
  try {
    const matches = await api.similar(key, { top_k: 80 });
    for (const m of matches) {
      jumpSet.add(m.verse_key);
      ranked.push(m.verse_key);
      if (m.pattern && m.pattern.length) patternKeys.add(m.verse_key);
      reasons.set(m.verse_key, {
        shared: m.shared ?? [],
        pattern: m.pattern ?? [],
        run: m.phrase_run ?? [],
        phrase: m.phrase ?? 0,
      });
    }
  } catch { /* offline is fine */ }
  // trail order: longest shared phrase first, then phrase strength, then the
  // engine's overall score (ranked[] is already score-descending)
  const rank = new Map(ranked.map((k, i) => [k, i]));
  const jumpKeys = [...jumpSet].sort((a, b) => {
    const ra = reasons.get(a)!, rb = reasons.get(b)!;
    if (rb.run.length !== ra.run.length) return rb.run.length - ra.run.length;
    if (rb.phrase !== ra.phrase) return rb.phrase - ra.phrase;
    return (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
  });
  return {
    caseId, kind: "ayah", label: `ayah ${key}`,
    base: { kind: "ayah", label: key, pattern: basePattern },
    roots, linkedRoots: new Set(), patternKeys,
    jumpKeys, jumpSet, reasons,
  };
}
