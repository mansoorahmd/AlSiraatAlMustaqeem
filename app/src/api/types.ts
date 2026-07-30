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
