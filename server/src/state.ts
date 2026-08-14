// Process-wide handles: the read-only content DB and the read-write research
// DB, plus the content service. Mirrors the FastAPI lifespan state.

import { resolve } from "node:path";
import { Db } from "./db.js";
import { Databases } from "./databases.js";
import { QuranContent } from "./content.js";
import { RootExplorer } from "./roots.js";
import { RootLinkages } from "./linkages.js";
import { SimilarityEngine } from "./similarity/compose.js";
import { FreeTextSearch } from "./freetext.js";
import { ResearchStore } from "./research.js";
import { EchoIndex } from "./echoes.js";
import { SpellingIndex, WordFormIndex } from "./spellings.js";

// project root = two levels up from server/src
const ROOT = resolve(import.meta.dirname, "..", "..");
const QURAN_DB = process.env.QF_QURAN_DB ?? resolve(ROOT, "quran.db");
const RESEARCH_DB = process.env.QF_RESEARCH_DB ?? resolve(ROOT, "research.db");

export interface AppState {
  quran: Db;
  /** Swappable at runtime — see `reopenResearch`. Routes must read it per request. */
  researchDb: Db;
  databases: Databases;
  content: QuranContent;
  roots: RootExplorer;
  linkages: RootLinkages;
  engine: SimilarityEngine;
  freetext: FreeTextSearch;
  research: ResearchStore;
  echoes: EchoIndex;
  spellings: SpellingIndex;
  wordForms: WordFormIndex;
}

export function createState(): AppState {
  const quran = new Db(QURAN_DB, { readOnly: true });
  // Which file to open is remembered per machine; WHO it belongs to lives inside the file.
  const databases = new Databases(RESEARCH_DB);
  const researchDb = new Db(databases.currentPath()); // read-write
  databases.use(researchDb.path); // remember it, so it appears in "recently opened"
  return {
    quran,
    databases,
    researchDb,
    content: new QuranContent(quran),
    roots: new RootExplorer(quran),
    linkages: new RootLinkages(quran),
    engine: new SimilarityEngine(quran),
    freetext: new FreeTextSearch(quran),
    research: new ResearchStore(researchDb),
    echoes: new EchoIndex(quran),
    spellings: new SpellingIndex(quran),
    wordForms: new WordFormIndex(quran),
  };
}

/**
 * Point the running server at a different research.db — no restart. Used when the reader
 * switches profile, signs in (claiming their file), or opens a database explicitly.
 * The old handle is closed so its WAL is checkpointed before anything else touches the file.
 */
export function reopenResearch(state: AppState, path: string): void {
  const previous = state.researchDb;
  const next = new Db(path);
  state.researchDb = next;
  state.research = new ResearchStore(next);
  try { previous.close(); } catch { /* already gone */ }
}

export const VERSION = "0.1.0";
