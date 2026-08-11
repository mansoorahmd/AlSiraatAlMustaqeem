// The Investigate board, opened to an AI within the boundary the reader chose:
//
//   • it MAY create cases and add evidence cards, slips, threads and clusters
//   • it MAY edit or remove ONLY the items it authored itself (source/author 'ai').
//     Anything untagged predates AI access and is the reader's — untouchable.
//   • it MAY NEVER write `verdict`, `status` or `formResearch`. Conclusions go into
//     `proposals` and do nothing until the reader accepts them in the app.
//
// Two structural facts drive this file:
//
// 1. A case is stored as ONE JSON document and saved with a whole-document upsert,
//    so there is no partial write. Every mutation is read-modify-write, which means
//    a concurrent edit in the app could be clobbered. So every write carries the
//    `updatedAt` the AI last saw and is REFUSED if the case moved on (see
//    `expectVersion`) — nothing is silently lost; the AI re-reads and retries.
// 2. Cards and slips carry board coordinates. The AI never supplies them: we place
//    items ourselves on a grid that avoids what is already there.

import { AI_SOURCE, WriteRefused } from "./core.js";
import type { AppState } from "../../server/src/state.js";

type Doc = Record<string, any>;

// board geometry — matches the app's card footprint closely enough to avoid overlap
const CARD_W = 320;
const CARD_H = 210;
const GAP = 28;
const COL_MAX = 4; // wrap into a new row after this many columns

/** Items the AI added are tagged; everything else belongs to the reader.
 *
 *  Cards and clusters carry provenance on `source`; slips and threads carry it on
 *  `author`, because their `source` already means something else (the work a slip
 *  cites, and how a thread was offered). Check both explicitly — never fall through
 *  one to the other, or a slip citing a lexicon would be read as provenance. */
export const isAiOwned = (item: Doc): boolean =>
  item?.author === AI_SOURCE || item?.source === AI_SOURCE;

const arr = (v: unknown): Doc[] => (Array.isArray(v) ? v : []);

/** Read a case or refuse clearly. */
export function mustGetCase(state: AppState, caseId: string): Doc {
  const c = state.research.getCase(caseId) as Doc | undefined;
  if (!c) throw new WriteRefused(`No case with id ${caseId}. Use list_cases to find it.`);
  return c;
}

/** Optimistic concurrency: the whole doc is rewritten on save, so refuse if the
 *  case changed since the AI read it rather than overwriting the reader's work. */
export function expectVersion(c: Doc, expected?: number | null): void {
  if (expected == null) return; // caller opted out (e.g. it just created the case)
  if (Number(c.updatedAt) !== Number(expected)) {
    throw new WriteRefused(
      `This case changed since you read it (expected updatedAt ${expected}, found ${c.updatedAt}). ` +
      `Re-read it with read_case and retry, so nothing of the reader's is overwritten.`,
    );
  }
}

/** Place a new item where nothing already sits, so the AI never invents coordinates. */
export function placeItem(c: Doc): { x: number; y: number; rotation: number } {
  const taken = [...arr(c.cards), ...arr(c.slips)]
    .map((i) => ({ x: Number(i.x) || 0, y: Number(i.y) || 0 }));
  for (let row = 0; row < 200; row++) {
    for (let col = 0; col < COL_MAX; col++) {
      const x = GAP + col * (CARD_W + GAP);
      const y = GAP + row * (CARD_H + GAP);
      const clash = taken.some((t) => Math.abs(t.x - x) < CARD_W && Math.abs(t.y - y) < CARD_H);
      if (!clash) return { x, y, rotation: 0 };
    }
  }
  return { x: GAP, y: GAP + 200 * (CARD_H + GAP), rotation: 0 };
}

/** Find an AI-owned item by id across the board, or refuse with the reason. */
export function findOwnItem(c: Doc, itemId: string): { kind: "card" | "slip" | "thread" | "cluster"; item: Doc } {
  const buckets: [("card" | "slip" | "thread" | "cluster"), Doc[]][] = [
    ["card", arr(c.cards)], ["slip", arr(c.slips)],
    ["thread", arr(c.threads)], ["cluster", arr(c.clusters)],
  ];
  for (const [kind, list] of buckets) {
    const item = list.find((i) => i.id === itemId);
    if (!item) continue;
    if (!isAiOwned(item)) {
      throw new WriteRefused(
        `That ${kind} (${itemId}) is the reader's own work. This server may only change items it added itself.`,
      );
    }
    return { kind, item };
  }
  throw new WriteRefused(`No item with id ${itemId} on this case.`);
}

/** Save a case after mutation, keeping the reader's fields exactly as they were. */
export function saveGuarded(state: AppState, before: Doc, after: Doc): Doc {
  // belt and braces: conclusions are the reader's alone, whatever the caller built
  const clean: Doc = {
    ...after,
    verdict: before.verdict ?? "",
    status: before.status ?? "open",
    formResearch: before.formResearch ?? {},
  };
  return state.research.saveCase(clean) as Doc;
}

/** A compact view of a case for the AI: structure and provenance, no board noise. */
export function caseSummary(c: Doc, opts: { full?: boolean } = {}): Doc {
  const cards = arr(c.cards);
  const slips = arr(c.slips);
  const threads = arr(c.threads);
  const clusters = arr(c.clusters);
  const mine = (l: Doc[]) => l.filter((i) => !isAiOwned(i)).length;
  const ai = (l: Doc[]) => l.filter(isAiOwned).length;
  const base: Doc = {
    id: c.id,
    title: c.title ?? "",
    description: c.description ?? "",
    subject: c.subject ?? {},
    status: c.status ?? "open",
    verdict: c.verdict ?? "",
    // pass this back as `expect_version` on any write to this case
    updated_at: c.updatedAt,
    counts: {
      evidence_cards: { readers: mine(cards), yours: ai(cards) },
      slips: { readers: mine(slips), yours: ai(slips) },
      threads: { readers: mine(threads), yours: ai(threads) },
      clusters: { readers: mine(clusters), yours: ai(clusters) },
    },
    established_forms: Object.entries((c.formResearch ?? {}) as Record<string, Doc>)
      .filter(([, v]) => v?.status === "established")
      .map(([form, v]) => ({ form, meaning: v.meaning })),
    awaiting_reader: arr(c.proposals?.entries).map((p) => ({
      id: p.id, kind: p.kind, form: p.form, text: p.text,
    })),
  };
  if (!opts.full) return base;
  return {
    ...base,
    evidence: cards.map((k) => ({
      id: k.id, verse_key: k.verseKey, word_position: k.wordPosition,
      added_by: isAiOwned(k) ? "you" : "the reader",
    })),
    notes_on_board: slips.map((s) => ({
      id: s.id, kind: s.kind, form: s.form, text: s.text,
      source: s.source_ref ?? s.source, locator: s.locator,
      added_by: isAiOwned(s) ? "you" : "the reader",
    })),
    links: threads.map((t) => ({
      id: t.id, from: t.fromCardId, to: t.toCardId, label: t.label,
      added_by: isAiOwned(t) ? "you" : "the reader",
    })),
    groups: clusters.map((g) => ({
      id: g.id, name: g.name, items: g.cardIds ?? [],
      added_by: isAiOwned(g) ? "you" : "the reader",
    })),
  };
}
