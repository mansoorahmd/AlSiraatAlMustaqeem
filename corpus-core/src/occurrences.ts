// Occurrences: every place one thing occurs in the Book, in Book order. The thing is named by
//
//   phrase | pair | form | lemma | root   a Links-panel marker, by its key (LinkMarker.key)
//   spelling                              one exact written shape (rasm, vowels ignored): a word
//                                         written so, or whose stem is written so. Or one
//                                         spelling of one word as the Spellings list counts it:
//                                         "<group key>|<spelling>" (3:35:3|ٱمْرَأَتُ), which lists
//                                         exactly the places that list shows
//   construction                          a grammar query (constructions.ts); the key is a label
//
// Every place is listed, several in one āyah where it recurs there, up to MAX_PLACES; `total`
// and `ayahs` are always the full counts. Nothing here interprets: it lists and counts.

import type { LinkIndex, MarkerKind } from "./links.js";
import type { ConstructionIndex, ConstructionQuery } from "./constructions.js";
import { ConstructionQueryError, parseConstructionSearch } from "./constructions.js";
import type { SpellingIndex, WordFormIndex } from "./spellings.js";

export type OccurrenceKind = MarkerKind | "spelling" | "construction";
export const OCCURRENCE_KINDS: readonly OccurrenceKind[] = ["phrase", "pair", "form", "lemma", "root", "spelling", "construction"];

/** One place: `words` words starting at word `word` (1-based word positions), as written. */
export interface Occurrence { verseKey: string; word: number; words: number; text: string }
export interface Occurrences {
  kind: OccurrenceKind;
  key: string;
  total: number;
  ayahs: number;
  /** true when `places` was cut short of `total` */
  truncated: boolean;
  places: Occurrence[];
}

export interface OccurrenceRequest {
  kind: OccurrenceKind;
  key: string;
  query?: ConstructionQuery;
  limit?: number;
  offset?: number;
}

/** The most places one answer lists. */
export const MAX_PLACES = 6000;

/** A request the service can't run: answered 400 with this message. */
export class OccurrenceRequestError extends Error {}

/** Check a request body and return it typed. Throws OccurrenceRequestError. */
export function parseOccurrenceRequest(body: unknown): OccurrenceRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OccurrenceRequestError("the body must be a JSON object with `kind` and `key`");
  const b = body as Record<string, unknown>;
  const kind = b.kind as OccurrenceKind;
  if (!OCCURRENCE_KINDS.includes(kind)) throw new OccurrenceRequestError(`kind must be one of ${OCCURRENCE_KINDS.join(", ")}`);
  const key = typeof b.key === "string" ? b.key : b.key === undefined || b.key === null ? "" : null;
  if (key === null) throw new OccurrenceRequestError("key must be a string");
  const out: OccurrenceRequest = { kind, key };
  if (kind === "construction") {
    try {
      const q = parseConstructionSearch(b.query);
      out.query = q.atStart ? { slots: q.slots, atStart: true } : { slots: q.slots };
    } catch (e) {
      if (e instanceof ConstructionQueryError) throw new OccurrenceRequestError(`query: ${e.message}`);
      throw e;
    }
  } else if (!key.trim()) {
    throw new OccurrenceRequestError("key is required");
  }
  const num = (v: unknown, name: string) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new OccurrenceRequestError(`${name} must be a number`);
    return Math.trunc(v);
  };
  const limit = num(b.limit, "limit");
  const offset = num(b.offset, "offset");
  if (limit !== undefined) out.limit = limit;
  if (offset !== undefined) out.offset = offset;
  return out;
}

/** "<group key>|<spelling>": one spelling of one word in the Spellings list. */
const GROUP_SPELLING = /^(\d+:\d+:\d+)\|(.+)$/;

export class OccurrenceFinder {
  constructor(
    private links: LinkIndex, private constructions: ConstructionIndex,
    private wordForms: WordFormIndex, private spellings: SpellingIndex,
  ) {}

  async find(r: OccurrenceRequest): Promise<Occurrences> {
    let all: Occurrence[];
    if (r.kind === "construction") {
      all = (await this.constructions.every(r.query!)).map((h) => ({ verseKey: h.verseKey, word: h.start, words: h.length, text: h.match }));
    } else if (r.kind === "spelling") {
      const named = GROUP_SPELLING.exec(r.key.trim());
      // a spelling the list does not have is no place, like a shape nothing is written in
      const words = named ? (await this.spellings.spellingWords(named[1]!, named[2]!)) ?? [] : await this.wordForms.shapePlaces(r.key);
      all = words.map((o) => ({ verseKey: o.verse_key, word: o.word_position, words: 1, text: o.surface ?? "" }));
    } else {
      all = await this.links.occurrencesOf(r.kind, r.key);
    }
    const offset = Math.max(0, r.offset ?? 0);
    const limit = Math.min(MAX_PLACES, Math.max(1, r.limit ?? MAX_PLACES));
    const places = all.slice(offset, offset + limit);
    return {
      kind: r.kind,
      key: r.key,
      total: all.length,
      ayahs: new Set(all.map((p) => p.verseKey)).size,
      truncated: places.length < all.length,
      places,
    };
  }
}
