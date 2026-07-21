// Process-wide handles: the read-only content DB and the read-write research
// DB, plus the content service. Mirrors the FastAPI lifespan state.

import { resolve } from "node:path";
import { Db } from "./db.js";
import { QuranContent } from "./content.js";
import { RootExplorer } from "./roots.js";
import { RootLinkages } from "./linkages.js";
import { SimilarityEngine } from "./similarity/compose.js";
import { FreeTextSearch } from "./freetext.js";
import { ResearchStore } from "./research.js";

// project root = two levels up from server/src
const ROOT = resolve(import.meta.dirname, "..", "..");
const QURAN_DB = process.env.QF_QURAN_DB ?? resolve(ROOT, "quran.db");
const RESEARCH_DB = process.env.QF_RESEARCH_DB ?? resolve(ROOT, "research.db");

export interface AppState {
  quran: Db;
  researchDb: Db;
  content: QuranContent;
  roots: RootExplorer;
  linkages: RootLinkages;
  engine: SimilarityEngine;
  freetext: FreeTextSearch;
  research: ResearchStore;
}

export function createState(): AppState {
  const quran = new Db(QURAN_DB, { readOnly: true });
  const researchDb = new Db(RESEARCH_DB); // read-write
  return {
    quran,
    researchDb,
    content: new QuranContent(quran),
    roots: new RootExplorer(quran),
    linkages: new RootLinkages(quran),
    engine: new SimilarityEngine(quran),
    freetext: new FreeTextSearch(quran),
    research: new ResearchStore(researchDb),
  };
}

export const VERSION = "0.1.0";
