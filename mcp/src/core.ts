// Shared plumbing for the MCP server: which databases to open, and the guard
// that keeps AI writes inside the boundary the reader chose.
//
// The corpus (quran.db) is opened READ-ONLY and no tool can write to it.
// research.db is read-write, but only through `guard` below.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// type-only (erased at runtime); the real module is imported lazily below
import type { AppState } from "../../server/src/state.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");

/** Resolve the project's own databases when no env vars are set, so a client
 *  config with no environment block just works on the real research. */
export function resolveDbs(): { quran: string; research: string } {
  const quran = process.env.QF_QURAN_DB ?? resolve(repo, "quran.db");
  const research = process.env.QF_RESEARCH_DB ?? resolve(repo, "research.db");
  if (!existsSync(quran)) {
    throw new Error(
      `Quran corpus not found at ${quran}. Set QF_QURAN_DB to its location.`,
    );
  }
  return { quran, research };
}

/** server/src/state.ts resolves its database paths at IMPORT time, so the env
 *  must be settled before that module is loaded — hence the dynamic import. */
export async function openState(): Promise<AppState> {
  const { quran, research } = resolveDbs();
  process.env.QF_QURAN_DB = quran;
  process.env.QF_RESEARCH_DB = research;
  const { createState } = await import("../../server/src/state.js");
  return createState();
}

// ---- the write boundary -------------------------------------------------------
// Decided deliberately, and enforced here rather than trusted to the model:
//   • may write ONLY notes/questions and indications (+ per-form refinements)
//   • ADD only — never edit or delete anything that already exists
//   • every record is tagged source='ai' so the reader can review it
//   • may NEVER set an indication as primary (the reader's default gloss)
//   • cases, motifs, comparisons and root-meanings are untouchable

export class WriteRefused extends Error {}

export const AI_SOURCE = "ai" as const;

/** A fresh id that cannot collide with the reader's own records. */
export function proposalId(prefix: string): string {
  return `${prefix}_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const guard = {
  /** Refuse to touch a record that already exists — writes are additive only. */
  mustNotExist(state: AppState, kind: "note" | "indication", id: string): void {
    const found =
      kind === "note"
        ? state.research.listNotes().some((n) => n.id === id)
        : state.research.getIndication(id) !== undefined;
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
};
