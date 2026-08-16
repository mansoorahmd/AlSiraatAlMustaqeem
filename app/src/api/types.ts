// Types mirroring the quran_api FastAPI responses.

export type Script =
  | "uthmani"
  | "uthmani_simple"
  | "imlaei"
  | "imlaei_simple"
  | "indopak"
  | "tajweed";

export interface Chapter {
  id: number;
  name_simple: string;
  name_arabic: string;
  name_complex: string;
  revelation_place: string;
  revelation_order: number;
  bismillah_pre: number;
  verses_count: number;
  pages_first: number;
  pages_last: number;
}

export interface Verse {
  verse_key: string;
  chapter_id: number;
  verse_number: number;
  verse_index: number | null;
  juz_number: number;
  hizb_number: number;
  rub_el_hizb_number: number;
  page_number: number;
  ruku_number: number;
  manzil_number: number;
  // present when a single script is requested:
  script?: Script;
  text?: string | Record<Script, string>;
  // optional includes:
  words?: Word[];
  translations?: Translation[];
  focus?: boolean; // neighbours endpoint
}

export interface Word {
  position: number;
  arabic: string | null;
  gloss: string | null;
  transliteration: string | null;
  lemma: string | null;
  root: string | null;
  root_buckwalter: string | null;
  pos: string | null;
  pos_class: string | null;
}

export interface Translation {
  resource_id: number;
  language_name: string;
  text: string;
  resource_name: string | null;
  author_name: string | null;
  resource_type: string | null;
}

export interface TranslationResource {
  id: number;
  name: string | null;
  author_name: string | null;
  language_name: string | null;
  resource_type: string | null;
}

/** One rasm spelling of a word (same word written a particular way). */
export interface SpellingVariant { surface: string; count: number; verses: string[] }

/** One of the reader's own meanings for a word (lemma). A word may hold several
 *  indications ("feels"); one is primary (the default gloss). Global to the lemma. */
export interface WordIndication {
  id: string; root: string | null; lemma: string | null;
  /** 'root' = an indication of the whole root; 'lemma' = a refinement or rootless indication */
  scope: "root" | "lemma";
  /** a refinement points at its root indication; root/standalone indications are null */
  parentId: string | null;
  label: string; meaning: string; primary: boolean;
  /** 'me' = the reader wrote it; 'ai' = proposed via the MCP server, awaiting review */
  source?: "me" | "ai";
  createdAt: number; updatedAt: number;
}
/** A root indication plus this form's refinement of it (null = not yet written). */
export interface RootIndicationWithRefinement extends WordIndication {
  refinement: WordIndication | null;
  /** how many of the root's forms have been given a refinement for this indication */
  refinedCount: number;
}
/** What the word menu needs for a word: its root indications (with this form's
 *  refinement) and, for rootless words, standalone lemma indications. */
export interface IndicationsForWord {
  root: string | null; lemma: string | null;
  rootIndications: RootIndicationWithRefinement[];
  lemmaIndications: WordIndication[];
  /** the community's readings of this root — pulled, read-only, never primary */
  communityRoot: PeerIndication[];
  /** the community's readings of this exact form */
  communityLemma: PeerIndication[];
}
/**
 * Someone else's reading, pulled from the research server.
 *
 * Deliberately NOT a WordIndication: it has no `primary` and no id you can save against,
 * because it is not yours to promote or edit. It sits in the same list as your own so you
 * can weigh it, and that is all.
 */
export interface PeerIndication {
  id: string;                  // peer:<claimId>@<version> — stable, but not a local record
  claimId: string; version: number; authorId: string;
  /** who submitted it — display name, else email */
  authorName: string;
  scope: "root" | "lemma";
  root: string | null; lemma: string | null;
  /** established = the group's current reading; proposed = argued but not carried;
   *  superseded = its author has since written a later version */
  status: "proposed" | "established" | "superseded";
  label: string; meaning: string;
  /** the reading's own per-form shades, as proposed (root readings carry these) */
  refinements: { lemma: string; label: string; meaning: string }[];
  /** moderators who approved this exact version */
  approvers: string[];
  /** objections filed against this exact version */
  dissents: number;
  createdAt: number;
}
/** What an AI proposed through the MCP server, awaiting the reader's review. */
export interface Proposed {
  notes: import("../persistence/types").NoteRecord[];
  indications: WordIndication[];
}

/** Reader gloss data: primary root-indication text per root, per-form refinements,
 *  and rootless lemma primaries. */
export interface IndicationGloss {
  roots: { root: string; text: string }[];
  refinements: { root: string; lemma: string; text: string }[];
  lemmas: { lemma: string; text: string }[];
}

/** A saved comparison — a named board of pinned āyāt & roots. */
export interface CompareSet { id: string; title: string; createdAt: number; updatedAt: number; count: number }
/** One pinned member of a comparison. */
export interface CompareItemRow {
  id: string; setId: string; kind: "ayah" | "root"; ref: string; label: string | null; createdAt: number;
}

/** A term (picked word) in an expression search. */
export interface ExprTerm { surface: string; root: string | null }
/** An āyah where an expression's terms co-occur. */
export interface ExprHit { verse_key: string; text: string }

/** The morphological measure (صرف) of a word. */
export interface Wazn {
  kind: "verb" | "active-participle" | "passive-participle" | "verbal-noun";
  form: string;
  wazn: string | null;
  label: string;
  sense?: string;
  aspect?: string;
  voice?: string;
  radicals?: string[];
}

/** A verbatim phrase in a verse that recurs elsewhere in the Book. */
export interface Echo {
  phrase: string;
  words: string[];
  start: number; // 1-based word index in the verse
  length: number;
  occurrences: { verseKey: string; start: number }[]; // other places (+ start word)
  count: number; // total occurrences (incl. this verse)
}

export interface RootForm {
  lemma_buckwalter: string;
  lemma_arabic: string | null;
  pos: string | null;
  pos_english: string | null;
  pos_arabic: string | null;
  pos_class: string | null;
  occurrence_count: number;
}

export interface RootMeaning {
  source: string;
  language: string;
  meaning: string;
  source_ref: string | null;
}

export interface RootDetail {
  root_buckwalter: string;
  root_arabic: string;
  letters_arabic: string | null;
  letter_count: number | null;
  meaning_en: string | null;
  meaning_ar: string | null;
  total_occurrences: number;
  forms: RootForm[];
  meanings: RootMeaning[];
}

export interface RootSummary {
  root_buckwalter: string;
  root_arabic: string;
  letters_arabic: string | null;
  letter_count: number | null;
  meaning_en: string | null;
  total_occurrences: number;
  form_count: number;
}

export interface RootOccurrence {
  verse_key: string;
  word_position: number;
  form_arabic: string | null;
  form_buckwalter: string | null;
  pos_english: string | null;
  lemma_arabic: string | null;
  chapter_id: number;
  verse_number: number;
  /** English gloss of the word — a MEANING. Never render while sealed. */
  translation_text: string | null;
  verse_text: string | null; // uthmani_simple
}

export interface Linkage {
  root_buckwalter: string;
  root_arabic: string;
  cooccur: number;
  score: number;
  pmi: number;
  npmi: number;
  jaccard?: number | null;
  cosine?: number | null;
}

export interface CompositeMatch {
  verse_key: string;
  chapter_id: number;
  verse_number: number;
  text: string | null;
  score: number;
  overlap: number;
  phrase: number;
  morphology: number;
  shared: string[];
  pattern: string[];
  /** actual longest contiguous run of shared roots (Arabic) — the "phrase" */
  phrase_run?: string[];
}

export interface FreeTextResult {
  query: string;
  resolved: { token: string; root: string | null; pos: string | null }[];
  unresolved: string[];
  matches: CompositeMatch[];
}

export type SimilarityWeights = {
  overlap?: number;
  phrase?: number;
  morphology?: number;
};
