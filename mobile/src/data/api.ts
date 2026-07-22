// A synchronous, on-device API surface mirroring app/src/api/client.ts, so
// screen code reads the same as the web app. Every call runs against the
// bundled SQLite corpus — no network.

import type { Db } from "./db";
import type { Script } from "../types";
import * as content from "./content";
import * as roots from "./roots";
import { RootLinkages } from "./linkages";
import { EchoIndex } from "./echoes";
import { SimilarityEngine } from "../similarity/compose";
import { FreeTextSearch } from "../similarity/freetext";

export function makeApi(db: Db) {
  let linkages: RootLinkages | null = null;
  const links = () => (linkages ??= new RootLinkages(db));
  let echoIndex: EchoIndex | null = null;
  const echoes = () => (echoIndex ??= new EchoIndex(db));
  let freqMap: Map<string, number> | null = null;
  // one similarity engine shared by /similar and free-text search (built once)
  let engine: SimilarityEngine | null = null;
  const eng = () => (engine ??= new SimilarityEngine(db));
  let freetext: FreeTextSearch | null = null;
  const ft = () => (freetext ??= new FreeTextSearch(db, eng()));

  return {
    // content / metadata
    chapters: () => content.listChapters(db),
    chapter: (id: number) => content.getChapter(db, id),
    chapterVerses: (id: number, opts: { script?: Script; withWords?: boolean; allScripts?: boolean } = {}) =>
      content.chapterVerses(db, id, opts),
    verse: (key: string, opts: { script?: Script; allScripts?: boolean; withWords?: boolean; withTranslations?: boolean } = {}) =>
      content.getVerse(db, key, opts),
    verseWords: (key: string) => content.verseWords(db, key),
    verseTranslations: (key: string) => content.verseTranslations(db, key),
    translationResources: () => content.listTranslationResources(db),
    neighbours: (key: string, radius = 2, script: Script = "uthmani") =>
      content.verseNeighbours(db, key, { radius, script }),
    phraseSearch: (queryText: string, script: Script = "uthmani", limit = 50) =>
      content.phraseSearch(db, queryText, { script, limit }),

    // roots
    listRoots: (opts: { orderBy?: string; descending?: boolean; limit?: number | null; offset?: number } = {}) =>
      roots.listRoots(db, opts),
    root: (root: string) => roots.getRoot(db, root),
    rootOccurrences: (root: string, script: Script = "uthmani", limit: number | null = 3000) =>
      roots.rootOccurrences(db, root, { script, limit }),
    rootFrequencies: () => (freqMap ??= roots.rootFrequencies(db)),
    rootLinkages: (root: string, opts: { scope?: "ayah" | "adjacent"; limit?: number; sortBy?: "score" | "count" } = {}) =>
      links().coOccurringRoots(root, opts),

    // verbatim echoes
    chapterEchoes: (id: number) => echoes().chapterEchoes(id),
    verseEchoes: (key: string) => echoes().echoesForVerse(key),

    // composite similarity + free-text related search (shared engine)
    similar: (key: string, opts: { topK?: number; minShared?: number } = {}) =>
      eng().similarVerses(key, opts),
    search: (text: string, opts: { topK?: number } = {}) => ft().search(text, opts),
  };
}

export type QuranApi = ReturnType<typeof makeApi>;
