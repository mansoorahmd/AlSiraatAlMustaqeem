// Every corpus service over one CorpusDb:
//
//   research server  createCorpusServices(pgCorpus(…))            → /corpus/*
//   tests, MCP local createCorpusServices(sqliteCorpus(quran.db))
//
// Same code, same routes (routes/content.ts, roots.ts, similarity.ts, echoes.ts), same JSON.
// The one thing that may differ is ENTITLEMENT: the research server leaves out translations and
// dictionaries a caller's plan doesn't reach; over quran.db there is nothing to filter.

import type { Context } from "hono";
import type { CorpusDb } from "./corpus-db.js";
import { QuranContent, type Allow } from "./content.js";
import { RootExplorer } from "./roots.js";
import { RootLinkages } from "./linkages.js";
import { SimilarityEngine } from "./similarity/compose.js";
import { FreeTextSearch } from "./freetext.js";
import { EchoIndex } from "./echoes.js";
import { SpellingIndex, WordFormIndex } from "./spellings.js";

export interface CorpusServices {
  /** the database itself — for the few functional helpers (wazn, expression search) */
  corpus: CorpusDb;
  content: QuranContent;
  roots: RootExplorer;
  linkages: RootLinkages;
  engine: SimilarityEngine;
  freetext: FreeTextSearch;
  echoes: EchoIndex;
  spellings: SpellingIndex;
  wordForms: WordFormIndex;
}

export function createCorpusServices(corpus: CorpusDb): CorpusServices {
  return {
    corpus,
    content: new QuranContent(corpus),
    roots: new RootExplorer(corpus),
    linkages: new RootLinkages(corpus),
    engine: new SimilarityEngine(corpus),
    freetext: new FreeTextSearch(corpus),
    echoes: new EchoIndex(corpus),
    spellings: new SpellingIndex(corpus),
    wordForms: new WordFormIndex(corpus),
  };
}

/** Build every in-memory index now instead of on first use (the cloud does this at startup so
 *  no reader pays for it). Safe to call twice — each build is memoised. */
export async function warmCorpus(s: CorpusServices): Promise<void> {
  await Promise.all([s.echoes.build(), s.spellings.build(), s.wordForms.build(), s.engine.build(), s.freetext.build()]);
}

/** Per-request filters a host may apply to what the corpus returns. Absent = nothing filtered. */
export interface Entitlements {
  /** which translations (by resource id) this caller may see */
  translations?: (c: Context) => Promise<Allow<number>>;
  /** which dictionaries (by root_meanings.source) this caller may see */
  lexicons?: (c: Context) => Promise<Allow<string>>;
}

/** Which corpus edition is loaded — 0 when it has never been patched (no corpus_meta yet). */
export async function corpusVersion(corpus: CorpusDb): Promise<{ version: number; schemaVersion: number }> {
  try {
    const rows = await corpus.query<{ key: string; value: string }>("SELECT key, value FROM corpus_meta");
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return { version: Number(m.get("corpus_version") ?? 0), schemaVersion: Number(m.get("schema_version") ?? 0) };
  } catch {
    return { version: 0, schemaVersion: 0 };
  }
}
