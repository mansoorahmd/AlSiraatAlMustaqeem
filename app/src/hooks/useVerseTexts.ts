// Āyah text (Uthmani), fetched once per āyah for the whole session, for screens that list places
// in the Book with their line of text (My links, Rule checks, Characters, Dialogue).
// Positions inside the text are always read with tokenizeVerse (VerseText does), never a split.

import { useMemo } from "react";
import { api } from "../api/client";
import { useAsync } from "./useAsync";

const textCache = new Map<string, Promise<string>>();

export function verseText(key: string): Promise<string> {
  let p = textCache.get(key);
  if (!p) {
    p = api.verse(key, { script: "uthmani" })
      .then((v) => (typeof v.text === "string" ? v.text : ""))
      .catch(() => { textCache.delete(key); return ""; });
    textCache.set(key, p);
  }
  return p;
}

/** One whole sūrah at once (a single request), seeding the per-āyah cache as it goes. */
export async function chapterTexts(chapter: number): Promise<Map<string, string>> {
  const verses = await api.chapterVerses(chapter, { script: "uthmani" });
  const out = new Map<string, string>();
  for (const v of verses) {
    const t = typeof v.text === "string" ? v.text : "";
    out.set(v.verse_key, t);
    if (!textCache.has(v.verse_key)) textCache.set(v.verse_key, Promise.resolve(t));
  }
  return out;
}

/** The texts of these āyāt; a key is missing from the map until its text has arrived. */
export function useVerseTexts(keys: string[]): Map<string, string> {
  const sig = keys.join(",");
  const r = useAsync(async () => new Map(await Promise.all(keys.map(async (k) => [k, await verseText(k)] as const))), [sig]);
  return useMemo(() => r.data ?? new Map<string, string>(), [r.data]);
}
