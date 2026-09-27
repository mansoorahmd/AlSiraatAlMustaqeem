// Shared plumbing for the MCP server: where the corpus and the research come from, and the guard
// that keeps AI writes inside the boundary the reader chose.
//
// The CORPUS is read-only and, by default, comes from the research server's /corpus as the user
// (corpus-client.ts): REMOTE_URL (default http://localhost:8100) + REMOTE_TOKEN (a personal API
// token from the app). MQ_CORPUS=local reads quran.db instead — offline work, and the tests.
// The RESEARCH is the reader's, in their account on the research server (research-client.ts),
// read and written as them with the same token; the server enforces the AI boundary on top of
// `guard` below. MQ_RESEARCH=local uses a research.db file instead (offline work, the tests).

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localReads, remoteReads, type CorpusReads } from "./corpus-client.js";
import { remoteResearch, type McpResearch } from "./research-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");

/** What every tool works with: the corpus reads, plus the reader's own research. */
export interface McpState extends CorpusReads {
  research: McpResearch;
}

export const corpusMode = (): "remote" | "local" => (process.env.MQ_CORPUS === "local" ? "local" : "remote");
export const researchMode = (): "remote" | "local" => (process.env.MQ_RESEARCH === "local" ? "local" : "remote");

/** Resolve the project's own databases when no env vars are set, so a client config with no
 *  environment block just works on the real research. quran.db is needed only in local mode. */
export function resolveDbs(): { quran: string; research: string } {
  const quran = process.env.QF_QURAN_DB ?? resolve(repo, "quran.db");
  const research = process.env.QF_RESEARCH_DB ?? resolve(repo, "research.db");
  if (corpusMode() === "local" && !existsSync(quran)) {
    throw new Error(`Quran corpus not found at ${quran}. Set QF_QURAN_DB, or drop MQ_CORPUS=local to read it from the research server.`);
  }
  return { quran, research };
}

/** The server modules resolve database paths at IMPORT time, so the env is settled first and the
 *  modules are imported lazily. */
export async function openState(): Promise<McpState> {
  const { quran, research } = resolveDbs();
  process.env.QF_QURAN_DB = quran;
  process.env.QF_RESEARCH_DB = research;
  const { Db } = await import("../../server/src/db.js");
  const base = process.env.REMOTE_URL ?? "http://localhost:8100";
  const token = process.env.REMOTE_TOKEN || undefined;

  let corpus: CorpusReads;
  if (corpusMode() === "local") {
    const { sqliteCorpus } = await import("../../server/src/corpus-db.js");
    const { createCorpusServices } = await import("../../server/src/corpus-services.js");
    corpus = localReads(createCorpusServices(sqliteCorpus(new Db(quran, { readOnly: true }))));
  } else {
    corpus = remoteReads(base, token);
  }

  if (researchMode() === "remote") return { ...corpus, research: remoteResearch(base, token) };
  // local: whichever research.db the app has open (databases.json), so proposals land in it
  const { Databases } = await import("../../server/src/databases.js");
  const { ResearchStore } = await import("../../server/src/research.js");
  const { sqliteResearch } = await import("../../server/src/research-db.js");
  const databases = new Databases(research);
  const researchDb = new Db(databases.currentPath());
  databases.use(researchDb.path);
  return { ...corpus, research: await ResearchStore.open(sqliteResearch(researchDb)) };
}

// ---- the write boundary -------------------------------------------------------
// Decided deliberately, and enforced here rather than trusted to the model:
//   • may write notes/questions, indications (+ per-form refinements), and motifs
//   • ADD only — never edit or delete the reader's own work; the AI may revise a
//     motif ONLY if it proposed it (source='ai')
//   • every record is tagged source='ai' so the reader can review it
//   • may NEVER set an indication as primary (the reader's default gloss)
//   • cases (except board proposals), comparisons and root-meanings are untouchable

export class WriteRefused extends Error {}

export const AI_SOURCE = "ai" as const;

/** A fresh id that cannot collide with the reader's own records. */
export function proposalId(prefix: string): string {
  return `${prefix}_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const guard = {
  /** Refuse to touch a record that already exists — writes are additive only. */
  async mustNotExist(state: McpState, kind: "note" | "indication", id: string): Promise<void> {
    const found =
      kind === "note"
        ? (await state.research.getNote(id)) !== undefined
        : (await state.research.getIndication(id)) !== undefined;
    if (found) {
      throw new WriteRefused(
        `Refusing to overwrite an existing ${kind} (${id}). This server may only add new records.`,
      );
    }
  },

  /** Strip anything the AI is not allowed to decide.
   *
   *  primary must be forced to FALSE, not merely omitted: saveIndication treats a
   *  missing flag as "first indication for this root becomes primary", so deleting
   *  the key silently promoted an AI proposal to the reader's default gloss. */
  sanitiseIndication<T extends Record<string, unknown>>(doc: T): T {
    return { ...doc, source: AI_SOURCE, primary: false } as T;
  },

  requireText(value: unknown, field: string): string {
    const s = typeof value === "string" ? value.trim() : "";
    if (!s) throw new WriteRefused(`${field} is required and cannot be empty.`);
    return s;
  },

  verseKey(value: unknown): string {
    const s = String(value ?? "").trim();
    if (!/^\d{1,3}:\d{1,3}$/.test(s)) {
      throw new WriteRefused(`"${s}" is not a verse key — use chapter:verse, e.g. 2:255.`);
    }
    return s;
  },

  /** A motif the AI may edit — one it proposed. The reader's own motifs are their
   *  curation and stay untouchable, mirroring the rule for notes/indications. */
  async ownMotif(state: McpState, id: string): Promise<{ id: string; source?: string }> {
    const m = (await state.research.getMotif(id)) as { id: string; source?: string } | undefined;
    if (!m) throw new WriteRefused(`No such motif: ${id}.`);
    if (m.source !== "ai") {
      throw new WriteRefused(
        `Motif ${id} is the reader's own — you may only change a motif you proposed.`,
      );
    }
    return m;
  },
};
