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
/** `here`: the spelling the asked-about occurrence is written in */
export interface SpellingVariant { surface: string; count: number; verses: string[]; here?: boolean }

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
  /** who may see it once approved (the author proposed it; a reviewer may change it) */
  audience?: { minRole: string | null; minPlan: string | null };
  createdAt: number;
}
/** What an AI proposed through the MCP server, awaiting the reader's review. */
export interface Proposed {
  notes: import("../persistence/types").NoteRecord[];
  indications: WordIndication[];
  links: import("../persistence/types").SavedLink[];
  speech: import("../persistence/types").SpeakerTag[];
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

// Links (corpus-core/src/links.ts): what an āyah shares with the rest of the Book, and how rare
// each shared thing is. Counted only; nothing here interprets.
export type LinkKind = "phrase" | "pair" | "form" | "lemma" | "root";
/** where a marker lands in another āyah: the 1-based word position it starts at */
export interface LinkPlace { verseKey: string; start: number }
export interface LinkMarker {
  kind: LinkKind;
  /** what is shared, as written (Arabic) */
  text: string;
  key: string;
  /** every 1-based word position in THIS āyah where the marker starts */
  positions: number[];
  /** how many words it spans */
  length: number;
  /** āyāt in the Book that carry it, this one included */
  ayahs: number;
  /** the other āyāt, mushaf order (capped; `ayahs` is the true total) */
  places: LinkPlace[];
}
export interface CommonLink { kind: LinkKind; text: string; positions: number[]; length: number; ayahs: number }
export interface OnlyHereLink { kind: "root" | "lemma"; text: string; position: number }
export interface AyahLinks {
  verseKey: string;
  /** markers in at most `max` āyāt, rarest first */
  links: LinkMarker[];
  /** markers too widespread to list with places: counted only */
  common: CommonLink[];
  /** roots and words found in this āyah and nowhere else */
  onlyHere: OnlyHereLink[];
}
export type ExclusiveKind = "root" | "lemma" | "form" | "phrase";
export interface ExclusiveItem { kind: ExclusiveKind; text: string; key: string; length: number; places: LinkPlace[] }
export interface ExclusiveLinks { total: number; items: ExclusiveItem[] }

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

// ---- search by grammar (corpus-core/src/constructions.ts) ----

/** one value, or several of which any may match */
export type OneOrMore = string | string[];

export interface ConstructionSlot {
  /** the written word, vowels ignored (a leading و / ف may be left off) */
  form?: OneOrMore;
  lemma?: OneOrMore;
  /** Arabic (ر ء ي) or Buckwalter (rAy) */
  root?: OneOrMore;
  /** a tag (V, N, REL, …), its name, or a class (Verbs, …) */
  pos?: OneOrMore;
  /** a prefix the word carries: FUT, INTG, ta+, connective, … */
  prefix?: OneOrMore;
  verb?: {
    aspect?: "PERF" | "IMPF" | "IMPV";
    mood?: "IND" | "SUBJ" | "JUS";
    voice?: "ACT" | "PASS";
    person?: "1" | "2" | "3";
    number?: "S" | "D" | "P";
    gender?: "M" | "F";
  };
  /** how a noun is derived, as the corpus marks it: ACT_PCPL, PASS_PCPL, VN */
  derivation?: OneOrMore;
  /** the verb form (I to XII) of a verb or of a noun derived from one */
  verbForm?: OneOrMore;
  /** a pronoun attached at the end, by person-gender-number (1S, 3MP, …), or "any" */
  suffix?: OneOrMore;
  /** a noun's or adjective's number and gender */
  noun?: { number?: "S" | "D" | "P"; gender?: "M" | "F" };
  /** slots after the first: at most this many words between it and the slot before */
  gap?: number;
}

export interface ConstructionQuery {
  slots: ConstructionSlot[];
  /** the first slot is the āyah's first word */
  atStart?: boolean;
}

export interface ConstructionPreset { name: string; label: string; description: string; query: ConstructionQuery }

/** GET /construction-presets: the presets and the vocabulary a slot may use */
export interface ConstructionCatalog {
  presets: ConstructionPreset[];
  pos: Record<string, string>;
  classes: string[];
  prefixes: Record<string, string>;
  /** derivation id → name (Active participle, …) */
  derivations: Record<string, string>;
  /** I … XII */
  verbForms: string[];
  /** attached-pronoun code → name ("any" first) */
  suffixes: Record<string, string>;
}

export interface ConstructionHit {
  verse_key: string;
  /** 1-based word span matched */
  start: number;
  length: number;
  /** the whole āyah (Uthmani) */
  text: string;
  /** the matched words as written */
  match: string;
}

export interface ConstructionResult { total: number; ayahs: number; hits: ConstructionHit[] }

// ---- yt219 corpus tools. These shapes are the contract: corpus-core answers in them. ----

/** What a list of occurrences is a list OF. The first five are the Links panel's marker kinds
 *  (key = LinkMarker.key); "spelling" is one exact written shape, or one spelling of one word as
 *  Spellings counts it ("<group key>|<spelling>"); "construction" a grammar query. */
export type OccurrenceKind = LinkKind | "spelling" | "construction";
export interface OccurrenceScope { kind: OccurrenceKind; key: string; text: string; query?: ConstructionQuery }
/** One place: `words` words starting at word `word` (1-based word positions), as written. */
export interface Occurrence { verseKey: string; word: number; words: number; text: string }
export interface Occurrences {
  kind: OccurrenceKind; key: string;
  /** every place in the Book, and how many āyāt they fall in */
  total: number; ayahs: number;
  /** true when `places` was cut short of `total` */
  truncated: boolean;
  places: Occurrence[];
}

/** Words written more than one way, Book-wide. */
export interface SpellingKind { id: string; label: string; count: number }
export interface SpellingShape {
  surface: string; count: number; ayahs: number; places: { verseKey: string; word: number }[];
  /** how many of `count` carry a pronoun and so are written ت where the bare word ends in ة (the
   *  script's rule). Counted here only where the bare word is never written ت. Absent when none. */
  attached?: number;
}
export interface SpellingGroup {
  /** `total` = the words of every spelling, and of `withPronoun` */
  key: string; lemma: string; root: string | null; total: number;
  /** which kinds of difference separate its spellings (ids from SpellingList.kinds) */
  kinds: string[];
  spellings: SpellingShape[];
  /** where the bare word is written both ة and ت: its words that carry a pronoun, which the
   *  script writes ت either way, counted with neither spelling. Absent when none. */
  withPronoun?: { count: number; ayahs: number; places: { verseKey: string; word: number }[] };
}
export interface SpellingList {
  total: number;
  /** groups whose spellings differ only by a grammatical ending, left out of a list asked for
   *  without a kind (ask kind=ending for them) */
  hidden: number;
  kinds: SpellingKind[]; items: SpellingGroup[];
}

/** Where speech is introduced in a sūrah (قال، قالوا، قل، نادى …): the word that opens it. */
export interface SpeechOpener {
  verseKey: string; word: number; text: string; root: string; lemma: string;
  /** true when the corpus itself shows speech follows: every verb of ق و ل, and another verb where
   *  a vocative (يا) or an explaining أن follows it. false = a call; speech may or may not follow. */
  sure: boolean;
  /** true when the verb is of a root the reader added (not ق و ل or ن د و) */
  added?: boolean;
}
export interface SpeechOpeners { chapter: number; openers: SpeechOpener[] }

/** The pronouns of one āyah: separate words, attached to a word, or (when asked) inside a verb. */
export interface PronounInAyah {
  word: number; text: string; pronoun: string; type: "separate" | "attached" | "verb";
  person: string | null; number: string | null; gender: string | null;
  /** which pronoun of its word this is, counting from 1 in the corpus's order (a word such as
   *  خَلَقْنَـٰكُمْ carries two). A mention points at one of them by this number. */
  part: number;
}
export interface AyahPronouns { verseKey: string; pronouns: PronounInAyah[] }

// ---- yt218 corpus tools. These shapes are the contract: corpus-core answers in them. ----

/** Where a set of roots occurs, by sūrah and by page of the muṣḥaf. It counts, nothing more. */
export interface SpreadChapter { chapter: number; places: number; ayahs: number; /** āyāt in the sūrah */ verses: number }
export interface SpreadPage { page: number; places: number; ayahs: number }
export interface RootSpread {
  /** the roots counted, in Arabic letters */
  roots: string[];
  /** roots that were asked for and are not in the Book */
  unknown: string[];
  total: number; ayahs: number;
  /** all 114 sūrahs in order, zeros included */
  chapters: SpreadChapter[];
  /** every page of the muṣḥaf in order, zeros included */
  pages: SpreadPage[];
  emptyChapters: number; emptyPages: number;
}

/** Every place the Lord is addressed with one of three openings. Whether a place is a
 *  supplication is the reader's to say: this lists where the address is written. */
export type SupplicationOpening = "rabbana" | "rabbi" | "allahumma";
export interface Supplication { verseKey: string; word: number; opening: SupplicationOpening; text: string }
export interface Supplications {
  total: number; ayahs: number;
  openings: { id: SupplicationOpening; label: string; count: number; ayahs: number }[];
  items: Supplication[];
}

/** What the first āyāt of a sūrah share with its last: the roots found in both ends. */
export interface FramePlace { verseKey: string; word: number; text: string; lemma: string }
export interface FrameShare {
  /** the shared root, in Arabic letters */
  root: string;
  /** how many times the root occurs in the whole Book */
  inBook: number;
  /** how close the match is: the same written word at both ends, the same lemma, or only the root */
  level: "form" | "lemma" | "root";
  opening: FramePlace[]; close: FramePlace[];
}
export interface SurahFrame {
  chapter: number; verses: number;
  /** how many āyāt each end takes (never so many that the two ends overlap) */
  n: number;
  opening: string[]; close: string[];
  /** the root rarest in the Book first */
  shares: FrameShare[];
}

/** Any Arabic text set against the Book, word by word. */
export interface WordingWord {
  text: string;
  /** written = found exactly as written; letters = same letters, other vowels; stem = found
   *  after setting aside a leading و ف ب ل ك ال …; none = not in the Book */
  status: "written" | "letters" | "stem" | "none";
  written: { count: number; ayahs: number };
  letters: { count: number; ayahs: number; forms: string[]; roots: string[] };
  stem: { prefix: string; text: string; count: number; ayahs: number; roots: string[] } | null;
  /** one āyah it is found in, to open */
  sample: string | null;
}
export interface WordingCheck { words: WordingWord[]; summary: { total: number; written: number; letters: number; stem: number; none: number } }

/** Two āyāt word against word. */
export interface DiffWord { word: number; text: string }
export type DiffHow = "same" | "marks" | "spelling" | "changed" | "only-a" | "only-b";
export interface DiffRow { a: DiffWord | null; b: DiffWord | null; how: DiffHow }
export interface AyahDiff { a: string; b: string; rows: DiffRow[]; counts: Record<DiffHow, number> }
