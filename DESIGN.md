# MQ Research Gate — Design

> A **detective's study** for the Qur'an. Reading becomes investigative work: notice a
> word, open a case, gather every place the Book itself uses it, form a hypothesis, and
> only then weigh the dictionaries. Meaning is *earned from within the text* — the
> organic Qur'anic methodology, made tactile.

**Stack:** React + Vite + TypeScript SPA (`app/`) over a Hono + `node:sqlite` backend
(`server/`, ported 1:1 from the old FastAPI service and parity-tested). An MCP server
(`mcp/`) exposes the corpus and research to an AI. Content lives in `quran.db`
(read-only); the reader's work in `research.db` (read-write, self-migrating).
UI conventions (symmetry/alignment, paper aesthetic) are in `INSTRUCTIONS.md`.

This file is the design reference. The per-version build log lives in git; a short digest
is at the end.

---

## 1. Direction (locked)

| Decision | Choice |
|---|---|
| Core metaphors | Case board + trail expeditions + case files |
| Vocabulary mechanic | **Original research** — meanings are *built* and *established* by the reader, not looked up. The gate is **status, not visibility**: others' readings may be visible, but your own dated establishment stands as a separate record of what *you* held |
| Unit of research | The word **form** (lemma); the root's dictionary meaning is open reference evidence |
| Evidence | Āyah cards + the reader's **comment slips** + **reference slips** (citations), on the board, indexed per-form in the dossier |
| Establishing | Per form: submit a meaning → *established*; a root-level verdict when the evidenced forms are done (a case may close *partial*) |
| Feedback into reading | Open-case forms are marked on the page; established forms carry the reader's own interlinear gloss (togglable) |
| Case unit | One case per **root family** (or a **phrase/theme** case), sparked by the tapped word |
| Gamification | None — the detective feel comes from interaction design |
| Visual world | **Illuminated archive** — warm paper, ink, gold leaf, manuscript margins |

## 2. The core loop

```
READ → NOTICE a word → OPEN CASE (its root family) → RESEARCH (āyah cards + your
comment/reference slips; root core meaning open) → ESTABLISH the form's meaning →
THE MUSHAF ANSWERS BACK (open forms marked, established forms show your gloss)
```
Every jump leaves a visible trail. Three principles hold it together:

1. **Meaning is built, not looked up.** There is no answer key handed to you; the meaning
   is the *product* of the case. Others' established readings may be visible (see the shared
   research layer, `SHARED_RESEARCH.md`), but what distinguishes your scholarship is that
   your own establishment is a **separate, dated record of what you yourself held** —
   standing alongside the group's, never overwritten by it. *(The earlier framing "nothing
   is revealed" is retired: the gate is status, not visibility.)*
2. **The root's core meaning is reference evidence**, not the answer. The interesting
   question — why هُدًى here and not هِدَايَة — is settled by the occurrences, the reader's
   reasoning, and the sources they cite.
3. **Research feeds back into reading.** The mushaf becomes progressively annotated by
   the reader's own scholarship — a personal tarjamah, earned form by form.

## 3. The spaces

- **Read** — a quiet mushaf reader; every word is latently interactive. Margin marks
  (rare-root ⚲, repeated-phrase ≡, vault ✦), a word menu (open a case, follow the word,
  notes/questions), all four scripts, optional translation underlay (off by default).
- **Investigate** — the case archive ↔ a **full-page canvas** case desk (n8n-style): a
  dot-grid board of evidence cards and slips with zoom/pan, threads (card↔card or to a
  specific word), colour-coded clusters, and Arrange. Board controls live in a floating
  **Tools** popover; **Evidence/Related āyāt**, **Dossier** and **Details** open as right
  side-sheets from a FAB stack. AI proposals are reviewed here, never auto-applied.
- **Study** (menu) — **Roots** explorer + lexicon pages, **Motifs** (بيوت), **Compare**
  workspace, **Vault** of established roots.
- **Trails** — the connective tissue: walk a root family or one exact written word
  occurrence-by-occurrence; promotable to a case.
- Cross-cutting: **Home** dashboard, **⌘K command palette** (jump to āyah/root/case or
  search), one **activity bell** (proposals to review + open questions).

## 4. Visual language

Warm parchment surfaces with subtle grain; deep ink-brown text. **Gold** for the
focus/subject word only (kept special); **lapis** for the reader's own ink (threads,
verdicts); faded graphite for machine suggestions. Hand-drawn glyph iconography.
KFGQPC/Amiri for Qur'anic text (generous leading, all four scripts); a humanist serif for
UI. Paper-native motion, reduced-motion honoured. Qur'anic content + board cards RTL,
chrome LTR, numerals configurable (āyah marks use Western digits inside RTL brackets).

## 5. Backend & data

Corpus endpoints cover the investigation: `/chapters`, `/verses/{key}` (+words, scripts,
similar, echoes, spelling), `/roots/{root}` (+forms, occurrences, linkages),
`/words/occurrences`, `/phrase-search`, `/search`. Research is `research.db` via
`/research/*` (`cases`, `form-status`, `trails`, `notes`, `word_indications`,
`compare_sets`, `/research/proposed`); the schema self-migrates additively on connect.
`notes` and `word_indications` carry a `source` (`me`/`ai`). See `INSTRUCTIONS.md` for the
full schema and the MCP write boundary.

A planned **shared research layer** (`SHARED_RESEARCH.md`) adds an optional, invite-only
remote for publishing and peer-reviewing work — local study stays offline and account-free.
Two channels share only a login: the **corpus** flows one-way down as signed, versioned
**static patch files** (not a hosted DB — corrections are releases, applied in order); the
**research** channel carries submissions up and pulls down into `derived`, drop-safe tables
that sync can rebuild and never lets a bug touch your own work. Globally-established readings
coexist with your local ones; disagreement is preserved as **dissent**, not resolved away.

---

## Build history (digest)

Shipped **V0–V22**. Detail is in git; this is the shape of the arc.

- **V0–V4** — foundation, Reading Room, case creation + evidence drawer, the board, and
  the research-first core (per-form research, establish/verdict, reader gloss & marks).
- **V5–V6** — trails & rare-root marks; the modern board (zoom/pan, arrange, word
  threads, segment highlights, āyah cases, spelling variants, case navigation).
- **V7–V10** — print/Markdown **export**; the **focus lens** (pin a case/āyah as a
  reading lens); **notes & questions** (+ global open-questions view); verbatim **echoes** (≡).
- **V11–V15** — research **home** dashboard; **Roots** explorer & lexicon pages;
  **search** + Arabic keyboard + shortcuts; collocations + **Motifs**; occurrences-by-form
  + the **compare** workspace (V15.1: named, saveable comparisons).
- **V16–V18** — **word indications** (several switchable meanings per word, with per-form
  refinements); **follow the exact word** (rasm, rootless words); reader & root-page polish.
- **V19–V21** — the **MCP server** (study the corpus with an AI); **AI write access to the
  Investigate board** (add-only, tagged, never primary, version-checked — proposals the
  reader accepts); the case **report rebuilt as an argument** (+ phrase cases, āyah notes,
  bidi fixes) and a run of *silent* corpus bugs fixed (trace_word totals & 30× under-report,
  study_root homograph counts, the tatweel that broke "follow this word", the
  waw-for-alif spelling family, indication homograph matching).
- **V22** — **chrome & navigation**: rename to *MQ Research Gate*; top-bar hierarchy
  (Home/Read/Investigate + Study menu), ⌘K palette, merged activity bell; the **full-page
  canvas** case desk with FAB side-sheets and a grouped floating Tools popover; per-cluster
  colours; and the alignment discipline recorded in `INSTRUCTIONS.md`.

## Open questions / not yet built

- **`?` shortcuts overlay** — the keyboard shortcuts work but are undiscoverable; and the
  `g`-chord targets still map to the pre-V22 tab letters.
- **Curated case files** — authored investigations with ordered clues (author notes shown
  as peer comparison *after* you establish your own meaning — no answer-key seal).
- **Mobile** — full pan/zoom board vs. a stacked "evidence list + clusters" view.
- **Reach** — vault-wide export as a publishable annotated lexicon; shared `/shared` types
  + a mobile client; multi-subject cases; a candlelight dark theme; revelation-order mode.
- **Accessibility polish** — keyboard nav, ARIA/RTL screen-reader pass, reduced-motion,
  a virtualized reader for long surahs, one-click `research.db` backup.
