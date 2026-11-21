// Typed records for the research archive (kept in the account, via the research server).
// Mirrors DESIGN.md (research-first model).

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

/** Who put an item on the board. Absent means the reader ('me') — everything that
 *  predates AI access is theirs, and an AI may only ever touch its own items. */
export type ItemSource = "me" | "ai";

export interface EvidenceCardRecord {
  id: string;
  verseKey: string;
  wordPosition: number | null;
  x: number;
  y: number;
  rotation: number; // legacy paper tilt (modern board renders flat)
  /** segment highlights painted on this card */
  highlights?: HighlightRange[];
  source?: ItemSource;
  /** does the reader set this āyah for the reading, or against it? Absent = for */
  stance?: "for" | "against";
}

export type SlipKind = "comment" | "reference";

/** What kind of work a reference slip cites. The Book itself is never a slip (āyāt are cards),
 *  and a comment slip is the reader's own reasoning. */
export type SourceKind = "lexicon" | "tafsir" | "narration" | "story" | "other";

/** The reader's own evidence: an observation, or a cited source. */
export interface SlipRecord {
  id: string;
  kind: SlipKind;
  /** lemma this slip belongs to, or null for the root itself */
  form: string | null;
  text: string;
  /** reference slips only */
  source?: string;  // e.g. "Lane's Lexicon", "Tafsir al-Tabari"
  /** reference slips only: a dictionary, a tafsīr, a narration, a story from outside the Book,
   *  or something else. Absent = the reader has not said. */
  sourceKind?: SourceKind;
  locator?: string; // e.g. "vol 8 p. 2925", "under ه-د-ي", a URL
  x: number;
  y: number;
  rotation: number;
  /** who authored the slip. NOT `source` above — that is the work being cited. */
  author?: ItemSource;
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
  /** who authored it: distinct from `source` above, which is how it was offered */
  author?: ItemSource;
}

export interface ClusterRecord {
  id: string;
  name: string;
  cardIds: string[]; // card or slip ids
  /** the cluster's colour — its member cards carry a border of this colour */
  color?: string;
  source?: ItemSource;
}

export type FormStatus = "open" | "established";

export interface FormResearchEntry {
  status: FormStatus;
  meaning: string;
  establishedAt?: number;
}

export type CaseStatus = "open" | "partial" | "closed";

/** A conclusion an AI wants to draw, awaiting the reader's decision. */
export interface CaseProposal {
  id: string;
  /** what it concludes about: the case verdict, or one form's meaning */
  kind: "verdict" | "form";
  /** for kind 'form': which lemma. null for the case verdict. */
  form: string | null;
  text: string;
  /** the status the AI thinks the case has reached, if it says so */
  suggestedStatus?: CaseStatus;
  reasoning?: string;
  createdAt: number;
}
export interface CaseProposals {
  entries: CaseProposal[];
}

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
  /** "What would prove this wrong?", in the reader's words. The reader's own, like the verdict. */
  falsifier?: string;
  status: CaseStatus;
  /** An AI's proposed conclusions, parked until the reader accepts them. These NEVER
   *  affect `verdict`, `status` or `formResearch` — only the reader applies those. */
  proposals?: CaseProposals;
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
  /** the root, or the exact written word when subjectKind is "word" */
  subject: string | null;
  /** what the thread follows: the root family, or one exact written form */
  subjectKind?: "root" | "word";
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

/** a motif (بيت) — a reader-defined collection of roots sharing a linguistic motif */
export interface Motif {
  id: string;
  name: string;
  note: string;
  roots: string[]; // root_buckwalter
  createdAt?: number;
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
  /** 'me' = the reader wrote it; 'ai' = proposed via the MCP server */
  source?: "me" | "ai";
  createdAt: number;
  updatedAt: number;
}

/** A place in the Book: a run of words in one āyah (1-based word positions, as the corpus counts). */
export interface LinkEnd {
  verseKey: string;
  /** the word the span starts at */
  word: number;
  /** how many words it covers */
  words: number;
}

/** What a saved link says the two places have in common. Empty = not said. */
export type SavedLinkKind = "" | "same-wording" | "defined" | "same-style" | "same-image" | "refers" | "tension";

/** A link the reader saved between two places. With only its first end it is a LEAD:
 *  something noticed, the other end still to find. Kind 'defined' reads a → b as
 *  "a is where the term is explained, b is where it is used". */
export interface SavedLink {
  id: string;
  a: LinkEnd;
  b: LinkEnd | null;
  kind: SavedLinkKind;
  /** the shared marker, when the link was saved from the Links panel */
  marker: { kind: "phrase" | "pair" | "form" | "lemma" | "root"; key: string; text: string } | null;
  /** a name that groups links: one image, one theme */
  label: string;
  note: string;
  status: "lead" | "kept";
  /** kind 'tension' only ("these two seem to disagree, to me"): settled or still open, and how
   *  the reader settled it */
  resolved?: boolean;
  resolution?: string;
  /** 'me' = the reader saved it; 'ai' = proposed via the MCP server */
  source?: "me" | "ai";
  createdAt?: number;
  updatedAt?: number;
}

/** Who speaks in a span of an āyah, and to whom, as the reader tags it. */
export interface SpeakerTag {
  id: string;
  verseKey: string;
  /** the word the speech starts at */
  word: number;
  /** how many words; null = to the end of the āyah */
  words: number | null;
  speaker: string;
  addressee: string;
  /** who else hears it, as the reader reads it */
  listeners?: string;
  /** does the text itself say who speaks ("stated"), or is it the reader's inference? "" = not said */
  basis?: "" | "stated" | "inferred";
  note: string;
  source?: "me" | "ai";
  createdAt?: number;
  updatedAt?: number;
}

/** A rule the reader states, set against every place it applies. `scope` says which places:
 *  the corpus lists them (POST /corpus/occurrences), the reader marks each one. */
export type RuleMarkValue = "fits" | "exception" | "unsure";
export interface RuleMark {
  verseKey: string; word: number; mark: RuleMarkValue; note: string;
  /** 'ai' = suggested through the MCP server; it counts only once the reader accepts it */
  source: "me" | "ai"; updatedAt?: number;
}
export interface RuleCheck {
  id: string; title: string;
  /** the rule, in the reader's words */
  statement: string;
  /** what would prove it wrong, in the reader's words */
  falsifier: string;
  scope: import("../api/types").OccurrenceScope;
  createdAt?: number; updatedAt?: number;
  /** the reader's own marks by value, and how many AI suggestions wait */
  counts?: { fits: number; exception: number; unsure: number; suggested: number };
  /** only when one rule is fetched */
  marks?: RuleMark[];
}

/** A character the reader names, and the places that point to it. */
export type MentionKind = "name" | "title" | "description" | "pronoun";
export type MentionStatus = "potential" | "established";
/** A name or title given to a character: the corpus finds its occurrences (same scope as a rule). */
export type Designation = import("../api/types").OccurrenceScope & { as: "name" | "title" | "description" };
export interface Mention {
  /** `${characterId}|${verseKey}|${word}|${part}` : one mention per character per place */
  id: string;
  characterId: string; verseKey: string; word: number; words: number;
  /** 0 = the word itself (a name, a title); 1, 2 … = that pronoun of the word, as
   *  PronounInAyah.part numbers them, so the two pronouns of one word are two places */
  part: number;
  kind: MentionKind;
  /** the designation's text it was filed under ("" when picked by hand, e.g. a pronoun) */
  designation: string;
  status: MentionStatus; note: string;
  source?: "me" | "ai"; createdAt?: number; updatedAt?: number;
}
export interface Character {
  id: string; name: string; note: string; designations: Designation[];
  createdAt?: number; updatedAt?: number;
  counts?: { established: number; potential: number };
  /** only when one character is fetched */
  mentions?: Mention[];
}
/** What a new mention needs; the server fills the rest. */
export type MentionDraft = Pick<Mention, "characterId" | "verseKey" | "word" | "kind"> &
  Partial<Pick<Mention, "words" | "part" | "designation" | "status" | "note">>;

/** An earlier text the reader replaced, kept with its date and (if they say) why.
 *  form = a word form's established meaning on a case; verdict = a closed case's conclusion;
 *  root-meaning = the reader's own meaning for a root; indication = an indication's text. */
export type RevisionKind = "form" | "verdict" | "root-meaning" | "indication";
export interface Revision {
  id: string;
  kind: RevisionKind;
  /** form: `${caseId}|${lemma}`; verdict: the case id; root-meaning: the root (Buckwalter);
   *  indication: the indication's id */
  target: string;
  /** the text that was replaced */
  before: string;
  /** why the reader changed it, in their words ("" = not said) */
  reason: string;
  replacedAt: number;
}

/** Per sūrah: the āyāt that are an end of a kept link, and those that only have a lead. */
export interface LinkCoverage { chapter: number; linked: string[]; leads: string[] }
