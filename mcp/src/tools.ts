// The tool surface. Two layers, as chosen:
//   • composed, research-shaped tools that answer a whole study question in one
//     call (study_root, read_ayah, …) — fewer round-trips, less wasted context
//   • thin escape hatches mirroring single endpoints, for anything specific
//
// Corpus tools are strictly read-only. Translations are deliberately NOT exposed:
// the method builds meaning from Arabic, morphology and the lexicons, never from
// a translator's rendering.

import { z } from "zod";
import type { AppState } from "../../server/src/state.js";
import { waznForWord } from "../../server/src/wazn.js";
import { expressionSearch } from "../../server/src/expressions.js";
import { foldArabic, buckToArabic } from "../../server/src/text/normalize.js";
import { AI_SOURCE, guard, proposalId, WriteRefused } from "./core.js";
import {
  caseSummary, expectVersion, findOwnItem, mustGetCase, placeItem, saveGuarded,
} from "./cases.js";

// Resolve a caller-supplied form against a root's actual derived forms.
//
// A refinement must key to the corpus's EXACT spelling (that is what the reader's
// app matches on, harakat and all), but a model rarely reproduces the vocalisation
// byte-for-byte — e.g. it offers نَذْر for the vow when the corpus writes نَّذْر.
// So: exact match first; then a diacritic-insensitive match, but ONLY when it is
// unambiguous — because different forms can share one consonantal skeleton (نذر is
// the verb نَذَرْ, the vow-noun نَّذْر AND the noun نُذْر). When several forms collapse
// together we refuse to guess and hand back the real spellings to choose from,
// instead of silently attaching to the wrong one — or bouncing with no way forward.
export interface FormRef { form: string; pos: string | null; occurrences: number }
export type FormMatch =
  | { form: string }
  | { ambiguous: FormRef[] }
  | { unknown: true };

export function makeFormResolver(forms: FormRef[]): (input: string) => FormMatch {
  // The input may be Arabic OR Buckwalter, voweled or bare. buckToArabic maps Buckwalter to
  // Arabic and passes Arabic through untouched, so one conversion normalises both scripts;
  // everything downstream then works in Arabic exactly as before. This is what lets an AI
  // submit `hdY`/`Slb`-style Buckwalter — folded to the same skeleton as هُدًى/صلب — instead of
  // having to reproduce the exact harakat, which Buckwalter encodes just as strictly as Arabic.
  const toArabic = (s: string) => buckToArabic((s ?? "").normalize("NFC")).normalize("NFC");
  const exact = new Map(forms.map((f) => [f.form.normalize("NFC"), f]));
  const byFold = new Map<string, FormRef[]>();
  for (const f of forms) {
    const k = foldArabic(f.form);
    (byFold.get(k) ?? byFold.set(k, []).get(k)!).push(f);
  }
  return (input: string): FormMatch => {
    const nfc = toArabic(input);
    const hit = exact.get(nfc);
    if (hit) return { form: hit.form };
    const cands = byFold.get(foldArabic(nfc)) ?? [];
    // collapse candidates that are the SAME spelling (POS-homographs like رَّحِيم
    // Adjective + Noun): there is nothing to disambiguate, they save to one lemma.
    // Only DIFFERENT spellings sharing a skeleton (نَذَرْ / نَّذْر / نُذْر) are ambiguous.
    const distinct = [...new Map(cands.map((c) => [c.form.normalize("NFC"), c])).values()];
    if (distinct.length === 1) return { form: distinct[0]!.form };
    if (distinct.length > 1) return { ambiguous: distinct };
    return { unknown: true };
  };
}

const SCRIPT = z
  .enum(["uthmani", "uthmani_simple", "imlaei", "imlaei_simple", "indopak"])
  .default("uthmani")
  .describe("Arabic script. Default uthmani (what the reader reads); *_simple is easier to match on.");

const spaced = (r: string) => r.split("").join(" ");

// The stores return loose Record<string, unknown> rows (a legacy of the 1:1
// Python port). Read them through these shapes at the boundary so the tools stay
// type-safe without touching the server's public API.
interface RootRow {
  root_arabic: string;
  root_buckwalter: string;
  letters_arabic: string | null;
  meaning_en: string | null;
  total_occurrences: number;
  forms: { lemma_arabic: string | null; lemma_buckwalter: string | null; pos_english: string | null; occurrence_count: number }[];
  meanings: { source: string; language: string; meaning: string }[];
}
interface OccRow {
  verse_key: string;
  word_position: number;
  form_arabic: string | null;
  lemma_arabic: string | null;
  verse_text: string | null;
}
const getRoot = (s: AppState, r: string) => s.roots.getRoot(r) as RootRow | null;
const rootOccurrences = (s: AppState, bw: string, limit: number) =>
  s.roots.occurrences(bw, { script: "uthmani", limit }) as unknown as OccRow[];


/** Lexicon text carries editorial apparatus that only burns context. */
const tidy = (s: string) =>
  (s || "")
    .replace(/\[\[[\s\S]*?\]\]/g, " ")
    .replace(/\s*\|\s*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

export interface Tool {
  name: string;
  title: string;
  description: string;
  schema: z.ZodRawShape;
  /** true for the two write tools, so the client can flag them */
  writes?: boolean;
  run: (state: AppState, args: any) => unknown;
}

// ---------------------------------------------------------------- composed ----

const study_root: Tool = {
  name: "study_root",
  title: "Study a root",
  description:
    "Everything needed to reason about one root in a single call: its derived forms with " +
    "part of speech and frequency, every classical lexicon entry, the reader's own " +
    "indications (with per-form refinements), the roots it keeps company with, and sample " +
    "occurrences. Prefer this over several small calls.",
  schema: {
    root: z.string().describe("Root in Arabic (فلح) or buckwalter (flH)."),
    occurrences: z.number().int().min(0).max(50).default(8)
      .describe("How many sample occurrences to include."),
  },
  run: (state, { root, occurrences }) => {
    const d = getRoot(state, root);
    if (!d) return { error: `root not found: ${root}` };
    const bw = d.root_buckwalter;
    const ind = state.research.indicationsForWord(null, d.root_arabic);
    return {
      root: d.root_arabic,
      root_buckwalter: bw,
      letters: d.letters_arabic,
      total_occurrences: d.total_occurrences,
      corpus_gloss: d.meaning_en,
      note: "corpus_gloss is a raw unranked word-list, not an authority — weigh the lexicon entries.",
      // one row per (spelling, part of speech) — do NOT dedupe by spelling alone:
      // a spelling can be two forms (e.g. رَّحِيم Adjective ×112 AND Noun ×4), and
      // collapsing them dropped one row's count entirely. Keep them attributable.
      // form_buckwalter is a stable ASCII copy of the exact spelling — submit forms with it
      // (or the Arabic) rather than typing the Arabic from memory, which drifts from the mushaf.
      forms: (d.forms ?? []).map((f) => ({
        form: f.lemma_arabic,
        form_buckwalter: f.lemma_buckwalter,
        pos: f.pos_english,
        occurrences: f.occurrence_count,
      })),
      lexicons: (d.meanings ?? []).map((m) => ({
        source: m.source,
        language: m.language,
        entry: tidy(m.meaning),
      })),
      my_indications: (ind.rootIndications ?? []).map((s: any) => ({
        id: s.id,
        label: s.label,
        meaning: s.meaning,
        is_primary: s.primary,
        proposed_by: s.source,
        refined_forms: s.refinedCount,
      })),
      keeps_company_with: state.linkages
        .coOccurringRoots(bw, { scope: "ayah", limit: 10, sortBy: "count" })
        .map((l) => ({ root: l.root_arabic, together_in_ayat: l.cooccur })),
      sample_occurrences: occurrences
        ? rootOccurrences(state, bw, occurrences).map((o) => ({
            verse_key: o.verse_key,
            form: o.form_arabic,
            text: o.verse_text,
          }))
        : [],
    };
  },
};

const read_ayah: Tool = {
  name: "read_ayah",
  title: "Read an āyah word by word",
  description:
    "One āyah with its Arabic text and, for each word, its root, form (lemma) and " +
    "morphological pattern (wazn) — plus the reader's notes/questions on it, the phrases " +
    "in it that recur verbatim elsewhere, and any unusual spellings. No translation.",
  schema: {
    verse_key: z.string().describe('Chapter:verse, e.g. "2:255".'),
    script: SCRIPT,
  },
  run: (state, { verse_key, script }) => {
    const v = state.content.getVerse(verse_key, { script, withWords: true });
    if (!v) return { error: `verse not found: ${verse_key}` };
    const words = ((v.words ?? []) as any[]).map((w) => {
      const wz = waznForWord(state.quran, verse_key, w.position);
      return {
        position: w.position,
        word: w.arabic,
        root: w.root,
        form: w.lemma,
        pos: w.pos_english ?? w.pos,
        wazn: wz ? { pattern: wz.wazn, kind: wz.kind, form: wz.form, label: wz.label } : null,
      };
    });
    return {
      verse_key,
      text: v.text,
      words,
      my_notes: state.research.listNotes({ verse: verse_key }).map((n: any) => ({
        kind: n.kind, text: n.text, answer: n.answer || null,
        word_position: n.wordPosition, proposed_by: n.source,
      })),
      repeated_phrases: state.echoes.echoesForVerse(verse_key).map((e) => ({
        phrase: e.phrase,
        also_in: e.occurrences.map((o) => o.verseKey),
      })),
      unusual_spellings: state.spellings
        .chapterVariants(Number(verse_key.split(":")[0]))
        .filter((x) => x.verse_key === verse_key)
        .flatMap((x) => x.positions)
        .map((pos) => ({ word_position: pos, variants: state.spellings.variantsForWord(verse_key, pos) })),
    };
  },
};

const find_where_roots_meet: Tool = {
  name: "find_where_roots_meet",
  title: "Where two roots co-occur",
  description:
    "Every āyah in which two roots both appear — the evidence behind a collocation. " +
    "Use it to test whether two ideas actually travel together in the Book.",
  schema: {
    root_a: z.string(),
    root_b: z.string(),
    script: SCRIPT,
    limit: z.number().int().min(1).max(300).default(50),
  },
  run: (state, { root_a, root_b, script, limit }) => {
    const a = getRoot(state, root_a);
    const b = getRoot(state, root_b);
    if (!a) return { error: `root not found: ${root_a}` };
    if (!b) return { error: `root not found: ${root_b}` };
    const rows = state.linkages.sharedVerses(a.root_buckwalter, b.root_buckwalter, script, limit);
    return {
      roots: [a.root_arabic, b.root_arabic],
      together_in: rows.length,
      ayat: rows.map((r) => ({ verse_key: r.verse_key, text: r.text })),
    };
  },
};

const trace_word: Tool = {
  name: "trace_word",
  title: "Trace a word or root through the Book",
  description:
    "Walk every occurrence of either an exact written word (rasm — works for particles and " +
    "names with no root) or a whole root family. Use exact=true to follow one spelling. " +
    "Read `total` for the true frequency rather than counting the returned list, and in " +
    "exact mode read `also_written`: matching is on the WHOLE written word, so a prefixed " +
    "spelling (ٱلصَّلَوٰة) is a different form from the bare one (صلوٰة).",
  schema: {
    word: z.string().describe("An Arabic word (exact=true) or a root (exact=false)."),
    exact: z.boolean().default(false)
      .describe("true = only this written spelling; false = the root's whole family."),
    limit: z.number().int().min(1).max(300).default(60),
  },
  run: (state, { word, exact, limit }) => {
    if (exact) {
      // The index keys on the WHOLE written word, so ٱلصَّلَوٰةَ is a different rasm from
      // صلوٰة. Reporting only the bare form would say "2 occurrences" while 65 sit inside
      // prefixed spellings — so return the total, and name the related forms explicitly.
      const total = state.wordForms.total(word);
      const hits = state.wordForms.occurrences(word, limit);
      const texts = new Map<string, string | null>();
      const textOf = (vk: string) => {
        if (!texts.has(vk)) {
          const v = state.content.getVerse(vk, { script: "uthmani" });
          texts.set(vk, (v?.text as string) ?? null);
        }
        return texts.get(vk) ?? null;
      };
      const related = state.wordForms.relatedForms(word);
      const relatedTotal = related.reduce((s, r) => s + r.count, 0);
      return {
        following: word,
        mode: "exact written word",
        total,
        returned: hits.length,
        truncated: hits.length < total,
        occurrences: hits.map((h) => ({
          verse_key: h.verse_key,
          word_position: h.word_position,
          word: h.surface,
          text: textOf(h.verse_key),
        })),
        also_written: related,
        note: related.length
          ? `This is the BARE spelling: ${total} occurrence(s). The same letters also occur ` +
            `inside ${relatedTotal} other word(s) carrying ٱل / و / بِ or a pronoun suffix ` +
            `(see also_written) — trace one of those, or use exact=false for the whole root family.`
          : undefined,
      };
    }
    const d = getRoot(state, word);
    if (!d) return { error: `root not found: ${word} (for an exact word, pass exact=true)` };
    // count first, then page: `count` used to be the returned length, so a small limit
    // made a 99-occurrence root look like it had 5
    const all = rootOccurrences(state, d.root_buckwalter, 3000);
    const occ = all.slice(0, limit);
    return {
      following: d.root_arabic,
      mode: "root family",
      total: all.length,
      returned: occ.length,
      truncated: occ.length < all.length,
      occurrences: occ.map((o) => ({
        verse_key: o.verse_key,
        form: o.form_arabic,
        text: o.verse_text,
      })),
    };
  },
};

const search_quran: Tool = {
  name: "search_quran",
  title: "Search the Book",
  description:
    "Find āyāt three ways: phrase (exact Arabic wording), related (free-text — resolves your " +
    "words to roots and ranks by shared roots and structure), or expression (several words " +
    "that must co-occur, matched by root).",
  schema: {
    query: z.string().describe("Arabic phrase, or words to resolve."),
    mode: z.enum(["phrase", "related", "expression"]).default("related"),
    limit: z.number().int().min(1).max(100).default(20),
    script: SCRIPT,
  },
  run: (state, { query, mode, limit, script }) => {
    if (mode === "phrase") {
      return { mode, matches: state.content.phraseSearch(query, { script, limit }) };
    }
    if (mode === "expression") {
      const terms: { surface: string; rootBuckwalter: string | null }[] = String(query)
        .split(/\s+/)
        .filter(Boolean)
        .map((surface: string) => ({ surface, rootBuckwalter: null }));
      return {
        mode,
        terms: terms.map((t) => t.surface),
        matches: expressionSearch(state.quran, terms, "roots", limit),
      };
    }
    const r = state.freetext.search(query, { topK: limit });
    return {
      mode,
      resolved: r.resolved,
      unresolved: r.unresolved,
      matches: r.matches.map((m) => ({
        verse_key: m.verse_key, text: m.text, score: m.score, shared_roots: m.shared,
      })),
    };
  },
};

const compare_forms: Tool = {
  name: "compare_forms",
  title: "Compare a root's forms side by side",
  description:
    "A root's occurrences grouped by derived form, so you can see how the sense shifts " +
    "from one form to another — the core exercise of this method.",
  schema: {
    root: z.string(),
    per_form: z.number().int().min(1).max(20).default(5).describe("Sample āyāt per form."),
  },
  run: (state, { root, per_form }) => {
    const d = getRoot(state, root);
    if (!d) return { error: `root not found: ${root}` };
    const occ = rootOccurrences(state, d.root_buckwalter, 3000);
    const groups = new Map<string, { verse_key: string; text: string | null }[]>();
    for (const o of occ) {
      const form = o.lemma_arabic ?? "—";
      const arr = groups.get(form) ?? [];
      if (arr.length < per_form) arr.push({ verse_key: o.verse_key, text: o.verse_text });
      groups.set(form, arr);
    }
    const pos = new Map((d.forms ?? []).map((f) => [f.lemma_arabic, f.pos_english]));
    const bw = new Map((d.forms ?? []).map((f) => [f.lemma_arabic, f.lemma_buckwalter]));
    return {
      root: d.root_arabic,
      forms: [...groups.entries()].map(([form, ayat]) => ({
        form, form_buckwalter: bw.get(form) ?? null, pos: pos.get(form) ?? null, samples: ayat,
      })),
    };
  },
};

const my_research_on: Tool = {
  name: "my_research_on",
  title: "What the reader has already established",
  description:
    "The reader's own work touching a root or an āyah: indications with per-form refinements, " +
    "notes and open questions, and any cases. Read this before proposing anything, so you " +
    "build on their thinking instead of repeating it.",
  schema: {
    root: z.string().optional(),
    verse_key: z.string().optional(),
  },
  run: (state, { root, verse_key }) => {
    if (!root && !verse_key) return { error: "pass root or verse_key" };
    const out: Record<string, unknown> = {};
    if (root) {
      const d = getRoot(state, root);
      const ar = d?.root_arabic ?? root;
      const ind = state.research.indicationsForWord(null, ar);
      out.root = ar;
      out.indications = (ind.rootIndications ?? []).map((s: any) => ({
        id: s.id, label: s.label, meaning: s.meaning, is_primary: s.primary, proposed_by: s.source,
        refinements: state.research.refinementsForParent(s.id).map((r: any) => ({
          form: r.lemma, label: r.label, meaning: r.meaning, proposed_by: r.source,
        })),
      }));
      out.notes = state.research.listNotes({ root: ar });
      out.my_root_meaning = state.research.getRootMeaning(d?.root_buckwalter ?? root);
      out.cases = (state.research.listCases() as any[])
        .filter((c) => c.subject?.value === ar)
        .map((c) => caseSummary(c));
    }
    if (verse_key) {
      out.verse_key = verse_key;
      out.notes_on_ayah = state.research.listNotes({ verse: verse_key });
    }
    out.open_questions = state.research
      .listNotes(root ? { root } : { verse: verse_key })
      .filter((n: any) => n.kind === "question" && !n.resolved)
      .map((n: any) => n.text);
    return out;
  },
};

// -------------------------------------------------------------------- thin ----

const thin: Tool[] = [
  {
    name: "get_root", title: "Root record", description: "Raw root record: forms and lexicon entries.",
    schema: { root: z.string() },
    run: (s, { root }) => getRoot(s, root) ?? { error: `root not found: ${root}` },
  },
  {
    name: "list_roots", title: "List roots",
    description: "Browse roots by frequency or alphabetically — e.g. to find rare roots.",
    schema: {
      order_by: z.enum(["count", "alpha"]).default("count"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
    run: (s, a) => s.roots.listRoots({ orderBy: a.order_by === "alpha" ? "root" : "count", limit: a.limit, offset: a.offset }),
  },
  {
    name: "get_verses", title: "Verses of a chapter",
    description: "A range of āyāt from one chapter (Arabic only).",
    schema: {
      chapter: z.number().int().min(1).max(114),
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
      script: SCRIPT,
    },
    run: (s, a) => s.content.chapterVerses(a.chapter, { script: a.script, limit: a.limit, offset: a.offset }),
  },
  {
    name: "get_linkages", title: "Collocations of a root",
    description: "Roots that co-occur with this one, ranked.",
    schema: {
      root: z.string(),
      scope: z.enum(["ayah", "adjacent"]).default("ayah"),
      limit: z.number().int().min(1).max(100).default(20),
    },
    run: (s, a) => s.linkages.coOccurringRoots(a.root, { scope: a.scope, limit: a.limit }),
  },
  {
    name: "get_echoes", title: "Repeated phrases in an āyah",
    description: "Phrases in this āyah that recur verbatim elsewhere.",
    schema: { verse_key: z.string() },
    run: (s, { verse_key }) => s.echoes.echoesForVerse(verse_key),
  },
  {
    name: "get_wazn", title: "Morphological pattern of a word",
    description: "The صرف pattern of one word: form I–XII, participle, masdar, aspect, voice.",
    schema: { verse_key: z.string(), word_position: z.number().int().min(1) },
    run: (s, { verse_key, word_position }) => waznForWord(s.quran, verse_key, word_position) ?? { error: "no morphology for that word" },
  },
  {
    name: "get_spelling_variants", title: "Rasm variants of a word",
    description: "The distinct ways this word is written across the mushaf.",
    schema: { verse_key: z.string(), word_position: z.number().int().min(1) },
    run: (s, { verse_key, word_position }) => s.spellings.variantsForWord(verse_key, word_position),
  },
  {
    name: "get_similar_ayat", title: "Āyāt similar to this one",
    description: "Composite similarity: shared roots, phrase runs and structure.",
    schema: { verse_key: z.string(), limit: z.number().int().min(1).max(50).default(10) },
    run: (s, { verse_key, limit }) => s.engine.similarVerses(verse_key, { topK: limit }),
  },
];

// ------------------------------------------------------------------ writes ----

const add_note: Tool = {
  name: "add_note",
  title: "Add a note or question (proposal)",
  description:
    "Record an observation or an open question on an āyah, or on one word in it. Saved as a " +
    "PROPOSAL tagged as AI-authored for the reader to review — it never overwrites their work.",
  writes: true,
  schema: {
    verse_key: z.string().describe('Chapter:verse, e.g. "2:255".'),
    text: z.string().describe("The note, in plain language."),
    kind: z.enum(["note", "question"]).default("note"),
    word_position: z.number().int().min(1).optional().describe("Attach to one word, not the whole āyah."),
  },
  run: (state, a) => {
    const verseKey = guard.verseKey(a.verse_key);
    const text = guard.requireText(a.text, "text");
    const id = proposalId("note");
    guard.mustNotExist(state, "note", id);
    // carry the word's form/root so the note cross-references properly
    let lemma: string | null = null;
    let root: string | null = null;
    if (a.word_position) {
      const w = (state.content.verseWords(verseKey) as any[]).find((x) => x.position === a.word_position);
      lemma = w?.lemma ?? null;
      root = w?.root ?? null;
    }
    const saved = state.research.saveNote({
      id, verseKey, wordPosition: a.word_position ?? null, kind: a.kind,
      text, lemma, root, source: AI_SOURCE,
    });
    return { proposed: true, id: saved.id, awaiting_review: true };
  },
};

const propose_indication: Tool = {
  name: "propose_indication",
  title: "Propose an indication for a root (proposal)",
  description:
    "Propose a meaning ('indication') for a ROOT, optionally with a per-form refinement for " +
    "each derived form. Saved as a PROPOSAL tagged as AI-authored. It will NOT become the " +
    "reader's default gloss — only they can make an indication primary.",
  writes: true,
  schema: {
    root: z.string().describe("The root, Arabic or buckwalter."),
    label: z.string().describe("Short label, 2–5 words."),
    meaning: z.string().default("").describe("The root's meaning in this indication, 1–3 sentences."),
    refinements: z
      .array(z.object({
        form: z.string().describe(
          "The derived form (lemma), in Arabic (هُدًى) or Buckwalter (hudFY, or the bare hdY). " +
          "Copy it from study_root/compare_forms. Harakat need not match — the form is folded to " +
          "its skeleton — but forms that share a skeleton (the verb نَذَرْ vs the noun نَّذْر) must " +
          "be distinguished by giving the vowels, in either script.",
        ),
        label: z.string(),
        meaning: z.string().default(""),
      }))
      .default([])
      .describe("How each form specialises the indication."),
  },
  run: (state, a) => {
    const d = getRoot(state, a.root);
    if (!d) return { error: `root not found: ${a.root}` };
    const label = guard.requireText(a.label, "label");
    const id = proposalId("ind");
    guard.mustNotExist(state, "indication", id);

    const formRefs: FormRef[] = (d.forms ?? [])
      .filter((f) => f.lemma_arabic)
      .map((f) => ({ form: f.lemma_arabic as string, pos: f.pos_english, occurrences: f.occurrence_count }));
    const resolveForm = makeFormResolver(formRefs);
    const saved = state.research.saveIndication(
      guard.sanitiseIndication({ id, root: d.root_arabic, lemma: null, scope: "root", label, meaning: a.meaning ?? "" }),
    );

    const refined: unknown[] = [];
    const rejected: unknown[] = [];
    for (const r of a.refinements ?? []) {
      const m = resolveForm(r.form);
      if ("ambiguous" in m) {
        rejected.push({
          form: r.form,
          why: "several forms of this root share these letters — resend with one of the exact spellings below",
          candidates: m.ambiguous,
        });
        continue;
      }
      if ("unknown" in m) {
        rejected.push({ form: r.form, why: "not a form of this root", known_forms: formRefs.map((f) => f.form) });
        continue;
      }
      const out = state.research.saveRefinement(
        guard.sanitiseIndication({
          id: proposalId("ref"), parentId: saved.id, lemma: m.form,
          label: r.label ?? "", meaning: r.meaning ?? "",
        }),
      );
      // echo the exact spelling we attached to, which may differ from the input
      refined.push({ form: m.form, requested: r.form, id: (out as any)?.id });
    }
    return {
      proposed: true,
      id: saved.id,
      root: d.root_arabic,
      refinements: refined,
      rejected_refinements: rejected,
      awaiting_review: true,
      is_primary: false,
      note: "The reader decides whether this becomes the default gloss.",
    };
  },
};

// ------------------------------------------------------- the Investigate board ----
// Read + create + write, inside the reader's boundary: add freely, change only your
// own items, and never write a conclusion (verdict / status / established meaning) —
// those go into `proposals` for the reader to accept. See cases.ts for the guard.

const VERSION = z.number().optional().describe(
  "The case's updated_at from your last read. A whole case is rewritten on save, so " +
  "this is checked to make sure you don't overwrite an edit the reader made meanwhile. " +
  "Omit only right after you created the case.",
);

const list_cases: Tool = {
  name: "list_cases",
  title: "The reader's investigations",
  description:
    "Every case on the Investigate board: subject, status, how much evidence is on it, " +
    "which forms are established, and what is awaiting the reader's review.",
  schema: {
    subject: z.string().optional().describe("Filter by root, phrase or verse key."),
    status: z.enum(["open", "partial", "closed", "any"]).default("any"),
  },
  run: (state, a) => {
    const all = (state.research.listCases() as any[]).map((c) => caseSummary(c));
    return all.filter((c: any) =>
      (a.status === "any" || c.status === a.status) &&
      (!a.subject || c.subject?.value === a.subject || c.title?.includes(a.subject)));
  },
};

const read_case: Tool = {
  name: "read_case",
  title: "Read one case in full",
  description:
    "The whole board for one case: every evidence āyah, slip, link and group, each marked " +
    "with who added it. Read this before writing, and keep `updated_at` for your next write.",
  schema: { case_id: z.string() },
  run: (state, { case_id }) => caseSummary(mustGetCase(state, case_id), { full: true }),
};

const open_case: Tool = {
  name: "open_case",
  title: "Open a new case (writes)",
  description:
    "Start an investigation on a root, a phrase, or an āyah. Use list_cases first — if one " +
    "already exists for this subject, add to that instead of opening a duplicate.",
  writes: true,
  schema: {
    subject_type: z.enum(["root", "phrase", "ayah"]),
    subject: z.string().describe("The root (Arabic), the phrase text, or a verse key."),
    title: z.string().describe("A short title for the investigation."),
    description: z.string().default("").describe("The question this case is meant to settle."),
  },
  run: (state, a) => {
    const subject = a.subject_type === "root"
      ? (getRoot(state, a.subject)?.root_arabic ?? a.subject)
      : a.subject;
    const now = Date.now();
    const saved = state.research.saveCase({
      id: proposalId("case"),
      subject: { type: a.subject_type, value: subject },
      title: guard.requireText(a.title, "title"),
      description: a.description ?? "",
      cards: [], slips: [], threads: [], clusters: [], formResearch: {},
      verdict: "", status: "open", createdAt: now, updatedAt: now,
      source: AI_SOURCE,
    }) as any;
    return { created: true, case_id: saved.id, updated_at: saved.updatedAt, subject };
  },
};

const add_evidence: Tool = {
  name: "add_evidence",
  title: "Pin āyāt to a case (writes)",
  description:
    "Add āyāt as evidence cards. Optionally anchor a card to one word. Cards are placed on " +
    "the board for you. Duplicates of an āyah already on the board are skipped.",
  writes: true,
  schema: {
    case_id: z.string(),
    ayat: z.array(z.object({
      verse_key: z.string(),
      word_position: z.number().int().min(1).optional(),
    })).min(1).max(40),
    expect_version: VERSION,
  },
  run: (state, a) => {
    const c = mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const next = { ...c, cards: [...(c.cards ?? [])] };
    const added: unknown[] = [];
    const skipped: unknown[] = [];
    for (const item of a.ayat) {
      const vk = guard.verseKey(item.verse_key);
      if (!state.content.getVerse(vk, { script: "uthmani" })) {
        skipped.push({ verse_key: vk, why: "no such āyah" });
        continue;
      }
      if (next.cards.some((k: any) => k.verseKey === vk && (k.wordPosition ?? null) === (item.word_position ?? null))) {
        skipped.push({ verse_key: vk, why: "already on the board" });
        continue;
      }
      const at = placeItem(next);
      const card = {
        id: proposalId("card"), verseKey: vk, wordPosition: item.word_position ?? null,
        ...at, source: AI_SOURCE,
      };
      next.cards.push(card);
      added.push({ id: card.id, verse_key: vk });
    }
    const saved = saveGuarded(state, c, next);
    return { added, skipped, updated_at: saved.updatedAt };
  },
};

const add_slip: Tool = {
  name: "add_slip",
  title: "Add an observation or a citation to a case (writes)",
  description:
    "Put your own reasoning on the board as a comment slip, or a cited source as a reference " +
    "slip (with source + locator). Attach it to one derived form, or to the root itself.",
  writes: true,
  schema: {
    case_id: z.string(),
    kind: z.enum(["comment", "reference"]).default("comment"),
    text: z.string().describe("The observation, or what the source says."),
    form: z.string().nullable().default(null).describe("The lemma this concerns, or null for the root."),
    source: z.string().default("").describe("Reference slips: e.g. \"Lisān al-ʿArab\"."),
    locator: z.string().default("").describe("Reference slips: e.g. \"under ر-ح-م\", \"vol 8 p. 2925\"."),
    expect_version: VERSION,
  },
  run: (state, a) => {
    const c = mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const text = guard.requireText(a.text, "text");
    if (a.kind === "reference" && !String(a.source ?? "").trim()) {
      throw new WriteRefused("A reference slip needs `source` — say which lexicon or work it comes from.");
    }
    const next = { ...c, slips: [...(c.slips ?? [])] };
    const at = placeItem(next);
    const slip = {
      id: proposalId("slip"), kind: a.kind, form: a.form ?? null, text,
      source: a.source || undefined, locator: a.locator || undefined,
      ...at, author: AI_SOURCE,
    };
    next.slips.push(slip);
    const saved = saveGuarded(state, c, next);
    return { added: slip.id, updated_at: saved.updatedAt };
  },
};

const link_evidence: Tool = {
  name: "link_evidence",
  title: "Link two items on a case (writes)",
  description:
    "Draw a labelled thread between two cards or slips — the relationship you are claiming " +
    "between them (e.g. \"same construction\", \"contrast\"). Both ids must be on this case.",
  writes: true,
  schema: {
    case_id: z.string(),
    from_id: z.string(),
    to_id: z.string(),
    label: z.string().describe("What the link asserts, in a few words."),
    expect_version: VERSION,
  },
  run: (state, a) => {
    const c = mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const ids = new Set([...(c.cards ?? []), ...(c.slips ?? [])].map((i: any) => i.id));
    for (const id of [a.from_id, a.to_id]) {
      if (!ids.has(id)) throw new WriteRefused(`${id} is not a card or slip on this case.`);
    }
    const thread = {
      id: proposalId("th"), fromCardId: a.from_id, toCardId: a.to_id,
      label: guard.requireText(a.label, "label"),
      source: "suggested" as const, accepted: false, author: AI_SOURCE,
    };
    const saved = saveGuarded(state, c, { ...c, threads: [...(c.threads ?? []), thread] });
    return { added: thread.id, updated_at: saved.updatedAt, note: "Offered as a suggested thread; the reader accepts it to make it ink." };
  },
};

const group_evidence: Tool = {
  name: "group_evidence",
  title: "Group items on a case (writes)",
  description:
    "Gather cards/slips into a named cluster — your proposed grouping of the evidence " +
    "(e.g. \"physical sense\", \"used of rain\").",
  writes: true,
  schema: {
    case_id: z.string(),
    name: z.string(),
    item_ids: z.array(z.string()).min(1),
    expect_version: VERSION,
  },
  run: (state, a) => {
    const c = mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const ids = new Set([...(c.cards ?? []), ...(c.slips ?? [])].map((i: any) => i.id));
    const missing = a.item_ids.filter((i: string) => !ids.has(i));
    if (missing.length) throw new WriteRefused(`Not on this case: ${missing.join(", ")}`);
    const cluster = {
      id: proposalId("cl"), name: guard.requireText(a.name, "name"),
      cardIds: a.item_ids, source: AI_SOURCE,
    };
    const saved = saveGuarded(state, c, { ...c, clusters: [...(c.clusters ?? []), cluster] });
    return { added: cluster.id, updated_at: saved.updatedAt };
  },
};

const revise_own_item: Tool = {
  name: "revise_own_item",
  title: "Change or remove something you added (writes)",
  description:
    "Reword or delete an item YOU put on the board — a slip's text, a thread's or cluster's " +
    "label, or remove any of your own items. The reader's own items are refused: their work " +
    "is never edited or deleted by this server.",
  writes: true,
  schema: {
    case_id: z.string(),
    item_id: z.string(),
    action: z.enum(["retext", "remove"]),
    text: z.string().default("").describe("The new text/label, for action=retext."),
    expect_version: VERSION,
  },
  run: (state, a) => {
    const c = mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const { kind } = findOwnItem(c, a.item_id); // refuses if it is the reader's
    const key = ({ card: "cards", slip: "slips", thread: "threads", cluster: "clusters" } as const)[kind];
    let next: any;
    if (a.action === "remove") {
      next = { ...c, [key]: (c[key] ?? []).filter((i: any) => i.id !== a.item_id) };
      // drop threads that pointed at a removed card/slip, so the board stays consistent
      if (kind === "card" || kind === "slip") {
        next.threads = (next.threads ?? []).filter(
          (t: any) => t.fromCardId !== a.item_id && t.toCardId !== a.item_id,
        );
        next.clusters = (next.clusters ?? []).map((g: any) => ({
          ...g, cardIds: (g.cardIds ?? []).filter((id: string) => id !== a.item_id),
        }));
      }
    } else {
      if (kind === "card") {
        throw new WriteRefused("An evidence card has no text to change — remove it instead.");
      }
      const text = guard.requireText(a.text, "text");
      next = {
        ...c,
        [key]: (c[key] ?? []).map((i: any) =>
          i.id !== a.item_id ? i
            : kind === "slip" ? { ...i, text }
            : kind === "cluster" ? { ...i, name: text }
            : { ...i, label: text }), // thread
      };
    }
    const saved = saveGuarded(state, c, next);
    return { [a.action === "remove" ? "removed" : "updated"]: a.item_id, updated_at: saved.updatedAt };
  },
};

const propose_conclusion: Tool = {
  name: "propose_conclusion",
  title: "Propose a verdict or an established meaning (proposal)",
  description:
    "State what you think the case has shown — either the case verdict, or one form's " +
    "meaning. This is PARKED for the reader: it does not set the verdict, close the case, " +
    "or mark any form established. Only the reader applies a conclusion.",
  writes: true,
  schema: {
    case_id: z.string(),
    kind: z.enum(["verdict", "form"]).default("verdict"),
    form: z.string().nullable().default(null).describe("For kind='form': the lemma. Copy it verbatim from study_root."),
    text: z.string().describe("The conclusion, stated plainly."),
    reasoning: z.string().default("").describe("The evidence it rests on."),
    suggested_status: z.enum(["open", "partial", "closed"]).optional()
      .describe("What state you think the case has reached. Advisory only."),
    expect_version: VERSION,
  },
  run: (state, a) => {
    const c = mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const text = guard.requireText(a.text, "text");
    if (a.kind === "form" && !String(a.form ?? "").trim()) {
      throw new WriteRefused("kind='form' needs `form` — which lemma the meaning is for.");
    }
    const entry = {
      id: proposalId("concl"), kind: a.kind, form: a.kind === "form" ? a.form : null,
      text, reasoning: a.reasoning ?? "", suggestedStatus: a.suggested_status,
      createdAt: Date.now(),
    };
    const entries = [...((c.proposals?.entries ?? []) as any[]), entry];
    const saved = saveGuarded(state, c, { ...c, proposals: { entries } });
    return {
      proposed: true, id: entry.id, updated_at: saved.updatedAt,
      applied: false, awaiting_review: true,
      note: "Parked for the reader. The case's verdict, status and established forms are unchanged.",
    };
  },
};

export const TOOLS: Tool[] = [
  study_root, read_ayah, find_where_roots_meet, trace_word, search_quran, compare_forms,
  my_research_on, ...thin, add_note, propose_indication,
  // the Investigate board
  list_cases, read_case, open_case, add_evidence, add_slip, link_evidence, group_evidence,
  revise_own_item, propose_conclusion,
];
