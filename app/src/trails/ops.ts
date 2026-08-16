// Trail operations: quick expeditions following a subject occurrence to
// occurrence across the Book, leaving a visible path.
//
// A thread follows one of two things:
//   • the ROOT — every form of the family (هُدًى, يَهْدِي, مُهْتَدِين …)
//   • the exact WRITTEN WORD (rasm) — only this spelling, which is the only way
//     to walk particles and proper names, since they have no root at all.

import { archive, newId } from "../persistence/db";
import type { TrailRecord } from "../persistence/types";

function spacedRoot(root: string): string {
  return root.split("").join("\u00A0"); // nbsp: root letters must not wrap
}

/** Begin a trail on the root family of the word that sparked it. */
export async function startTrail(
  root: string,
  verseKey: string,
  wordPosition: number,
): Promise<TrailRecord> {
  return begin(`the ${spacedRoot(root)} thread`, root, "root", verseKey, wordPosition);
}

/** Begin a trail on the exact written word — works for rootless words too. */
export async function startWordTrail(
  surface: string,
  verseKey: string,
  wordPosition: number,
): Promise<TrailRecord> {
  return begin(`the ${surface} thread`, surface, "word", verseKey, wordPosition);
}

async function begin(
  name: string,
  subject: string,
  subjectKind: "root" | "word",
  verseKey: string,
  wordPosition: number,
): Promise<TrailRecord> {
  const now = Date.now();
  const t: TrailRecord = {
    id: newId("trail"),
    name,
    subject,
    subjectKind,
    hops: [{ verseKey, wordPosition }],
    createdAt: now,
    updatedAt: now,
  };
  await archive.trails.save(t);
  return t;
}

/** Append a hop (no-op if it's already the last hop). */
export function withHop(
  t: TrailRecord,
  verseKey: string,
  wordPosition: number | null,
): TrailRecord {
  const last = t.hops[t.hops.length - 1];
  if (last && last.verseKey === verseKey && last.wordPosition === wordPosition) return t;
  return { ...t, hops: [...t.hops, { verseKey, wordPosition }] };
}
