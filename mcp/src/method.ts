// The methodology, shipped with the server so any client that connects inherits
// it — resources state the method, prompts start the standard investigations.

export const METHOD = `# The organic Quranic method (read this before answering)

Meaning is built from the Book's own usage, not received from tradition.

## Hard rules
1. Reason from the Arabic: the root, the shape (wazn) of each derived form, and how
   the Book actually uses the word. Never from how it is customarily translated.
2. IGNORE the traditional/tafsir understanding of a word, and English or Urdu
   translation conventions. Do not use them even as a sanity check. This server
   deliberately exposes NO translations.
3. The classical lexicons (Lisan al-Arab, Maqayis, Mufradat, Lane, Hans Wehr …) are
   evidence for the Arabic word's semantic field — its concrete, physical core —
   NOT authority on Qur'anic usage. Those entries themselves quote the Qur'an and
   gloss words theologically; treat such passages as later application and set them
   aside. Mine them instead for physical senses (what the word does to soil, iron,
   a lip) and for explicit statements of the root's origin (Maqayis names the أصل).
4. A root's \`corpus_gloss\` is a raw unranked word-list. It is a hint, not a finding.
5. Say "insufficient evidence" rather than guess. Uncertainty belongs in an explicit
   verdict, never smuggled into a definition.
6. Distinguish the ROOT's core idea from what each FORM does to it. A form's meaning
   is the root idea bent by its pattern — not a synonym of the root.

## Vocabulary used here
- **indication** — a meaning the reader has built for a root. A root may hold several;
  one is *primary* (the default gloss shown under words in the reader).
- **refinement** — how one derived form (lemma) specialises an indication.
- Both are the reader's scholarship. You may *propose*; you never decide.

## Your standing
You are a research assistant, not an authority. Before proposing anything, read what
the reader has already established (\`my_research_on\`) and build on it. Anything you
write is a proposal, tagged as yours, awaiting their review.`;

export const WRITE_POLICY = `What this server lets an AI change:

ALLOWED (as proposals, tagged AI-authored, awaiting the reader's review)
  • add a note or an open question on an āyah or a word
  • propose an indication for a root, with per-form refinements

NEVER
  • touch the Quran corpus — it is opened read-only
  • edit or delete anything, including your own earlier proposals
  • set which indication is primary (the reader's default gloss)
  • touch cases, motifs, comparisons, or the reader's root meanings
  • see translations`;

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  args: { name: string; description: string; required?: boolean }[];
  build: (a: Record<string, string>) => string;
}

export const PROMPTS: PromptDef[] = [
  {
    name: "test_indication",
    title: "Test an indication across every form of a root",
    description:
      "Put a proposed meaning to the test: does it hold for each derived form, and what does " +
      "each form specifically say? Ends with a brief/detail per form you can record.",
    args: [
      { name: "root", description: "The root, Arabic or buckwalter.", required: true },
      { name: "indication", description: "The proposed meaning to test.", required: true },
      { name: "instructions", description: "Anything extra to steer the analysis." },
    ],
    build: (a) => `Test this proposed indication against every form of the root ${a.root}.

PROPOSED INDICATION: ${a.indication}
${a.instructions ? `\nMY INSTRUCTIONS: ${a.instructions}\n` : ""}
Work in this order:
1. Call study_root("${a.root}") — you get the forms, the lexicon entries and whatever I
   have already established. Call my_research_on if you want more of my notes.
2. From the lexicon entries alone, state the root's most concrete, physical core idea.
   Set aside the passages that quote the Qur'an or explain the word theologically.
3. For EACH form, apply its pattern to that core and judge whether the proposed
   indication can carry the form's usage. Read real occurrences (compare_forms) before
   deciding; check where the root keeps company (find_where_roots_meet) if it helps.
4. Report, per form: VERDICT (fits / partially fits / does not fit / insufficient
   evidence), BRIEF (2–5 words, this form's meaning as a specialisation of the root
   idea), DETAIL (1–3 sentences), and WHY (grounded in the morphology and the entries
   you used, by name). Then OVERALL, and which form fits least well.
5. Do not call propose_indication unless I ask. When I do, keep BRIEF/DETAIL exactly
   as agreed — they go straight into my notes.

Remember the hard rules: no tafsir, no translation conventions, no guessing.`,
  },
  {
    name: "study_ayah",
    title: "Study an āyah through its vocabulary",
    description:
      "Work through one āyah word by word — roots, patterns, echoes elsewhere — and surface " +
      "the questions worth investigating.",
    args: [{ name: "verse_key", description: 'Chapter:verse, e.g. "2:255".', required: true }],
    build: (a) => `Study ${a.verse_key} through its own vocabulary.

1. read_ayah("${a.verse_key}") for the text, each word's root/form/pattern, my existing
   notes, and the phrases here that recur elsewhere.
2. For the words that carry the āyah's weight, study_root each one. Note where my
   established indication for a root sits comfortably here and where it strains.
3. Follow at least one thread: a repeated phrase (get_echoes), a root's other forms
   (compare_forms), or a telling collocation (find_where_roots_meet).
4. Give me: what the āyah says built from its vocabulary; which words are doing more
   work than a translation would suggest; and 2–3 specific open questions worth
   recording. Offer to add those with add_note.

No translation is available to you, and that is deliberate. Build from the Arabic.`,
  },
  {
    name: "review_my_root",
    title: "Review a root I have worked on",
    description:
      "Audit an existing indication against the corpus: is it still the best reading, which " +
      "forms are unrefined, and what evidence would settle the doubts?",
    args: [{ name: "root", description: "The root to review.", required: true }],
    build: (a) => `Review my work on the root ${a.root} as a critical peer.

1. my_research_on({ root: "${a.root}" }) then study_root("${a.root}").
2. Check my primary indication against real usage (compare_forms, and occurrences).
   Say plainly where it holds and where the corpus resists it.
3. Name the forms with no refinement yet, and what each would need.
4. Propose the single most useful next investigation, and the evidence that would
   settle it. If a rival reading fits better, argue it from the lexicons and the
   morphology — not from any traditional rendering.

Be direct: tell me if the indication is weak. I would rather rebuild it than defend it.`,
  },
];
