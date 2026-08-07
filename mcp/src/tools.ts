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
import { AI_SOURCE, guard, proposalId } from "./core.js";

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
  forms: { lemma_arabic: string | null; pos_english: string | null; occurrence_count: number }[];
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
      forms: [...new Map((d.forms ?? []).map((f) => [f.lemma_arabic, f])).values()].map((f) => ({
        form: f.lemma_arabic,
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
    "names with no root) or a whole root family. Use exact=true to follow one spelling.",
  schema: {
    word: z.string().describe("An Arabic word (exact=true) or a root (exact=false)."),
    exact: z.boolean().default(false)
      .describe("true = only this written spelling; false = the root's whole family."),
    limit: z.number().int().min(1).max(300).default(60),
  },
  run: (state, { word, exact, limit }) => {
    if (exact) {
      const hits = state.wordForms.occurrences(word, limit);
      return { following: word, mode: "exact written word", count: hits.length, occurrences: hits };
    }
    const d = getRoot(state, word);
    if (!d) return { error: `root not found: ${word} (for an exact word, pass exact=true)` };
    const occ = rootOccurrences(state, d.root_buckwalter, limit);
    return {
      following: d.root_arabic,
      mode: "root family",
      count: occ.length,
      occurrences: occ.map((o) => ({ verse_key: o.verse_key, form: o.form_arabic, text: o.verse_text })),
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
    return {
      root: d.root_arabic,
      forms: [...groups.entries()].map(([form, ayat]) => ({
        form, pos: pos.get(form) ?? null, samples: ayat,
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
        form: z.string().describe("The derived form (lemma) in Arabic."),
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

    const known = new Set((d.forms ?? []).map((f) => f.lemma_arabic));
    const saved = state.research.saveIndication(
      guard.sanitiseIndication({ id, root: d.root_arabic, lemma: null, scope: "root", label, meaning: a.meaning ?? "" }),
    );

    const refined: unknown[] = [];
    const rejected: unknown[] = [];
    for (const r of a.refinements ?? []) {
      if (!known.has(r.form)) {
        rejected.push({ form: r.form, why: "not a form of this root" });
        continue;
      }
      const out = state.research.saveRefinement(
        guard.sanitiseIndication({
          id: proposalId("ref"), parentId: saved.id, lemma: r.form,
          label: r.label ?? "", meaning: r.meaning ?? "",
        }),
      );
      refined.push({ form: r.form, id: (out as any)?.id });
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

export const TOOLS: Tool[] = [
  study_root, read_ayah, find_where_roots_meet, trace_word, search_quran, compare_forms,
  my_research_on, ...thin, add_note, propose_indication,
];
