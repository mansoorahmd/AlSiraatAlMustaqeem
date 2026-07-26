// Types mirroring the server responses (server/src + app/src/api/types.ts).
// The on-device data layer returns these exact shapes so screen code is
// portable with the web app.

export type Script =
  | "uthmani"
  | "uthmani_simple"
  | "imlaei"
  | "imlaei_simple"
  | "indopak"
  | "tajweed";

export const SCRIPT_LABELS: Record<Script, string> = {
  uthmani: "Uthmani",
  uthmani_simple: "Uthmani (simple)",
  imlaei: "Imlaei",
  imlaei_simple: "Imlaei (simple)",
  indopak: "IndoPak",
  tajweed: "Tajweed",
};

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
  script?: Script;
  text?: string | Record<Script, string>;
  words?: Word[];
  translations?: Translation[];
  focus?: boolean;
}

export interface Word {
  position: number;
  arabic: string | null;
  gloss: string | null;
  transliteration: string | null;
  lemma: string | null;
  lemma_buckwalter: string | null;
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

/** A verbatim phrase in a verse that recurs elsewhere in the Book. */
export interface Echo {
  phrase: string;
  words: string[];
  start: number; // 1-based word index in the verse
  length: number;
  occurrences: { verseKey: string; start: number }[];
  count: number;
}

export interface TranslationResource {
  id: number;
  name: string | null;
  author_name: string | null;
  language_name: string | null;
  resource_type: string | null;
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
  translation_text: string | null;
  verse_text: string | null;
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
  phrase_run?: string[];
}

export interface FreeTextResult {
  query: string;
  resolved: { token: string; root: string | null; pos: string | null }[];
  unresolved: string[];
  matches: CompositeMatch[];
}
