// What an AI assistant may do to a reader's research — enforced by the research server on every
// request that arrives with an API token (the MCP), not trusted to the client. It mirrors the
// MCP's own guard (mcp/src/core.ts, cases.ts), so the rules hold even if something calls the
// API directly with a token:
//
//   • may ADD notes, indications (+ per-form refinements), motifs and cases — all tagged 'ai'
//   • may change only what it added itself; never edit or delete the reader's records
//   • may never set a primary indication (the reader's default gloss)
//   • on a case (even the reader's own) may add its OWN board items and park proposals, but the
//     reader's items, verdict, status, established meanings and title stay exactly as they were
//   • may not delete anything, accept proposals, publish, or change settings/comparisons/trails

import { BoundaryError, type AiBoundary } from "./routes.js";

type Doc = Record<string, any>;
const AI = "ai";

/** Items the AI added carry `source` (cards, clusters) or `author` (slips, threads) = 'ai'. */
export const isAiOwned = (item: Doc | undefined): boolean => item?.author === AI || item?.source === AI;
const arr = (v: unknown): Doc[] => (Array.isArray(v) ? v : []);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const aiBoundary: AiBoundary = {
  mustBeNewOrAi(kind, existing) {
    if (existing && !isAiOwned(existing)) {
      throw new BoundaryError(`That ${kind} is the reader's own — an AI assistant may only change what it added.`);
    }
  },

  stamp(doc) {
    return { ...doc, source: AI, primary: false };
  },

  refuse(what): never {
    throw new BoundaryError(`An AI assistant can't ${what} — that's for the reader, in the app.`);
  },

  mergeCase(existing, incoming) {
    if (!existing) return { ...incoming, source: AI, verdict: "", status: "open", formResearch: {} };
    const aiCase = isAiOwned(existing);
    for (const list of ["cards", "slips", "threads", "clusters"] as const) {
      const before = new Map(arr(existing[list]).map((i) => [i.id, i]));
      const after = new Map(arr(incoming[list]).map((i) => [i.id, i]));
      for (const [id, item] of before) {
        if (!isAiOwned(item) && !same(after.get(id), item)) {
          throw new BoundaryError(`That ${list.slice(0, -1)} (${id}) is the reader's own work — an AI assistant may only change items it added.`);
        }
      }
      for (const [id, item] of after) {
        if (!before.has(id) && !isAiOwned(item)) {
          throw new BoundaryError(`A new ${list.slice(0, -1)} (${id}) must be tagged as the AI's own.`);
        }
      }
    }
    // conclusions and the case's identity stay the reader's, whatever the request built
    return {
      ...incoming,
      verdict: existing.verdict ?? "",
      status: existing.status ?? "open",
      formResearch: existing.formResearch ?? {},
      ...(aiCase ? {} : { title: existing.title, subject: existing.subject, description: existing.description }),
      source: existing.source,
    };
  },
};
