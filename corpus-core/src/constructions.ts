// Constructions: search the Book by how words are BUILT, not only by which words they are.
//
// Some links between āyāt are not a shared word but a shared construction: āyāt that open with
// وَإِذْ, the question أَرَءَيْتَ, the future with سَ against سَوْفَ, ٱلَّذِى followed by a verb.
// The corpus carries every word's grammar (word_segments); this index lets a query name it.
//
// A query is a row of one to four word SLOTS. A slot matches one word by any combination of:
//
//   form    the written word, vowels ignored (a leading و / ف may be left off)
//   lemma   the dictionary form
//   root    the root, Arabic (ر ء ي, رأي) or Buckwalter (rAy)
//   pos     part of speech: a tag (V, N, PN, REL, …), its name ("verb") or a class ("Verbs")
//   prefix  a prefix the word carries: a tag (FUT, INTG, CONJ, …), a type (sa+, ta+, bi+, …),
//           letter:tag (w:CONJ, f:REM) or "connective" (any joining و / ف)
//   verb    verb features: aspect, mood, voice, person, number, gender
//   derivation  active participle, passive participle or verbal noun, as the corpus marks them
//   verbForm    I to XII, of a verb or of a noun derived from one (the corpus writes none for I)
//   suffix      a pronoun attached at the end, by person, gender and number (1S, 3MP, …) or "any"
//   noun    a noun's or adjective's number and gender
//
// A text field takes one value or several (any of them). Each slot after the first follows the
// one before it directly, or within `gap` words. `atStart` pins the first slot to the āyah's first
// word. A hit is the span of words matched, 1-based, so the reader can light it.
//
// Nothing here interprets. It finds and counts.

import type { CorpusDb } from "./corpus-db.js";
import { once } from "./corpus-db.js";
import { foldArabic } from "./text/normalize.js";

/** One value, or several of which any may match. */
export type OneOrMore = string | string[];

export interface VerbFeatures {
  aspect?: "PERF" | "IMPF" | "IMPV";
  /** IND is an imperfect verb with no subjunctive or jussive ending */
  mood?: "IND" | "SUBJ" | "JUS";
  voice?: "ACT" | "PASS";
  person?: "1" | "2" | "3";
  number?: "S" | "D" | "P";
  gender?: "M" | "F";
}

export interface NounFeatures {
  /** S also takes a noun the corpus gives a gender and no number: it leaves the singular unmarked */
  number?: "S" | "D" | "P";
  gender?: "M" | "F";
}

export interface ConstructionSlot {
  form?: OneOrMore;
  lemma?: OneOrMore;
  root?: OneOrMore;
  pos?: OneOrMore;
  prefix?: OneOrMore;
  verb?: VerbFeatures;
  /** how a noun is derived from a verb, as the corpus marks it: ACT_PCPL, PASS_PCPL, VN */
  derivation?: OneOrMore;
  /** the verb form, I to XII, of a verb or of a noun derived from one */
  verbForm?: OneOrMore;
  /** a pronoun attached to the end of the word, by person, gender and number (1S, 3MP, …), or "any" */
  suffix?: OneOrMore;
  /** a noun's or adjective's number and gender */
  noun?: NounFeatures;
  /** for every slot after the first: at most this many words between the slot before and this
   *  one (0, the default, means the very next word) */
  gap?: number;
}

export interface ConstructionQuery {
  /** one to four slots, in reading order */
  slots: ConstructionSlot[];
  /** the first slot must be the āyah's first word (a leading و / ف on it is allowed) */
  atStart?: boolean;
}

/** A query plus paging: the body of POST /construction-search. */
export interface ConstructionSearch extends ConstructionQuery {
  limit?: number;
  offset?: number;
}

export interface ConstructionHit {
  verse_key: string;
  /** 1-based word position the match starts at */
  start: number;
  /** how many words the match spans, gaps included */
  length: number;
  /** the whole āyah (Uthmani script), for lighting the span */
  text: string;
  /** the matched words as written */
  match: string;
}

export interface ConstructionResult {
  /** matches in the whole Book (an āyah may hold more than one) */
  total: number;
  /** āyāt holding at least one match */
  ayahs: number;
  hits: ConstructionHit[];
}

export interface ConstructionPreset {
  name: string;
  label: string;
  description: string;
  query: ConstructionQuery;
}

export const MAX_SLOTS = 4;
export const MAX_GAP = 10;

// ------------------------------------------------------------------ vocabulary ----

/** Stem part-of-speech tags, with their names. */
export const POS_TAGS: Readonly<Record<string, string>> = {
  N: "Noun", PN: "Proper noun", ADJ: "Adjective", IMPN: "Imperative verbal noun",
  V: "Verb",
  PRON: "Personal pronoun", DEM: "Demonstrative pronoun", REL: "Relative pronoun",
  T: "Time adverb", LOC: "Location adverb",
  P: "Preposition",
  CONJ: "Coordinating conjunction", SUB: "Subordinating conjunction",
  NEG: "Negative particle", ACC: "Accusative particle", COND: "Conditional particle",
  RES: "Restriction particle", INTG: "Interrogative particle", CERT: "Particle of certainty",
  PRO: "Prohibition particle", PREV: "Preventive particle", RET: "Retraction particle",
  EXP: "Exceptive particle", INC: "Inceptive particle", EXL: "Explanation particle",
  AMD: "Amendment particle", INT: "Particle of interpretation", FUT: "Future particle",
  ANS: "Answer particle", EXH: "Exhortation particle", SUR: "Surprise particle",
  AVR: "Aversion particle", SUP: "Supplemental particle", INL: "Disconnected letters",
};

/** The classes the tags fall into (word_segments.pos_class). */
export const POS_CLASSES = [
  "Nouns", "Nominals", "Verbs", "Pronouns", "Adverbs", "Prepositions", "Conjunctions",
  "Particles", "Disconnected Letters",
] as const;

/** The prefixes a slot can ask for, with what each one is. */
export const PREFIXES: Readonly<Record<string, string>> = {
  connective: "و / ف joining the word to what came before (any of the next seven)",
  CONJ: "و / ف conjunction",
  REM: "و / ف of resumption",
  RSLT: "فَ of result",
  CIRC: "وَ circumstantial",
  SUP: "و / ف supplemental",
  CAUS: "فَ of cause",
  COM: "وَ comitative (with)",
  "Al+": "ٱل, the definite article",
  "bi+": "بِ preposition",
  "ka+": "كَ preposition (like)",
  "l:P": "لِ preposition",
  "ta+": "تَ of the oath",
  "w:P": "وَ of the oath",
  P: "any preposition prefix (بِ كَ لِ تَ وَ)",
  EMPH: "لَ of emphasis",
  PRP: "لِ of purpose",
  IMPV: "لِ of command",
  INTG: "أَ interrogative",
  EQ: "أَ of equalization",
  VOC: "يَا / هَا vocative",
  FUT: "سَ future",
};

/** How a noun is derived from a verb: the corpus's own marks (word_segments.derivation). */
export const DERIVATIONS: Readonly<Record<string, string>> = {
  ACT_PCPL: "Active participle",
  PASS_PCPL: "Passive participle",
  VN: "Verbal noun",
};
const DERIVATION_OF: Readonly<Record<string, string>> = { "ACT PCPL": "ACT_PCPL", "PASS PCPL": "PASS_PCPL", VN: "VN" };

/** The verb forms the corpus marks (word_segments.verb_form). It writes no form for form I, so a
 *  verb, or a word it marks as derived, with no form is form I. */
export const VERB_FORMS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

/** The pronouns a word can carry at its end, by person, gender and number (SUFFIX|PRON:…). */
export const SUFFIXES: Readonly<Record<string, string>> = {
  any: "any attached pronoun",
  "1S": "1st person singular", "1P": "1st person plural",
  "2MS": "2nd person masculine singular", "2FS": "2nd person feminine singular",
  "2D": "2nd person dual", "2MD": "2nd person masculine dual", "2FD": "2nd person feminine dual",
  "2MP": "2nd person masculine plural", "2FP": "2nd person feminine plural",
  "3MS": "3rd person masculine singular", "3FS": "3rd person feminine singular",
  "3D": "3rd person dual", "3MD": "3rd person masculine dual", "3FD": "3rd person feminine dual",
  "3MP": "3rd person masculine plural", "3FP": "3rd person feminine plural",
};

const NOUN_VALUES: { [K in keyof NounFeatures]-?: readonly string[] } = {
  number: ["S", "D", "P"],
  gender: ["M", "F"],
};

// A leading و / ف that only joins the word to what came before. The same set links.ts sets
// aside, so وَإِذْ and إِذْ are one written form. The oath wāw (tag P) is part of the word.
const CONNECTIVE = new Set(["CONJ", "REM", "RSLT", "CIRC", "SUP", "CAUS", "COM"]);

const VERB_VALUES: { [K in keyof VerbFeatures]-?: readonly string[] } = {
  aspect: ["PERF", "IMPF", "IMPV"],
  mood: ["IND", "SUBJ", "JUS"],
  voice: ["ACT", "PASS"],
  person: ["1", "2", "3"],
  number: ["S", "D", "P"],
  gender: ["M", "F"],
};

const lc = (s: string) => s.trim().toLowerCase();
const KNOWN_POS = new Set<string>([
  ...Object.keys(POS_TAGS).map(lc), ...Object.values(POS_TAGS).map(lc), ...POS_CLASSES.map(lc),
]);
const KNOWN_PREFIX = new Set(Object.keys(PREFIXES).map(lc));
const LETTER_TAG = /^[a-z]:[a-z]+$/;

// ------------------------------------------------------------------- presets ----

export const CONSTRUCTION_PRESETS: readonly ConstructionPreset[] = [
  {
    name: "idh-opening",
    label: "Opening with وَإِذْ / إِذْ",
    description: "Āyāt whose first word is إِذْ (“when…”), with or without a joining وَ or فَ.",
    query: { atStart: true, slots: [{ form: "إذ" }] },
  },
  {
    name: "a-raayta",
    label: "أَرَءَيْتَ and its family",
    description: "The interrogative أَ on a verb of seeing (ر ء ي): أَرَءَيْتَ, أَرَءَيْتُمْ, أَفَرَءَيْتُم, أَرَءَيْتَكُمْ.",
    query: { slots: [{ prefix: "INTG", root: "راي" }] },
  },
  {
    name: "sa-verb",
    label: "سَ + verb",
    description: "A verb carrying the future prefix سَ, as in سَأَسْتَغْفِرُ.",
    query: { slots: [{ prefix: "FUT", pos: "V" }] },
  },
  {
    name: "sawfa-verb",
    label: "سَوْفَ + verb",
    description: "The future particle سَوْفَ directly followed by a verb, as in سَوْفَ أَسْتَغْفِرُ.",
    query: { slots: [{ lemma: "سَوْف" }, { pos: "V" }] },
  },
  {
    name: "alladhi-verb",
    label: "ٱلَّذِى / ٱلَّتِى / ٱلَّذِينَ + verb",
    description: "The relative ٱلَّذِى in any of its forms directly followed by a verb (“the one who…”).",
    query: { slots: [{ lemma: "ٱلَّذِى" }, { pos: "V" }] },
  },
  {
    name: "oath-ta",
    label: "تَٱللَّهِ — the oath with تَ",
    description: "The name ٱللَّه sworn by with the oath letter تَ, with or without a joining وَ.",
    query: { slots: [{ prefix: "ta+", lemma: "ٱللَّه" }] },
  },
  {
    name: "active-participle",
    label: "Active participle",
    description: "Every word the corpus marks as an active participle (فَاعِل and its kin in the other verb forms).",
    query: { slots: [{ derivation: "ACT_PCPL" }] },
  },
  {
    name: "passive-participle",
    label: "Passive participle",
    description: "Every word the corpus marks as a passive participle (مَفْعُول and its kin in the other verb forms).",
    query: { slots: [{ derivation: "PASS_PCPL" }] },
  },
  {
    name: "rabbana-opening",
    label: "Opening with رَبَّنَا / رَبِّ",
    description: "Āyāt whose first word is رَبّ carrying the pronoun of the 1st person: رَبَّنَا (نَا written), رَبِّ (its ى not written).",
    query: { atStart: true, slots: [{ lemma: "رَبّ", suffix: ["1S", "1P"] }] },
  },
];

export const presetByName = (name: string): ConstructionPreset | undefined =>
  CONSTRUCTION_PRESETS.find((p) => p.name === name);

// ---------------------------------------------------------------- validation ----

/** A query the index can't run: answered 400 with this message. */
export class ConstructionQueryError extends Error {}

const SLOT_KEYS = new Set(["form", "lemma", "root", "pos", "prefix", "verb", "gap", "derivation", "verbForm", "suffix", "noun"]);
const TEXT_KEYS = ["form", "lemma", "root", "pos", "prefix", "derivation", "verbForm", "suffix"] as const;
// the text fields that take only a fixed set of values (matched without regard to case)
const CLOSED: Partial<Record<(typeof TEXT_KEYS)[number], readonly string[]>> = {
  derivation: Object.keys(DERIVATIONS),
  verbForm: VERB_FORMS,
  suffix: Object.keys(SUFFIXES),
};

function texts(v: unknown, where: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const list = Array.isArray(v) ? v : [v];
  if (!list.every((x) => typeof x === "string")) throw new ConstructionQueryError(`${where} must be a string or a list of strings`);
  const out = (list as string[]).map((s) => s.trim()).filter(Boolean);
  return out.length ? out : undefined;
}

/** Check a request body and return it as a typed search. Throws ConstructionQueryError. */
export function parseConstructionSearch(body: unknown): ConstructionSearch {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ConstructionQueryError("the body must be a JSON object with `slots`");
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.slots) || b.slots.length < 1 || b.slots.length > MAX_SLOTS) {
    throw new ConstructionQueryError(`slots must be a list of 1 to ${MAX_SLOTS} word slots`);
  }
  const slots: ConstructionSlot[] = b.slots.map((raw: unknown, i: number) => {
    const where = `slot ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConstructionQueryError(`${where} must be an object`);
    const s = raw as Record<string, unknown>;
    for (const k of Object.keys(s)) if (!SLOT_KEYS.has(k)) throw new ConstructionQueryError(`${where}: unknown field "${k}"`);
    const slot: ConstructionSlot = {};
    for (const k of TEXT_KEYS) {
      let v = texts(s[k], `${where} ${k}`);
      const allowed = CLOSED[k];
      if (v && allowed) {
        v = v.map((x) => {
          const hit = allowed.find((a) => a.toLowerCase() === x.toLowerCase());
          if (!hit) throw new ConstructionQueryError(`${where}: ${k} must be one of ${allowed.join(", ")}`);
          return hit;
        });
      }
      if (v) slot[k] = v.length === 1 ? v[0]! : v;
    }
    for (const p of texts(s.pos, `${where} pos`) ?? []) {
      if (!KNOWN_POS.has(lc(p))) throw new ConstructionQueryError(`${where}: unknown part of speech "${p}" (use a tag such as ${Object.keys(POS_TAGS).slice(0, 6).join(", ")}, or a class such as Verbs)`);
    }
    for (const p of texts(s.prefix, `${where} prefix`) ?? []) {
      if (!KNOWN_PREFIX.has(lc(p)) && !LETTER_TAG.test(lc(p))) {
        throw new ConstructionQueryError(`${where}: unknown prefix "${p}" (one of ${Object.keys(PREFIXES).join(", ")})`);
      }
    }
    if (s.verb !== undefined && s.verb !== null) {
      if (typeof s.verb !== "object" || Array.isArray(s.verb)) throw new ConstructionQueryError(`${where} verb must be an object`);
      const verb: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.verb as Record<string, unknown>)) {
        const allowed = VERB_VALUES[k as keyof VerbFeatures];
        if (!allowed) throw new ConstructionQueryError(`${where}: unknown verb feature "${k}" (${Object.keys(VERB_VALUES).join(", ")})`);
        if (v === undefined || v === null || v === "") continue;
        const val = String(v).toUpperCase();
        if (!allowed.includes(val)) throw new ConstructionQueryError(`${where}: verb ${k} must be one of ${allowed.join(", ")}`);
        verb[k] = val;
      }
      if (Object.keys(verb).length) slot.verb = verb as VerbFeatures;
    }
    if (s.noun !== undefined && s.noun !== null) {
      if (typeof s.noun !== "object" || Array.isArray(s.noun)) throw new ConstructionQueryError(`${where} noun must be an object`);
      const noun: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.noun as Record<string, unknown>)) {
        const allowed = NOUN_VALUES[k as keyof NounFeatures];
        if (!allowed) throw new ConstructionQueryError(`${where}: unknown noun feature "${k}" (${Object.keys(NOUN_VALUES).join(", ")})`);
        if (v === undefined || v === null || v === "") continue;
        const val = String(v).toUpperCase();
        if (!allowed.includes(val)) throw new ConstructionQueryError(`${where}: noun ${k} must be one of ${allowed.join(", ")}`);
        noun[k] = val;
      }
      if (Object.keys(noun).length) slot.noun = noun as NounFeatures;
    }
    if (s.gap !== undefined && s.gap !== null) {
      if (typeof s.gap !== "number" || !Number.isInteger(s.gap) || s.gap < 0 || s.gap > MAX_GAP) {
        throw new ConstructionQueryError(`${where}: gap must be a whole number from 0 to ${MAX_GAP}`);
      }
      if (i > 0 && s.gap > 0) slot.gap = s.gap;
    }
    if (!TEXT_KEYS.some((k) => slot[k] !== undefined) && !slot.verb && !slot.noun) {
      throw new ConstructionQueryError(`${where} has nothing to match: give it a word, lemma, root, part of speech, prefix, verb or noun feature, derivation, verb form or attached pronoun`);
    }
    return slot;
  });
  const num = (v: unknown, name: string) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new ConstructionQueryError(`${name} must be a number`);
    return Math.trunc(v);
  };
  const out: ConstructionSearch = { slots };
  if (b.atStart !== undefined && b.atStart !== null) {
    if (typeof b.atStart !== "boolean") throw new ConstructionQueryError("atStart must be true or false");
    if (b.atStart) out.atStart = true;
  }
  const limit = num(b.limit, "limit");
  const offset = num(b.offset, "offset");
  if (limit !== undefined) out.limit = limit;
  if (offset !== undefined) out.offset = offset;
  return out;
}

// --------------------------------------------------------------------- index ----

interface Word {
  pos: number;
  /** the whole written word, folded; and without a leading connective */
  whole: string;
  form: string;
  /** as written */
  text: string;
  lemmas: string[];     // folded
  roots: string[];      // folded Arabic
  rootsBw: string[];
  posKeys: string[];    // lowercased tags, tag names and classes of the stems
  prefixes: string[];   // lowercased: tag, type, letter:tag, "connective"
  verb: Required<{ [K in keyof VerbFeatures]: string | null }> | null;
  derivations: string[]; // ACT_PCPL, PASS_PCPL, VN
  verbForms: string[];   // I … XII
  suffixes: string[];    // 1S, 3MP, … of the attached pronouns
  noun: { number: string | null; gender: string | null } | null;
}

type Matcher = (w: Word) => boolean;
interface Compiled { match: Matcher; gap: number }

const isArabic = (s: string) => /[؀-ۿ]/.test(s);
// The corpus writes a root's hamza as ا (راي, امن), so any hamza a reader types (رأي, ر ء ي) is too.
const foldRoot = (s: string) => foldArabic(s.replace(/\s+/g, "")).replace(/[ءؤئ]/g, "ا");

function compileSlot(s: ConstructionSlot): Matcher {
  const tests: Matcher[] = [];
  const list = (v: OneOrMore | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
  const forms = list(s.form)?.map(foldArabic);
  if (forms) tests.push((w) => forms.includes(w.whole) || forms.includes(w.form));
  const lemmas = list(s.lemma)?.map(foldArabic);
  if (lemmas) tests.push((w) => w.lemmas.some((l) => lemmas.includes(l)));
  const roots = list(s.root);
  if (roots) {
    const ar = roots.filter(isArabic).map(foldRoot);
    const bw = roots.filter((r) => !isArabic(r)).map((r) => r.replace(/\s+/g, ""));
    tests.push((w) => w.roots.some((r) => ar.includes(r)) || w.rootsBw.some((r) => bw.includes(r)));
  }
  const pos = list(s.pos)?.map(lc);
  if (pos) tests.push((w) => w.posKeys.some((p) => pos.includes(p)));
  const prefixes = list(s.prefix)?.map(lc);
  if (prefixes) tests.push((w) => w.prefixes.some((p) => prefixes.includes(p)));
  if (s.verb) {
    const want = Object.entries(s.verb).filter(([, v]) => v) as [keyof VerbFeatures, string][];
    tests.push((w) => w.verb !== null && want.every(([k, v]) => w.verb![k] === v));
  }
  const derivations = list(s.derivation);
  if (derivations) tests.push((w) => w.derivations.some((d) => derivations.includes(d)));
  const verbForms = list(s.verbForm);
  if (verbForms) tests.push((w) => w.verbForms.some((f) => verbForms.includes(f)));
  const suffixes = list(s.suffix);
  if (suffixes) {
    const any = suffixes.includes("any");
    tests.push((w) => (any ? w.suffixes.length > 0 : w.suffixes.some((p) => suffixes.includes(p))));
  }
  if (s.noun) {
    const want = Object.entries(s.noun).filter(([, v]) => v) as [keyof NounFeatures, string][];
    tests.push((w) => w.noun !== null && want.every(([k, v]) => w.noun![k] === v));
  }
  return (w) => tests.every((t) => t(w));
}

export class ConstructionIndex {
  private verses: [string, Word[]][] = [];
  /** Built once, on first use; concurrent callers share the one build. */
  readonly build: () => Promise<void>;

  constructor(private db: CorpusDb) {
    this.build = once(() => this.load());
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{
      verse_key: string; word_position: number; segment_type: string | null; tag: string | null;
      pos_class: string | null; prefix_type: string | null; form_arabic: string | null;
      lemma_arabic: string | null; root_arabic: string | null; root_buckwalter: string | null;
      verb_aspect: string | null; verb_voice: string | null; person: string | null;
      gender: string | null; number: string | null; raw_features: string | null;
      verb_form: string | null; derivation: string | null;
    }>(
      `SELECT ws.verse_key, ws.word_position, ws.segment_type, ws.tag, ws.pos_class, ws.prefix_type,
              ws.form_arabic, ws.lemma_arabic, ws.root_arabic, ws.root_buckwalter, ws.verb_aspect,
              ws.verb_voice, ws.person, ws.gender, ws.number, ws.raw_features, ws.verb_form, ws.derivation
       FROM word_segments ws JOIN verses v ON v.verse_key = ws.verse_key
       ORDER BY v.chapter_id, v.verse_number, ws.word_position, ws.segment_number`,
    );

    const verses: [string, Word[]][] = [];
    let words: Word[] = [];
    let curKey = "";
    let cur: Word | null = null;
    let formText = "";
    let leading = true; // still inside the word's leading connectives
    const flush = () => {
      if (!cur) return;
      cur.whole = foldArabic(cur.text);
      cur.form = foldArabic(formText) || cur.whole;
      words.push(cur);
    };
    const add = (list: string[], v: string) => { if (!list.includes(v)) list.push(v); };

    for (const r of rows) {
      if (!cur || r.verse_key !== curKey || r.word_position !== cur.pos) {
        flush();
        if (r.verse_key !== curKey) {
          words = [];
          verses.push([r.verse_key, words]);
          curKey = r.verse_key;
        }
        cur = {
          pos: r.word_position, whole: "", form: "", text: "", lemmas: [], roots: [], rootsBw: [], posKeys: [], prefixes: [], verb: null,
          derivations: [], verbForms: [], suffixes: [], noun: null,
        };
        formText = "";
        leading = true;
      }
      const seg = r.form_arabic ?? "";
      const tag = r.tag ?? "";
      cur.text += seg;
      if (r.segment_type === "PREFIX") {
        if (tag) add(cur.prefixes, lc(tag));
        if (r.prefix_type) add(cur.prefixes, lc(r.prefix_type));
        const lt = /PREFIX\|([A-Za-z]):([A-Z]+)\+/.exec(r.raw_features ?? "");
        if (lt) add(cur.prefixes, lc(`${lt[1]}:${lt[2]}`));
        if (CONNECTIVE.has(tag)) {
          add(cur.prefixes, "connective");
          if (leading) continue;
        }
      }
      leading = false;
      formText += seg;
      if (r.segment_type === "SUFFIX") {
        const pron = /PRON:([0-9A-Z]+)/.exec(r.raw_features ?? "")?.[1];
        if (pron) add(cur.suffixes, pron);
        continue;
      }
      if (r.segment_type !== "STEM") continue;
      const derived = r.derivation ? DERIVATION_OF[r.derivation] : undefined;
      if (derived) add(cur.derivations, derived);
      const vf = /^\(?([IVX]+)\)?$/.exec(r.verb_form ?? "")?.[1];
      if (vf) add(cur.verbForms, vf);
      else if (tag === "V" || derived) add(cur.verbForms, "I");   // the corpus writes no form for form I
      if ((tag === "N" || tag === "ADJ") && !cur.noun) {
        // the corpus leaves the singular unmarked: a gender and no number is a singular
        cur.noun = { number: r.number ?? (r.gender ? "S" : null), gender: r.gender };
      }
      if (r.lemma_arabic) add(cur.lemmas, foldArabic(r.lemma_arabic));
      if (r.root_arabic) add(cur.roots, foldRoot(r.root_arabic));
      if (r.root_buckwalter) add(cur.rootsBw, r.root_buckwalter);
      if (tag) {
        add(cur.posKeys, lc(tag));
        if (POS_TAGS[tag]) add(cur.posKeys, lc(POS_TAGS[tag]));
      }
      if (r.pos_class) add(cur.posKeys, lc(r.pos_class));
      if (tag === "V" && !cur.verb) {
        // the mood lives only in raw_features (MOOD:SUBJ / MOOD:JUS); an imperfect without one
        // is indicative. The voice column marks only the passive.
        const mood = /MOOD:([A-Z]+)/.exec(r.raw_features ?? "")?.[1] ?? (r.verb_aspect === "IMPF" ? "IND" : null);
        cur.verb = {
          aspect: r.verb_aspect, mood, voice: r.verb_voice === "PASS" ? "PASS" : "ACT",
          person: r.person, number: r.number, gender: r.gender,
        };
      }
    }
    flush();
    this.verses = verses;
  }

  /** Every match of the query in the Book, in mushaf order: [verse_key, start, length]. */
  private find(q: ConstructionQuery): { verseKey: string; words: Word[]; i: number; j: number }[] {
    const slots: Compiled[] = q.slots.map((s, i) => ({ match: compileSlot(s), gap: i === 0 ? 0 : Math.max(0, s.gap ?? 0) }));
    const out: { verseKey: string; words: Word[]; i: number; j: number }[] = [];
    // the last word index of a match of slots k.. starting after word index `prev`, or -1
    const rest = (words: Word[], k: number, prev: number): number => {
      if (k === slots.length) return prev;
      const { match, gap } = slots[k]!;
      for (let j = prev + 1; j <= prev + 1 + gap && j < words.length; j++) {
        if (!match(words[j]!)) continue;
        const end = rest(words, k + 1, j);
        if (end >= 0) return end;
      }
      return -1;
    };
    for (const [verseKey, words] of this.verses) {
      const starts = q.atStart ? Math.min(1, words.length) : words.length;
      for (let i = 0; i < starts; i++) {
        if (!slots[0]!.match(words[i]!)) continue;
        const j = rest(words, 1, i);
        if (j >= 0) out.push({ verseKey, words, i, j });
      }
    }
    return out;
  }

  /** Every match in the Book, in Book order, with the matched words as written. */
  async every(q: ConstructionQuery): Promise<{ verseKey: string; start: number; length: number; match: string }[]> {
    await this.build();
    return this.find(q).map(({ verseKey, words, i, j }) => ({
      verseKey,
      start: words[i]!.pos,
      length: words[j]!.pos - words[i]!.pos + 1,
      match: words.slice(i, j + 1).map((w) => w.text).join(" "),
    }));
  }

  async search(q: ConstructionSearch): Promise<ConstructionResult> {
    await this.build();
    const all = this.find(q);
    const offset = Math.max(0, Math.trunc(q.offset ?? 0));
    const limit = Math.min(500, Math.max(1, Math.trunc(q.limit ?? 50)));
    const page = all.slice(offset, offset + limit);
    const keys = [...new Set(page.map((h) => h.verseKey))];
    const texts = new Map<string, string>();
    if (keys.length) {
      const rows = await this.db.query<{ verse_key: string; text_uthmani: string | null }>(
        `SELECT verse_key, text_uthmani FROM verses WHERE verse_key IN (${keys.map(() => "?").join(", ")})`, keys);
      for (const r of rows) texts.set(r.verse_key, r.text_uthmani ?? "");
    }
    return {
      total: all.length,
      ayahs: new Set(all.map((h) => h.verseKey)).size,
      hits: page.map(({ verseKey, words, i, j }) => ({
        verse_key: verseKey,
        start: words[i]!.pos,
        length: words[j]!.pos - words[i]!.pos + 1,
        text: texts.get(verseKey) ?? "",
        match: words.slice(i, j + 1).map((w) => w.text).join(" "),
      })),
    };
  }
}
