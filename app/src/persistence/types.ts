// Typed records for the research archive (research.db via the API).
// Mirrors UI_ACTION_PLAN.md §6 (research-first model).

export type SubjectType = "root" | "phrase" | "ayah";

export interface CaseSubject {
  type: SubjectType;
  /** root_arabic for roots, the phrase text, or a verse_key */
  value: string;
  /** where the case was sparked from, if opened while reading */
  sparkVerseKey?: string;
  sparkWordPosition?: number;
  /** the lemma of the word that sparked the case */
  sparkForm?: string;
}

export interface HighlightRange {
  start: number; // 1-based word positions, inclusive
  end: number;
  color: string;
}

export interface EvidenceCardRecord {
  id: string;
  verseKey: string;
  wordPosition: number | null;
  x: number;
  y: number;
  rotation: number; // legacy paper tilt (modern board renders flat)
  /** segment highlights painted on this card */
  highlights?: HighlightRange[];
}

export type SlipKind = "comment" | "reference";

/** The reader's own evidence: an observation, or a cited source. */
export interface SlipRecord {
  id: string;
  kind: SlipKind;
  /** lemma this slip belongs to, or null for the root itself */
  form: string | null;
  text: string;
  /** reference slips only */
  source?: string;  // e.g. "Lane's Lexicon", "Tafsir al-Tabari"
  locator?: string; // e.g. "vol 8 p. 2925", "under ه-د-ي", a URL
  x: number;
  y: number;
  rotation: number;
}

export interface ThreadRecord {
  id: string;
  fromCardId: string; // card OR slip id
  toCardId: string;
  /** word anchors: thread points at a specific word on the card */
  fromWord?: number | null;
  toWord?: number | null;
  label: string;
  source: "user" | "suggested";
  accepted: boolean; // suggested threads become ink when accepted
}

export interface ClusterRecord {
  id: string;
  name: string;
  cardIds: string[]; // card or slip ids
}

export type FormStatus = "open" | "established";

export interface FormResearchEntry {
  status: FormStatus;
  meaning: string;
  establishedAt?: number;
}

export type CaseStatus = "open" | "partial" | "closed";

export interface CaseRecord {
  id: string;
  subject: CaseSubject;
  title: string;
  /** the researcher's framing of the case — question, scope, intent */
  description?: string;
  cards: EvidenceCardRecord[];
  slips: SlipRecord[];
  threads: ThreadRecord[];
  clusters: ClusterRecord[];
  /** per-form research: lemma → status + established meaning */
  formResearch: Record<string, FormResearchEntry>;
  verdict: string;
  status: CaseStatus;
  /** id of the curated case file, if this is a guided investigation */
  curatedId?: string;
  revealedClueCount?: number;
  createdAt: number;
  updatedAt: number;
}

/** @deprecated legacy IndexedDB vault; replaced by family pages from cases */
export type Confidence = "tentative" | "settled" | "revisited";
export interface VaultEntry {
  rootArabic: string;
  rootBuckwalter: string | null;
  verdict: string;
  confidence: Confidence;
  caseId: string;
  unsealed: true;
  createdAt: number;
  updatedAt: number;
}

export interface TrailHop {
  verseKey: string;
  wordPosition: number | null;
}

export interface TrailRecord {
  id: string;
  name: string;
  subject: string | null;
  hops: TrailHop[];
  createdAt: number;
  updatedAt: number;
}

/** Reading preferences and misc key-value settings (device-local). */
export interface PrefsRecord {
  key: string;
  value: unknown;
}

/** the reader's own meaning for a root, saved alongside the dictionaries */
export interface UserRootMeaning {
  root: string; // root_buckwalter
  meaning: string;
  updatedAt: number;
}

export type NoteKind = "note" | "question";

/** A note or question the reader attaches to an ayah or a specific word.
 *  Independent of cases — shows both while reading and on the board. */
export interface NoteRecord {
  id: string;
  verseKey: string;
  /** 1-based word position, or null for a note on the whole ayah */
  wordPosition: number | null;
  kind: NoteKind;
  text: string;
  /** the reader's answer to a question */
  answer?: string;
  /** questions can be marked answered */
  resolved?: boolean;
  /** form (exact spelling) and root of the noted word — for cross-references */
  lemma?: string | null;
  root?: string | null;
  createdAt: number;
  updatedAt: number;
}
