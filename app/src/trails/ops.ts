// Trail operations: quick expeditions following a root occurrence to
// occurrence across the Book, leaving a visible path.

import { archive, newId } from "../persistence/db";
import type { TrailRecord } from "../persistence/types";

function spacedRoot(root: string): string {
  return root.split("").join(" ");
}

/** Begin a trail at the word that sparked it. */
export async function startTrail(
  root: string,
  verseKey: string,
  wordPosition: number,
): Promise<TrailRecord> {
  const now = Date.now();
  const t: TrailRecord = {
    id: newId("trail"),
    name: `the ${spacedRoot(root)} thread`,
    subject: root,
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
