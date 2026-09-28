// Process-wide handles: the read-only corpus (quran.db) and its services. The reader's research
// is not here — it lives in their account on the research server (remote/src/research/).

import { resolve } from "node:path";
import { Db } from "./db.js";
import { sqliteCorpus } from "./corpus-db.js";
import { createCorpusServices, type CorpusServices } from "./corpus-services.js";

// project root = two levels up from server/src
const ROOT = resolve(import.meta.dirname, "..", "..");
const QURAN_DB = process.env.QF_QURAN_DB ?? resolve(ROOT, "quran.db");

/** The corpus services over quran.db, via the SQLite driver. */
export interface AppState extends CorpusServices {
  quran: Db;
}

export function createState(): AppState {
  const quran = new Db(QURAN_DB, { readOnly: true });
  return { ...createCorpusServices(sqliteCorpus(quran)), quran };
}

export const VERSION = "0.1.0";
