// The tool surface. Two layers, as chosen:
//   • composed, research-shaped tools that answer a whole study question in one
//     call (study_root, read_ayah, …) — fewer round-trips, less wasted context
//   • thin escape hatches mirroring single endpoints, for anything specific
//
// Corpus tools are strictly read-only. Translations are deliberately NOT exposed:
// the method builds meaning from Arabic, morphology and the lexicons, never from
// a translator's rendering.

import { z } from "zod";
import type { McpState } from "./core.js";
import { foldArabic, buckToArabic } from "../../corpus-core/src/text/normalize.js";
import {
  CONSTRUCTION_PRESETS, ConstructionQueryError, MAX_GAP, MAX_SLOTS, parseConstructionSearch, POS_CLASSES, POS_TAGS,
  PREFIXES, presetByName, DERIVATIONS, VERB_FORMS, SUFFIXES,
} from "../../corpus-core/src/constructions.js";
import { OccurrenceRequestError, parseOccurrenceRequest } from "../../corpus-core/src/occurrences.js";
import { MAX_CHECK_WORDS } from "../../corpus-core/src/wording.js";
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

/** one value, or several of which any may match (find_construction's slots) */
const TEXT_OR_LIST = z.union([z.string(), z.array(z.string())]).optional();

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
const getRoot = async (s: McpState, r: string) => (await s.roots.getRoot(r)) as RootRow | null;
const rootOccurrences = async (s: McpState, bw: string, limit: number) =>
  (await s.roots.occurrences(bw, { script: "uthmani", limit })) as unknown as OccRow[];


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
  /** Corpus reads are async (the corpus may be a remote service), so a tool may return a promise. */
  run: (state: McpState, args: any) => unknown | Promise<unknown>;
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
  run: async (state, { root, occurrences }) => {
    const d = await getRoot(state, root);
    if (!d) return { error: `root not found: ${root}` };
    const bw = d.root_buckwalter;
    const ind = await state.research.indicationsForWord(null, d.root_arabic);
    const company = await state.linkages.coOccurringRoots(bw, { scope: "ayah", limit: 10, sortBy: "count" });
    const samples = occurrences ? await rootOccurrences(state, bw, occurrences) : [];
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
      keeps_company_with: company.map((l) => ({ root: l.root_arabic, together_in_ayat: l.cooccur })),
      sample_occurrences: samples.map((o) => ({
        verse_key: o.verse_key,
        form: o.form_arabic,
        text: o.verse_text,
      })),
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
  run: async (state, { verse_key, script }) => {
    const v = await state.content.getVerse(verse_key, { script, withWords: true });
    if (!v) return { error: `verse not found: ${verse_key}` };
    const words = await Promise.all(((v.words ?? []) as any[]).map(async (w) => {
      const wz = await state.wazn(verse_key, w.position);
      return {
        position: w.position,
        word: w.arabic,
        root: w.root,
        form: w.lemma,
        pos: w.pos_english ?? w.pos,
        wazn: wz ? { pattern: wz.wazn, kind: wz.kind, form: wz.form, label: wz.label } : null,
      };
    }));
    const echoes = await state.echoes.echoesForVerse(verse_key);
    const variantPositions = (await state.spellings.chapterVariants(Number(verse_key.split(":")[0])))
      .filter((x) => x.verse_key === verse_key)
      .flatMap((x) => x.positions);
    const unusual = await Promise.all(variantPositions.map(async (pos) =>
      ({ word_position: pos, variants: await state.spellings.variantsForWord(verse_key, pos) })));
    return {
      verse_key,
      text: v.text,
      words,
      my_notes: (await state.research.listNotes({ verse: verse_key })).map((n: any) => ({
        kind: n.kind, text: n.text, answer: n.answer || null,
        word_position: n.wordPosition, proposed_by: n.source,
      })),
      repeated_phrases: echoes.map((e) => ({
        phrase: e.phrase,
        also_in: e.occurrences.map((o) => o.verseKey),
      })),
      unusual_spellings: unusual,
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
  run: async (state, { root_a, root_b, script, limit }) => {
    const a = await getRoot(state, root_a);
    const b = await getRoot(state, root_b);
    if (!a) return { error: `root not found: ${root_a}` };
    if (!b) return { error: `root not found: ${root_b}` };
    const rows = await state.linkages.sharedVerses(a.root_buckwalter, b.root_buckwalter, script, limit);
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
  run: async (state, { word, exact, limit }) => {
    if (exact) {
      // The index keys on the WHOLE written word, so ٱلصَّلَوٰةَ is a different rasm from
      // صلوٰة. Reporting only the bare form would say "2 occurrences" while 65 sit inside
      // prefixed spellings — so return the total, and name the related forms explicitly.
      const total = await state.wordForms.total(word);
      const hits = await state.wordForms.occurrences(word, limit);
      // each distinct āyah once, all at the same time (the corpus may be across the network)
      const keys = [...new Set(hits.map((h) => h.verse_key))];
      const [related, fetched] = await Promise.all([
        state.wordForms.relatedForms(word),
        Promise.all(keys.map((vk) => state.content.getVerse(vk, { script: "uthmani" }))),
      ]);
      const texts = new Map(keys.map((vk, i) => [vk, (fetched[i]?.text as string) ?? null]));
      const relatedTotal = related.reduce((s, r) => s + r.count, 0);
      const occurrences = hits.map((h) => ({
        verse_key: h.verse_key,
        word_position: h.word_position,
        word: h.surface,
        text: texts.get(h.verse_key) ?? null,
      }));
      return {
        following: word,
        mode: "exact written word",
        total,
        returned: hits.length,
        truncated: hits.length < total,
        occurrences,
        also_written: related,
        note: related.length
          ? `This is the BARE spelling: ${total} occurrence(s). The same letters also occur ` +
            `inside ${relatedTotal} other word(s) carrying ٱل / و / بِ or a pronoun suffix ` +
            `(see also_written) — trace one of those, or use exact=false for the whole root family.`
          : undefined,
      };
    }
    const d = await getRoot(state, word);
    if (!d) return { error: `root not found: ${word} (for an exact word, pass exact=true)` };
    // count first, then page: `count` used to be the returned length, so a small limit
    // made a 99-occurrence root look like it had 5
    const all = await rootOccurrences(state, d.root_buckwalter, 3000);
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
  run: async (state, { query, mode, limit, script }) => {
    if (mode === "phrase") {
      return { mode, matches: await state.content.phraseSearch(query, { script, limit }) };
    }
    if (mode === "expression") {
      const terms: { surface: string; rootBuckwalter: string | null }[] = String(query)
        .split(/\s+/)
        .filter(Boolean)
        .map((surface: string) => ({ surface, rootBuckwalter: null }));
      return {
        mode,
        terms: terms.map((t) => t.surface),
        matches: await state.expressions(terms, "roots", limit),
      };
    }
    const r = await state.freetext.search(query, { topK: limit });
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
  run: async (state, { root, per_form }) => {
    const d = await getRoot(state, root);
    if (!d) return { error: `root not found: ${root}` };
    const occ = await rootOccurrences(state, d.root_buckwalter, 3000);
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

// a saved link / a speaker tag, as the model reads it
const linkSummary = (l: any) => ({
  id: l.id, from: l.a, to: l.b, status: l.status, kind: l.kind || null,
  shares: l.marker ? { kind: l.marker.kind, text: l.marker.text } : null,
  group: l.label || null, note: l.note || null, proposed_by: l.source,
  // a tension ("these seem to disagree") is open until the reader settles it
  ...(l.kind === "tension" ? { settled: !!l.resolved, how_settled: l.resolution || null } : {}),
});
const speechSummary = (s: any) => ({
  id: s.id, verse_key: s.verseKey, from_word: s.word, words: s.words,
  speaker: s.speaker || null, addressee: s.addressee || null, also_hears: s.listeners || null,
  speaker_is: s.basis || null, note: s.note || null, proposed_by: s.source,
});
const ruleSummary = (r: any) => ({
  id: r.id, title: r.title, rule: r.statement || null, would_be_proved_wrong_by: r.falsifier || null,
  // hand `covers` to list_occurrences to get every place the rule applies to
  covers: r.scope, marked: r.counts,
});
const mentionSummary = (m: any) => ({
  id: m.id, verse_key: m.verseKey, word: m.word, words: m.words, kind: m.kind,
  ...(m.part ? { part: m.part } : {}),
  filed_under: m.designation || null, status: m.status, note: m.note || null, proposed_by: m.source,
});

const my_links: Tool = {
  name: "my_links",
  title: "The links and leads the reader has saved",
  description:
    "The reader's saved links between places in the Book, and their leads (something noticed " +
    "whose other end is still to find), with the kind of each, its group name and note. Filter " +
    "by āyah, sūrah, status or group. Also who the reader has tagged as speaking, when you pass " +
    "an āyah or a sūrah. Read this before proposing a link, so you do not repeat one.",
  schema: {
    verse_key: z.string().optional(),
    chapter: z.number().int().min(1).max(114).optional(),
    status: z.enum(["lead", "kept"]).optional(),
    group: z.string().optional().describe("A group name the reader gave their links."),
    kind: z.string().optional().describe('Only links of one kind, e.g. "tension" for places the reader finds in disagreement.'),
  },
  run: async (state, a) => {
    const links = (await state.research.listLinks({ verse: a.verse_key, chapter: a.chapter, status: a.status, label: a.group, kind: a.kind }))
      .map(linkSummary);
    const out: Record<string, unknown> = { total: links.length, links };
    if (a.verse_key || a.chapter) {
      out.speakers = (await state.research.listSpeech({ verse: a.verse_key, chapter: a.chapter })).map(speechSummary);
    }
    return out;
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
  run: async (state, { root, verse_key }) => {
    if (!root && !verse_key) return { error: "pass root or verse_key" };
    const out: Record<string, unknown> = {};
    if (root) {
      const d = await getRoot(state, root);
      const ar = d?.root_arabic ?? root;
      const ind = await state.research.indicationsForWord(null, ar);
      out.root = ar;
      out.indications = await Promise.all((ind.rootIndications ?? []).map(async (s: any) => ({
        id: s.id, label: s.label, meaning: s.meaning, is_primary: s.primary, proposed_by: s.source,
        refinements: (await state.research.refinementsForParent(s.id)).map((r: any) => ({
          form: r.lemma, label: r.label, meaning: r.meaning, proposed_by: r.source,
        })),
      })));
      out.notes = await state.research.listNotes({ root: ar });
      out.my_root_meaning = await state.research.getRootMeaning(d?.root_buckwalter ?? root);
      out.motifs = await state.research.motifsForRoot(ar);  // the houses (بيوت) this root sits in
      out.cases = ((await state.research.listCases()) as any[])
        .filter((c) => c.subject?.value === ar)
        .map((c) => caseSummary(c));
    }
    if (verse_key) {
      out.verse_key = verse_key;
      out.notes_on_ayah = await state.research.listNotes({ verse: verse_key });
      out.links_on_ayah = (await state.research.listLinks({ verse: verse_key })).map(linkSummary);
      out.speakers_on_ayah = (await state.research.listSpeech({ verse: verse_key })).map(speechSummary);
      const mentions = (await state.research.listMentions({ verse: verse_key })) as any[];
      if (mentions.length) {
        const names = new Map(((await state.research.listCharacters()) as any[]).map((c) => [c.id, c.name]));
        out.characters_on_ayah = mentions.map((m) => ({ character: names.get(m.characterId) ?? m.characterId, ...mentionSummary(m) }));
      }
    }
    out.open_questions = (await state.research
      .listNotes(root ? { root } : { verse: verse_key }))
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
    run: async (s, { root }) => (await getRoot(s, root)) ?? { error: `root not found: ${root}` },
  },
  {
    name: "list_roots", title: "List roots",
    description: "Browse roots by frequency or alphabetically — e.g. to find rare roots.",
    schema: {
      order_by: z.enum(["count", "alpha"]).default("count"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
    // "alpha" is the explorer's own key — this used to pass "root", which it rejects, so an
    // alphabetical listing always failed
    run: (s, a) => s.roots.listRoots({ orderBy: a.order_by === "alpha" ? "alpha" : "count", descending: a.order_by !== "alpha", limit: a.limit, offset: a.offset }),
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
    name: "find_links", title: "Everything an āyah shares with the rest of the Book",
    description:
      "Every marker in this āyah that also occurs elsewhere, rarest first: repeated phrases " +
      "(three or more words), two-word pairs, written words (particles and names included), " +
      "dictionary forms and roots. `ayahs` is how many āyāt carry the marker, this one " +
      "included: 2 means it ties exactly this āyah and one other. `places` are the other " +
      "āyāt with the word position where the marker starts. Markers in more than `max_ayahs` " +
      "āyāt come back under `common`, counted only; `onlyHere` lists what occurs nowhere else. " +
      "This counts shared wording. It does not say what a link means: that is for the reader.",
    schema: { verse_key: z.string(), max_ayahs: z.number().int().min(2).max(200).default(20) },
    run: async (s, { verse_key, max_ayahs }) =>
      (await s.links.linksForVerse(verse_key, { max: max_ayahs })) ?? { error: `verse not found: ${verse_key}` },
  },
  {
    name: "list_rare_links", title: "Markers that only a few āyāt share",
    description:
      "Every marker carried by exactly `ayahs` āyāt (2 by default) across the whole Book. " +
      "kind=root: every word from the root occurs only there. kind=lemma: the word is that " +
      "rare though its root is used elsewhere. kind=form: that exact written word is that " +
      "rare though the word is used elsewhere. kind=phrase: the longest run of two or more " +
      "words only those āyāt share (longest first). Use different_surahs to keep only " +
      "markers that join different sūrahs, and chapter to keep those touching one sūrah. " +
      "Read `total` for how many there are; page with limit and offset.",
    schema: {
      kind: z.enum(["root", "lemma", "form", "phrase"]).default("lemma"),
      ayahs: z.number().int().min(2).max(5).default(2),
      different_surahs: z.boolean().default(false),
      chapter: z.number().int().min(1).max(114).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
    run: (s, a) => s.links.exclusive({
      kind: a.kind, n: a.ayahs, cross: a.different_surahs, chapter: a.chapter, limit: a.limit, offset: a.offset,
    }),
  },
  {
    name: "get_wazn", title: "Morphological pattern of a word",
    description: "The صرف pattern of one word: form I–XII, participle, masdar, aspect, voice.",
    schema: { verse_key: z.string(), word_position: z.number().int().min(1) },
    run: async (s, { verse_key, word_position }) => (await s.wazn(verse_key, word_position)) ?? { error: "no morphology for that word" },
  },
  {
    name: "find_construction", title: "Find āyāt by grammatical construction",
    description:
      "Search the whole Book by how words are BUILT: a row of 1–4 word slots, each matching one " +
      "word by any mix of written form (vowels ignored, a leading و / ف optional), lemma, root, " +
      "part of speech, a prefix it carries, and verb features. Each slot after the first comes " +
      "straight after the one before, or within `gap` words; `at_start` pins the first slot to " +
      "the āyah's first word. Or pass a ready-made `preset`: " +
      CONSTRUCTION_PRESETS.map((p) => `${p.name} (${p.label})`).join(", ") + ". " +
      "Hits are in mushaf order with the 1-based word span matched; read `total` (matches) and " +
      "`ayahs` for the true counts and page with limit/offset. This finds and counts a shared " +
      "construction. It does not say what the construction means: that is for the reader.",
    schema: {
      preset: z.enum(CONSTRUCTION_PRESETS.map((p) => p.name) as [string, ...string[]]).optional()
        .describe("A ready-made query. Give this OR slots."),
      slots: z.array(z.object({
        form: TEXT_OR_LIST.describe("The written word, e.g. إذ, سوف, أرأيت (vowels ignored)."),
        lemma: TEXT_OR_LIST.describe("The dictionary form, e.g. ٱلَّذِى (covers ٱلَّتِى, ٱلَّذِينَ)."),
        root: TEXT_OR_LIST.describe("Arabic (ر ء ي) or Buckwalter (rAy)."),
        pos: TEXT_OR_LIST.describe(`A tag (${Object.keys(POS_TAGS).join(", ")}), its name ("verb"), or a class (${POS_CLASSES.join(", ")}).`),
        prefix: TEXT_OR_LIST.describe(`A prefix the word carries: ${Object.entries(PREFIXES).map(([k, v]) => `${k} = ${v}`).join("; ")}.`),
        verb: z.object({
          aspect: z.enum(["PERF", "IMPF", "IMPV"]).optional(),
          mood: z.enum(["IND", "SUBJ", "JUS"]).optional(),
          voice: z.enum(["ACT", "PASS"]).optional(),
          person: z.enum(["1", "2", "3"]).optional(),
          number: z.enum(["S", "D", "P"]).optional(),
          gender: z.enum(["M", "F"]).optional(),
        }).optional().describe("Verb features; the word must be a verb."),
        derivation: TEXT_OR_LIST.describe(`How a noun is derived, as the corpus marks it: ${Object.entries(DERIVATIONS).map(([k, v]) => `${k} = ${v}`).join("; ")}.`),
        verbForm: TEXT_OR_LIST.describe(`The verb form of a verb or of a noun derived from one: ${VERB_FORMS.join(", ")} (the corpus marks no form for I; I is a verb or derived noun with none).`),
        suffix: TEXT_OR_LIST.describe(`A pronoun attached at the end of the word, by person, gender and number: ${Object.keys(SUFFIXES).join(", ")} ("any" = any attached pronoun).`),
        noun: z.object({
          number: z.enum(["S", "D", "P"]).optional(),
          gender: z.enum(["M", "F"]).optional(),
        }).optional().describe("A noun's or adjective's number and gender (S also takes a noun with a gender and no number: the corpus leaves the singular unmarked)."),
        gap: z.number().int().min(0).max(MAX_GAP).optional()
          .describe("Slots after the first: at most this many words between it and the slot before (0 = the next word)."),
      })).min(1).max(MAX_SLOTS).optional().describe("Your own query, in reading order. Give this OR preset."),
      at_start: z.boolean().default(false).describe("The first slot must be the āyah's first word."),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
    run: async (s, a) => {
      const preset = a.preset ? presetByName(a.preset) : undefined;
      if (a.preset && !preset) return { error: `unknown preset: ${a.preset}` };
      if (!preset && !a.slots) return { error: "pass a preset or slots" };
      let q;
      try {
        q = parseConstructionSearch({
          ...(preset ? preset.query : { slots: a.slots, atStart: a.at_start }),
          limit: a.limit, offset: a.offset,
        });
      } catch (e) {
        if (e instanceof ConstructionQueryError) return { error: e.message };
        throw e;
      }
      const r = await s.constructions.search(q);
      return {
        ...(preset ? { preset: { name: preset.name, label: preset.label, description: preset.description } } : {}),
        query: { slots: q.slots, at_start: q.atStart ?? false },
        total: r.total,
        ayahs: r.ayahs,
        returned: r.hits.length,
        truncated: (a.offset ?? 0) + r.hits.length < r.total,
        hits: r.hits.map((h) => ({ verse_key: h.verse_key, start: h.start, length: h.length, match: h.match, text: h.text })),
      };
    },
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
  // ---- study tools that find and count (corpus-core/src/occurrences.ts, spellings.ts, voices.ts, wording.ts)
  {
    name: "list_occurrences", title: "Every place one thing occurs",
    description:
      "Every place in the Book where one thing occurs, in mushaf order, several in one āyah where " +
      "it recurs there. kind phrase|pair|form|lemma|root takes a marker's `key` from find_links " +
      "(or typed Arabic: a form or lemma with or without vowels, a root spaced, unspaced or in " +
      "Buckwalter); kind=spelling takes one exact written shape (vowels ignored: the word, or its " +
      "stem, written exactly so, whatever word it is), or one spelling of one word as " +
      "list_spellings counts it, as \"<group key>|<spelling>\" (3:35:3|ٱمْرَأَتُ): exactly the places " +
      "that list shows; kind=construction takes a find_construction-style `query` " +
      "({ slots, atStart }). `total` and `ayahs` are the full counts; `places` are capped by limit. " +
      "This lists and counts. It does not say what the places share in meaning: that is for the reader.",
    schema: {
      kind: z.enum(["phrase", "pair", "form", "lemma", "root", "spelling", "construction"]),
      key: z.string().default("").describe("The marker key, typed Arabic, or a written shape; for construction just a label."),
      query: z.object({ slots: z.array(z.record(z.unknown())).min(1).max(MAX_SLOTS), atStart: z.boolean().optional() })
        .optional().describe("kind=construction only: slots as in find_construction."),
      limit: z.number().int().min(1).max(1000).default(200),
      offset: z.number().int().min(0).default(0),
    },
    run: async (s, a) => {
      let r;
      try {
        r = parseOccurrenceRequest({ kind: a.kind, key: a.key, query: a.query, limit: a.limit, offset: a.offset });
      } catch (e) {
        if (e instanceof OccurrenceRequestError) return { error: e.message };
        throw e;
      }
      return s.tools.occurrences(r);
    },
  },
  {
    name: "list_spellings", title: "Words the Book writes in more than one way",
    description:
      "Every word the mushaf writes in more than one way, most places first (sort=alpha: by the " +
      "Arabic alphabet), each spelling with its count, āyah count and first 12 places. A word is " +
      "listed once: with and without ٱل, and a verb in every person, are counted together where " +
      "the stem is written with the same letters. Where the bare word is written both ة and ت, " +
      "its words that carry a pronoun are counted with neither (`withPronoun`): the script writes " +
      "ت there either way. `kinds` names where two " +
      "spellings part, by the letters only (ت or ة at the end, alif written or as a small mark, " +
      "ى / ي / small ي, hamza seat, one ت or two, a letter doubled, …), with a count each; filter " +
      "with `kind`, search with `q` (Arabic, vowels ignored). Groups whose shapes differ only by a " +
      "grammatical ending (ذُو / ذِى, decided from the case the corpus gives) are left out of the list " +
      "unless kind=ending; `hidden` says how many. Pass `group` (a key from the list) for one group " +
      "with every place. It never says why a word is spelled so.",
    schema: {
      kind: z.string().optional().describe("One kind id from `kinds`."),
      q: z.string().optional().describe("Arabic to look for, e.g. ابراهيم."),
      group: z.string().optional().describe("One group's key (chapter:verse:word of its first word) for all its places."),
      sort: z.enum(["count", "alpha"]).optional().describe("count (default): most places first; alpha: by the word, in the order of the Arabic alphabet."),
      limit: z.number().int().min(1).max(200).default(30),
      offset: z.number().int().min(0).default(0),
    },
    run: async (s, a) => {
      if (a.group) return (await s.tools.spellingGroup(a.group)) ?? { error: `no spelling group: ${a.group}` };
      return s.tools.spellingList({ kind: a.kind, q: a.q, sort: a.sort, limit: a.limit, offset: a.offset });
    },
  },
  {
    name: "find_speech_openers", title: "Where speech is introduced in a sūrah",
    description:
      "Each word in a sūrah that may introduce speech: every verb of the root ق و ل (قَالَ، قَالُوا، " +
      "قُلْ، يَقُولُونَ …), `sure: true`, and every verb of ن د و (نَادَىٰ، نُودِىَ), `sure: true` only where " +
      "the corpus marks what follows it with a vocative or the أَنْ of interpretation before another " +
      "verb, else `sure: false` (a call; speech may or may not follow). `extra_roots` (Arabic letters, " +
      "up to 10) adds the verbs of other roots, marked `added`, sure the same way as ن د و; a root the " +
      "Book does not have finds nothing. Word positions are 1-based. Where the speech ends is not " +
      "marked and is not guessed; who speaks is for the reader.",
    schema: {
      chapter: z.number().int().min(1).max(114),
      extra_roots: z.array(z.string().min(1)).max(10).default([]).describe("More opener roots in Arabic letters, e.g. [\"د ع و\", \"سأل\"]."),
    },
    run: async (s, { chapter, extra_roots }) =>
      (await s.tools.speechOpeners(chapter, extra_roots)) ?? { error: `chapter not found: ${chapter}` },
  },
  {
    name: "find_pronouns", title: "The pronouns of an āyah",
    description:
      "The pronouns in one āyah from the morphology: separate words (هُوَ، إِيَّاكَ), attached to a word " +
      "(the هِمْ of عَلَيْهِمْ, the تَ of أَنْعَمْتَ, the هُمْ of لَهُمْ), with the person, number and gender " +
      "the corpus gives. With verbs=true also each verb's own person, number and gender (type " +
      "\"verb\", nothing written, so `pronoun` is empty). An empty pronoun on an attached one means " +
      "it is not written (رَبِّ). `part` numbers the pronouns of one word from 1 in the corpus's order, " +
      "the verb's own subject counted even when verbs=false, so a number never changes (خَلَقْنَـٰكُمْ " +
      "in 7:11: the verb 1, نَا 2, كُمْ 3); a mention names a pronoun by word and part. It does not say " +
      "whom a pronoun points to: that is for the reader.",
    schema: { verse_key: z.string(), verbs: z.boolean().default(false) },
    run: async (s, { verse_key, verbs }) => (await s.tools.pronouns(verse_key, verbs)) ?? { error: `verse not found: ${verse_key}` },
  },
  {
    name: "check_wording", title: "Is this wording in the Book?",
    description:
      `Any Arabic text (up to ${MAX_CHECK_WORDS} words) set against the Book word by word. Each word ` +
      "is `written` (found exactly as written, vowels and all), `letters` (the same letters with other " +
      "vowels; up to 5 of the Book's forms and their roots), `stem` (found once a leading و ف ب ل ك س " +
      "and/or ال is set aside; which prefix is named) or `none`. Counts are words and āyāt; `sample` is " +
      "one āyah to open. It checks wording only, never whether a reading is right.",
    schema: { text: z.string().min(1) },
    run: async (s, { text }) => {
      try {
        return await s.tools.wordingCheck(text);
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  },
  {
    name: "compare_ayat", title: "What differs between two āyāt",
    description:
      "Two āyāt aligned word against word (the longest common run of their words, vowels ignored). " +
      "Each row is labelled: same; marks (same letters, other vowels or marks); spelling (the same " +
      "word written differently); changed (another word or form); only-a; only-b. `counts` totals " +
      "them. It shows where the wording differs, never why.",
    schema: { a: z.string(), b: z.string() },
    run: async (s, { a, b }) => (await s.tools.diff(a, b)) ?? { error: `verse not found: ${a} or ${b}` },
  },
  {
    name: "root_spread", title: "Where a set of roots occurs, by sūrah and by page",
    description:
      "Counts where 1 to 60 roots (Arabic letters, spaced or not, or Buckwalter) occur: places " +
      "(words) and āyāt in each of the 114 sūrahs (with the sūrah's āyah count) and on each page " +
      "of the muṣḥaf, zeros included; totals; how many sūrahs and pages have none; `unknown` for " +
      "roots the Book does not have. An āyah holding two of the roots counts once in `ayahs`. Set " +
      "compact=true for the totals and only the sūrahs and pages that have some. It counts; what a " +
      "distribution means is for the reader.",
    schema: {
      roots: z.array(z.string().min(1)).min(1).max(60),
      compact: z.boolean().default(false).describe("Leave out sūrahs and pages with no places."),
    },
    run: async (s, { roots, compact }) => {
      const r = await s.tools.spread(roots);
      return compact ? { ...r, chapters: r.chapters.filter((c) => c.places > 0), pages: r.pages.filter((p) => p.places > 0) } : r;
    },
  },
  {
    name: "find_supplications", title: "Where the Lord is addressed: رَبَّنَا، رَبِّ، ٱللَّهُمَّ",
    description:
      "Every place in Book order where the Lord is addressed with رَبَّنَا (رَبّ + نَا in the " +
      "accusative, not after إِنَّ), رَبِّ (its ى of \"my\" not written; not رَبِّ ٱلْعَـٰلَمِينَ, not the " +
      "statement رَبِّى) or ٱللَّهُمَّ, from the morphology, anywhere in an āyah; `openings` counts each. " +
      "The morphology cannot tell an object from an address, so a رَبَّنَا that is a verb's object " +
      "(25:21) is listed too. This lists where the address is written; whether a place is a " +
      "supplication is the reader's to say.",
    schema: { opening: z.enum(["rabbana", "rabbi", "allahumma"]).optional() },
    run: (s, { opening }) => s.tools.supplications(opening),
  },
  {
    name: "surah_frame", title: "What a sūrah's opening shares with its close",
    description:
      "The roots found both in the first `n` āyāt and in the last `n` āyāt of a sūrah (n 1 to 10, " +
      "default 3, lowered so the two ends never overlap; the basmala is an āyah only in al-Fātiḥah). " +
      "Only words with a root. Each shared root has its places at each end, `level` (form = the same " +
      "written word at both ends, lemma = the same lemma, root = only the root) and `inBook` (how " +
      "many words of the Book carry it); the rarest first. It finds what is shared, never what it means.",
    schema: { chapter: z.number().int().min(1).max(114), n: z.number().int().min(1).max(10).default(3) },
    run: async (s, { chapter, n }) => (await s.tools.surahFrame(chapter, n)) ?? { error: `chapter not found: ${chapter}` },
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
  run: async (state, a) => {
    const verseKey = guard.verseKey(a.verse_key);
    const text = guard.requireText(a.text, "text");
    const id = proposalId("note");
    await guard.mustNotExist(state, "note", id);
    // carry the word's form/root so the note cross-references properly
    let lemma: string | null = null;
    let root: string | null = null;
    if (a.word_position) {
      const w = ((await state.content.verseWords(verseKey)) as any[]).find((x) => x.position === a.word_position);
      lemma = w?.lemma ?? null;
      root = w?.root ?? null;
    }
    const saved = await state.research.saveNote({
      id, verseKey, wordPosition: a.word_position ?? null, kind: a.kind,
      text, lemma, root, source: AI_SOURCE,
    });
    return { proposed: true, id: saved.id, awaiting_review: true };
  },
};

/** A word span that really is in the āyah, or a refusal that says what the āyah has. */
async function mustBeSpan(state: any, verseKey: string, word: number, words: number, what: string): Promise<void> {
  // the word list ends with the āyah's end mark, which has no text and is not a word
  const count = ((await state.content.verseWords(verseKey)) as any[]).filter((w) => w.arabic).length;
  if (count === 0) throw new WriteRefused(`${verseKey} is not an āyah in the Book.`);
  if (word + words - 1 > count) {
    throw new WriteRefused(`${what}: ${verseKey} has ${count} words, so words ${word}–${word + words - 1} are not in it.`);
  }
}

const LINK_KIND = z.enum(["", "same-wording", "defined", "same-style", "same-image", "refers", "tension"]);

const propose_link: Tool = {
  name: "propose_link",
  title: "Propose a link between two places, or a lead (proposal)",
  description:
    "Record that a run of words in one āyah is tied to a run of words in another. Saved as a " +
    "PROPOSAL the reader accepts or dismisses. Leave the second place out to record a LEAD: " +
    "something worth pursuing whose other end is not found yet. kind: same-wording (the same " +
    "words), defined (the FIRST place explains a term the second uses), same-style (the same " +
    "way of speaking), same-image (the same picture), refers (one points to the other), tension " +
    "(the two seem to disagree: the reader keeps it open until they settle it, you cannot), or " +
    "empty when you only want to note the tie. Say in the note what ties them and how rare it " +
    "is (find_links gives the count). State what you found; what the link means is the " +
    "reader's to decide.",
  writes: true,
  schema: {
    from_verse: z.string().describe('Chapter:verse, e.g. "19:47".'),
    from_word: z.number().int().min(1).describe("The word the span starts at (1-based, as read_ayah numbers them)."),
    from_words: z.number().int().min(1).default(1).describe("How many words the span covers."),
    to_verse: z.string().optional().describe("The other āyah. Leave out for a lead."),
    to_word: z.number().int().min(1).optional(),
    to_words: z.number().int().min(1).default(1),
    kind: LINK_KIND.default(""),
    shares_kind: z.enum(["phrase", "pair", "form", "lemma", "root"]).optional()
      .describe("What the two places share, as find_links names it."),
    shares_key: z.string().optional().describe("That marker's `key` from find_links, copied verbatim."),
    shares_text: z.string().optional().describe("That marker's `text` from find_links."),
    group: z.string().default("").describe("A group name, when this belongs with other links of one image or theme."),
    note: z.string().describe("What ties the two places, in plain language."),
  },
  run: async (state, a) => {
    const from = guard.verseKey(a.from_verse);
    const note = guard.requireText(a.note, "note");
    await mustBeSpan(state, from, a.from_word, a.from_words ?? 1, "from");
    let b: Record<string, unknown> | null = null;
    if (a.to_verse) {
      const to = guard.verseKey(a.to_verse);
      const word = a.to_word ?? 1;
      await mustBeSpan(state, to, word, a.to_words ?? 1, "to");
      if (to === from && word === a.from_word) throw new WriteRefused("A link needs two different places.");
      b = { verseKey: to, word, words: a.to_words ?? 1 };
    }
    const saved = await state.research.saveLink({
      id: proposalId("link"),
      a: { verseKey: from, word: a.from_word, words: a.from_words ?? 1 }, b,
      kind: a.kind ?? "",
      marker: a.shares_key ? { kind: a.shares_kind ?? "form", key: a.shares_key, text: a.shares_text ?? a.shares_key } : null,
      label: (a.group ?? "").trim(), note, source: AI_SOURCE,
    });
    return {
      proposed: true, id: saved.id, status: saved.status, awaiting_review: true,
      ...(b ? {} : { note: "Saved as a lead: the other end is still to find." }),
    };
  },
};

const propose_speaker: Tool = {
  name: "propose_speaker",
  title: "Propose who speaks in part of an āyah (proposal)",
  description:
    "Tag a run of words in an āyah with who speaks them and to whom. The corpus does not say " +
    "who speaks; this is a reading, saved as a PROPOSAL the reader accepts or dismisses. Use " +
    "the names the reader already uses (my_links with the āyah or sūrah shows them). Where " +
    "the speaker is disputed or not stated in the text, say so in the note.",
  writes: true,
  schema: {
    verse_key: z.string(),
    from_word: z.number().int().min(1).default(1),
    words: z.number().int().min(1).optional().describe("How many words. Leave out for: to the end of the āyah."),
    speaker: z.string().default(""),
    addressee: z.string().default(""),
    also_hears: z.string().default("").describe("Who else hears it, when the passage shows someone does."),
    speaker_is: z.enum(["", "stated", "inferred"]).default("")
      .describe('"stated" when the text itself names the speaker, "inferred" when it is read from the passage.'),
    note: z.string().default(""),
  },
  run: async (state, a) => {
    const verseKey = guard.verseKey(a.verse_key);
    const speaker = (a.speaker ?? "").trim();
    const addressee = (a.addressee ?? "").trim();
    if (!speaker && !addressee) throw new WriteRefused("Give a speaker or an addressee.");
    await mustBeSpan(state, verseKey, a.from_word ?? 1, a.words ?? 1, "span");
    const saved = await state.research.saveSpeech({
      id: proposalId("speech"), verseKey, word: a.from_word ?? 1, words: a.words ?? null,
      speaker, addressee, listeners: (a.also_hears ?? "").trim(), basis: a.speaker_is ?? "",
      note: a.note ?? "", source: AI_SOURCE,
    });
    return { proposed: true, id: saved.id, awaiting_review: true };
  },
};

/** Every place in a list must be a real word span; āyāt are looked up once each. */
async function mustBePlaces(state: any, places: { verse_key: string; word: number; words?: number }[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const p of places) {
    const key = guard.verseKey(p.verse_key);
    if (!counts.has(key)) counts.set(key, ((await state.content.verseWords(key)) as any[]).filter((w) => w.arabic).length);
    const count = counts.get(key)!;
    if (count === 0) throw new WriteRefused(`${key} is not an āyah in the Book.`);
    const last = p.word + (p.words ?? 1) - 1;
    if (last > count) throw new WriteRefused(`${key} has ${count} words, so word ${last} is not in it.`);
  }
}

const my_rule_checks: Tool = {
  name: "my_rule_checks",
  title: "The rules the reader is checking against the Book",
  description:
    "The reader's rule checks: a rule they stated, what they say would prove it wrong, and what " +
    "it covers. With no rule_id: every rule and its tally (fits, exception, unsure, and how many " +
    "suggestions wait). With a rule_id: that rule and every mark on it. The marks cover only the " +
    "places looked at so far: hand the rule's `covers` to list_occurrences to get EVERY place it " +
    "applies to, and compare. One real exception breaks a rule, so the unmarked places matter most.",
  schema: {
    rule_id: z.string().optional(),
    mark: z.enum(["fits", "exception", "unsure"]).optional().describe("With a rule_id: only the places marked this way."),
  },
  run: async (state, a) => {
    if (!a.rule_id) {
      const rules = ((await state.research.listRules()) as any[]).map(ruleSummary);
      return { total: rules.length, rules };
    }
    const rule = (await state.research.getRule(a.rule_id)) as any;
    if (!rule) return { error: `No rule with id ${a.rule_id}.`, hint: "my_rule_checks with no rule_id lists them." };
    const marks = ((rule.marks ?? []) as any[]).filter((m) => !a.mark || m.mark === a.mark)
      .map((m) => ({ verse_key: m.verseKey, word: m.word, mark: m.mark, note: m.note || null, by: m.source === "ai" ? "suggested" : "reader" }));
    return { ...ruleSummary(rule), marks };
  },
};

const suggest_rule_marks: Tool = {
  name: "suggest_rule_marks",
  title: "Suggest how places stand against one of the reader's rules (suggestions)",
  description:
    "For a rule the reader is checking, suggest for each place whether it FITS the rule, is an " +
    "EXCEPTION to it, or you are UNSURE. Saved as SUGGESTIONS the reader accepts or dismisses; " +
    "they do not count until then, and a place the reader has already marked is left alone. Take " +
    "the places from list_occurrences with the rule's `covers` (use its verse_key and word), and " +
    "read each āyah before marking it. Look hardest for exceptions: the reader gains most from a " +
    "counter-example. Give a note for every exception and every unsure, quoting what in the āyah " +
    "makes it so. Do not mark a place you have not read.",
  writes: true,
  schema: {
    rule_id: z.string(),
    marks: z.array(z.object({
      verse_key: z.string(),
      word: z.number().int().min(1).describe("The word the occurrence starts at, as list_occurrences gives it."),
      mark: z.enum(["fits", "exception", "unsure"]),
      note: z.string().default(""),
    })).min(1).max(200),
  },
  run: async (state, a) => {
    const rule = (await state.research.getRule(a.rule_id)) as any;
    if (!rule) throw new WriteRefused(`No rule with id ${a.rule_id}. my_rule_checks lists the reader's rules; only the reader can state one.`);
    for (const m of a.marks as any[]) {
      if (m.mark !== "fits" && !String(m.note ?? "").trim()) {
        throw new WriteRefused(`${m.verse_key} word ${m.word}: an exception or an unsure needs a note saying what in the āyah makes it so.`);
      }
    }
    await mustBePlaces(state, a.marks);
    const marks = (a.marks as any[]).map((m) => ({ verseKey: guard.verseKey(m.verse_key), word: m.word, mark: m.mark, note: m.note ?? "" }));
    const { saved } = await state.research.suggestRuleMarks(rule.id, marks);
    return {
      suggested: saved, awaiting_review: true,
      ...(saved < marks.length ? { left_alone: marks.length - saved, note: "The reader had already marked those places; their marks stand." } : {}),
    };
  },
};

const my_characters: Tool = {
  name: "my_characters",
  title: "The characters the reader has named, and what points to each",
  description:
    "The reader's characters: someone they named, the names and titles they filed under them, " +
    "and how many places are established or still potential. With a character_id: every mention " +
    "(a name, title, description or pronoun at a place), optionally only one āyah or sūrah. A " +
    "mention is POTENTIAL until the reader establishes it; treat only established ones as the " +
    "reader's reading. Read this before proposing mentions, and use the reader's own names.",
  schema: {
    character_id: z.string().optional(),
    verse_key: z.string().optional(),
    chapter: z.number().int().min(1).max(114).optional(),
    status: z.enum(["potential", "established"]).optional(),
  },
  run: async (state, a) => {
    if (!a.character_id) {
      const characters = ((await state.research.listCharacters()) as any[]).map((c) => ({
        id: c.id, name: c.name, note: c.note || null,
        names_and_titles: ((c.designations ?? []) as any[]).map((d) => ({ as: d.as, text: d.text, covers: { kind: d.kind, key: d.key } })),
        mentions: c.counts,
      }));
      return { total: characters.length, characters };
    }
    const c = (await state.research.getCharacter(a.character_id)) as any;
    if (!c) return { error: `No character with id ${a.character_id}.`, hint: "my_characters with no character_id lists them." };
    const mentions = ((await state.research.listMentions({
      character: c.id, verse: a.verse_key, chapter: a.chapter, status: a.status,
    })) as any[]).map(mentionSummary);
    return { id: c.id, name: c.name, note: c.note || null, mentions_total: c.counts, shown: mentions.length, mentions };
  },
};

const propose_mentions: Tool = {
  name: "propose_mentions",
  title: "Propose places that point to one of the reader's characters (potential)",
  description:
    "File places under a character the reader has named: where a name, a title, a description " +
    "or a pronoun points to them. Each is saved as POTENTIAL; only the reader can establish it. " +
    "A place already filed under that character is left as it is. Use find_pronouns for the " +
    "pronouns of an āyah and list_occurrences for every place a name occurs. A word can carry " +
    "two pronouns (خَلَقْنَـٰكُمْ): for a pronoun, pass its part as find_pronouns numbers it. For a pronoun or a " +
    "description, say in the note what in the passage points to this character. You cannot " +
    "create a character: if the reader has not named one, tell them and let them add it.",
  writes: true,
  schema: {
    character_id: z.string().describe("From my_characters."),
    kind: z.enum(["name", "title", "description", "pronoun"]),
    filed_under: z.string().default("").describe("The name or title as the reader filed it (my_characters shows them); empty for a pronoun."),
    places: z.array(z.object({
      verse_key: z.string(),
      word: z.number().int().min(1),
      words: z.number().int().min(1).default(1),
      part: z.number().int().min(0).max(20).default(0)
        .describe("For a pronoun: which pronoun of the word, as find_pronouns numbers it (1, 2 …). 0 = the word itself (a name, a title)."),
      note: z.string().default(""),
    })).min(1).max(300),
  },
  run: async (state, a) => {
    const c = (await state.research.getCharacter(a.character_id)) as any;
    if (!c) throw new WriteRefused(`No character with id ${a.character_id}. my_characters lists them; only the reader can add one.`);
    if (a.kind === "pronoun" || a.kind === "description") {
      const bare = (a.places as any[]).find((p) => !String(p.note ?? "").trim());
      if (bare) throw new WriteRefused(`${bare.verse_key} word ${bare.word}: a ${a.kind} needs a note saying what in the passage points to ${c.name}.`);
    }
    if (a.kind === "pronoun") {
      const whole = (a.places as any[]).find((p) => !p.part);
      if (whole) throw new WriteRefused(`${whole.verse_key} word ${whole.word}: say which pronoun of the word you mean (part, from find_pronouns).`);
    }
    await mustBePlaces(state, a.places);
    const mentions = (a.places as any[]).map((p) => ({
      characterId: c.id, verseKey: guard.verseKey(p.verse_key), word: p.word, words: p.words ?? 1, part: p.part ?? 0,
      kind: a.kind, designation: (a.filed_under ?? "").trim(), note: p.note ?? "",
    }));
    const { saved } = await state.research.addMentions(mentions);
    return {
      proposed: saved, status: "potential", character: c.name,
      ...(saved < mentions.length ? { left_alone: mentions.length - saved, note: "Those places were already filed under this character." } : {}),
    };
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
  run: async (state, a) => {
    const d = await getRoot(state, a.root);
    if (!d) return { error: `root not found: ${a.root}` };
    const label = guard.requireText(a.label, "label");
    const id = proposalId("ind");
    await guard.mustNotExist(state, "indication", id);

    const formRefs: FormRef[] = (d.forms ?? [])
      .filter((f) => f.lemma_arabic)
      .map((f) => ({ form: f.lemma_arabic as string, pos: f.pos_english, occurrences: f.occurrence_count }));
    const resolveForm = makeFormResolver(formRefs);
    const saved = await state.research.saveIndication(
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
      const out = await state.research.saveRefinement(
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
  run: async (state, a) => {
    const all = ((await state.research.listCases()) as any[]).map((c) => caseSummary(c));
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
  run: async (state, { case_id }) => caseSummary(await mustGetCase(state, case_id), { full: true }),
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
  run: async (state, a) => {
    const subject = a.subject_type === "root"
      ? ((await getRoot(state, a.subject))?.root_arabic ?? a.subject)
      : a.subject;
    const now = Date.now();
    const saved = await state.research.saveCase({
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
    "the board for you. Duplicates of an āyah already on the board are skipped. An āyah that " +
    "stands AGAINST what the case is arriving at belongs on the board too: pin it with " +
    'stance "against". Looking for those is part of the work, and one of them outweighs many for.',
  writes: true,
  schema: {
    case_id: z.string(),
    ayat: z.array(z.object({
      verse_key: z.string(),
      word_position: z.number().int().min(1).optional(),
      stance: z.enum(["for", "against"]).default("for").describe("Does this āyah support what the case is arriving at, or stand against it?"),
    })).min(1).max(40),
    expect_version: VERSION,
  },
  run: async (state, a) => {
    const c = await mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const next = { ...c, cards: [...(c.cards ?? [])] };
    const added: unknown[] = [];
    const skipped: unknown[] = [];
    for (const item of a.ayat) {
      const vk = guard.verseKey(item.verse_key);
      if (!(await state.content.getVerse(vk, { script: "uthmani" }))) {
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
        ...(item.stance === "against" ? { stance: "against" as const } : {}),
      };
      next.cards.push(card);
      added.push({ id: card.id, verse_key: vk, ...(item.stance === "against" ? { stance: "against" } : {}) });
    }
    const saved = await saveGuarded(state, c, next);
    return { added, skipped, updated_at: saved.updatedAt };
  },
};

const add_slip: Tool = {
  name: "add_slip",
  title: "Add an observation or a citation to a case (writes)",
  description:
    "Put your own reasoning on the board as a comment slip, or a cited source as a reference " +
    "slip (with source + locator, and source_kind: a dictionary, a tafsīr, a narration, a story " +
    "from outside the Book). The reader sees a tally of what their reading rests on, so say " +
    "honestly what kind of work you are citing. Attach it to one derived form, or to the root itself.",
  writes: true,
  schema: {
    case_id: z.string(),
    kind: z.enum(["comment", "reference"]).default("comment"),
    text: z.string().describe("The observation, or what the source says."),
    form: z.string().nullable().default(null).describe("The lemma this concerns, or null for the root."),
    source: z.string().default("").describe("Reference slips: e.g. \"Lisān al-ʿArab\"."),
    locator: z.string().default("").describe("Reference slips: e.g. \"under ر-ح-م\", \"vol 8 p. 2925\"."),
    source_kind: z.enum(["lexicon", "tafsir", "narration", "story", "other"]).optional()
      .describe("Reference slips: what kind of work the source is. A dictionary is 'lexicon'; a report about the Prophet or the companions is 'narration'; a story the Book does not itself tell is 'story'."),
    expect_version: VERSION,
  },
  run: async (state, a) => {
    const c = await mustGetCase(state, a.case_id);
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
      sourceKind: a.kind === "reference" ? a.source_kind : undefined,
      ...at, author: AI_SOURCE,
    };
    next.slips.push(slip);
    const saved = await saveGuarded(state, c, next);
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
  run: async (state, a) => {
    const c = await mustGetCase(state, a.case_id);
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
    const saved = await saveGuarded(state, c, { ...c, threads: [...(c.threads ?? []), thread] });
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
  run: async (state, a) => {
    const c = await mustGetCase(state, a.case_id);
    expectVersion(c, a.expect_version);
    const ids = new Set([...(c.cards ?? []), ...(c.slips ?? [])].map((i: any) => i.id));
    const missing = a.item_ids.filter((i: string) => !ids.has(i));
    if (missing.length) throw new WriteRefused(`Not on this case: ${missing.join(", ")}`);
    const cluster = {
      id: proposalId("cl"), name: guard.requireText(a.name, "name"),
      cardIds: a.item_ids, source: AI_SOURCE,
    };
    const saved = await saveGuarded(state, c, { ...c, clusters: [...(c.clusters ?? []), cluster] });
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
  run: async (state, a) => {
    const c = await mustGetCase(state, a.case_id);
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
    const saved = await saveGuarded(state, c, next);
    return { [a.action === "remove" ? "removed" : "updated"]: a.item_id, updated_at: saved.updatedAt };
  },
};

const propose_conclusion: Tool = {
  name: "propose_conclusion",
  title: "Propose a verdict or an established meaning (proposal)",
  description:
    "State what you think the case has shown — either the case verdict, or one form's " +
    "meaning. This is PARKED for the reader: it does not set the verdict, close the case, " +
    "or mark any form established. Only the reader applies a conclusion. A conclusion " +
    "should rest on at least two separate āyāt: the answer's `rests_on_ayahs` says how many " +
    "the case has pinned, and one āyah is a lead to pursue, not a finding.",
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
  run: async (state, a) => {
    const c = await mustGetCase(state, a.case_id);
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
    const saved = await saveGuarded(state, c, { ...c, proposals: { entries } });
    // two cards on one āyah are one āyah: what counts is how many separate places it stands on
    // (an āyah pinned as standing AGAINST the case is counted apart, never as support)
    const cards = (c.cards ?? []) as { verseKey: string; stance?: string }[];
    const ayahs = new Set(cards.filter((card) => card.stance !== "against").map((card) => card.verseKey)).size;
    const against = new Set(cards.filter((card) => card.stance === "against").map((card) => card.verseKey)).size;
    // what else the case leans on: cited works, by the kind each reference slip names
    const cited: Record<string, number> = {};
    for (const s of (c.slips ?? []) as { kind?: string; sourceKind?: string }[]) {
      if (s.kind !== "reference") continue;
      const k = s.sourceKind ?? "kind_not_said";
      cited[k] = (cited[k] ?? 0) + 1;
    }
    return {
      proposed: true, id: entry.id, updated_at: saved.updatedAt,
      applied: false, awaiting_review: true,
      rests_on_ayahs: ayahs,
      ...(Object.keys(cited).length ? { rests_on_cited_works: cited, cited_works_note: "The reader sees this tally on the case. Tell them plainly which part of the conclusion comes from the āyāt and which from a cited work." } : {}),
      ...(against > 0 ? { ayahs_against: against, against_note: "The case holds āyāt pinned as standing against it. Say in your reasoning how the conclusion answers each, or tell the reader it does not." } : {}),
      ...(ayahs < 2 ? { caution: "This case has fewer than two separate āyāt pinned. Tell the reader the conclusion rests on a single lead, and look for a second, independent āyah (find_links, trace_word)." } : {}),
      note: "Parked for the reader. The case's verdict, status and established forms are unchanged.",
    };
  },
};

const list_motifs: Tool = {
  name: "list_motifs",
  title: "The reader's motifs (بيوت)",
  description:
    "The reader's motifs — named groupings of roots that share a theme (بيوت, 'houses'). Read " +
    "these to build on the reader's thematic structure instead of re-deriving it. Each carries " +
    "`source`: 'me' = the reader's own, 'ai' = proposed by an assistant and awaiting review.",
  schema: {
    root: z.string().optional().describe("Only motifs containing this root (Arabic or buckwalter)."),
  },
  run: async (state, { root }) => {
    if (root) {
      const d = await getRoot(state, root);
      const ar = d?.root_arabic ?? root;
      return { root: ar, motifs: await state.research.motifsForRoot(ar) };
    }
    return { motifs: await state.research.listMotifs() };
  },
};

const propose_motif: Tool = {
  name: "propose_motif",
  title: "Propose a motif — a grouping of roots (proposal)",
  description:
    "Create a NEW motif (a بيت: roots that share a theme), tagged AI-authored for the reader to " +
    "review. Additive only — it never edits the reader's own motifs. List the roots that belong " +
    "together; give them in Arabic or buckwalter, copied from tool results.",
  writes: true,
  schema: {
    name: z.string().describe("A short name for the grouping."),
    note: z.string().default("").describe("Why these roots belong together — the shared theme."),
    roots: z.array(z.string()).default([]).describe("Roots to include (Arabic or buckwalter)."),
  },
  run: async (state, a) => {
    const name = guard.requireText(a.name, "name");
    const id = proposalId("motif");
    await state.research.saveMotif({ id, name, note: a.note ?? "", source: AI_SOURCE });
    const added: string[] = [];
    for (const r of a.roots ?? []) {
      const d = await getRoot(state, r);
      const ar = d?.root_arabic ?? String(r);
      await state.research.addMotifRoot(id, ar);
      added.push(ar);
    }
    return { proposed: true, id, name, roots: added, awaiting_review: true };
  },
};

const add_root_to_motif: Tool = {
  name: "add_root_to_motif",
  title: "Add a root to a motif you proposed",
  description:
    "Tag a root into an AI-proposed motif. Refuses the reader's own motifs — those are their " +
    "curation. Use propose_motif first to create one.",
  writes: true,
  schema: {
    motif_id: z.string(),
    root: z.string().describe("The root to add (Arabic or buckwalter)."),
  },
  run: async (state, a) => {
    const m = await guard.ownMotif(state, a.motif_id);
    const d = await getRoot(state, a.root);
    const ar = d?.root_arabic ?? String(a.root);
    await state.research.addMotifRoot(m.id, ar);
    return { ok: true, motif_id: m.id, root: ar, roots: ((await state.research.getMotif(m.id)) as any)?.roots ?? [] };
  },
};

const remove_root_from_motif: Tool = {
  name: "remove_root_from_motif",
  title: "Remove a root from a motif you proposed",
  description: "Untag a root from an AI-proposed motif. Refuses the reader's own motifs.",
  writes: true,
  schema: {
    motif_id: z.string(),
    root: z.string().describe("The root to remove (Arabic or buckwalter)."),
  },
  run: async (state, a) => {
    const m = await guard.ownMotif(state, a.motif_id);
    const d = await getRoot(state, a.root);
    const ar = d?.root_arabic ?? String(a.root);
    await state.research.removeMotifRoot(m.id, ar);
    return { ok: true, motif_id: m.id, root: ar, roots: ((await state.research.getMotif(m.id)) as any)?.roots ?? [] };
  },
};

export const TOOLS: Tool[] = [
  study_root, read_ayah, find_where_roots_meet, trace_word, search_quran, compare_forms,
  my_research_on, my_links, my_rule_checks, my_characters, list_motifs, ...thin, add_note, propose_link, propose_speaker,
  suggest_rule_marks, propose_mentions, propose_indication,
  propose_motif, add_root_to_motif, remove_root_from_motif,
  // the Investigate board
  list_cases, read_case, open_case, add_evidence, add_slip, link_evidence, group_evidence,
  revise_own_item, propose_conclusion,
];
