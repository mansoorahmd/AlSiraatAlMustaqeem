# UI Action Plan v2 — The Investigation

> Supersedes the v1 "focus + side panels" plan. That design was a scholar's
> workbench; this one is a **detective's study**. Reading the Quran becomes
> investigative work: noticing a word, opening a case, gathering every place
> the Book itself uses it, forming a hypothesis, and only then checking the
> dictionaries. Meaning is *earned from within the text* — the organic
> Quranic methodology, made tactile.

**Stack:** React SPA (Vite + TypeScript) in `app/`, over the FastAPI backend.
Research persists in `research.db` (SQLite) via `/research/*` routes. The old
`ui/` focus-panel prototype has been retired and removed.

Status: **V0–V9 done.** Research-first loop complete (research.db, slips,
form dossier, reader gloss & case marks, full lexicons) + V5 trails &
rare-root marks + V6 modern board (zoom/pan, arrange, word threads, segment
highlights, ayah cases, spelling variants, case navigation) + **V7 export**:
print-ready HTML report (→ PDF) and Markdown, with quran.com links,
highlights, threads, notes and cited references + **V8 focus lens** (pin a
case or any ayah as a reading lens; closest-first trail ranked by shared
phrase; ⊙ "why in focus" with base + surah; connections map) + **V9 notes &
questions** (notes/questions on ayahs and words, answerable questions, root/
form cross-references — shared between reader and board). Next: a global open-
questions view, curated case files (onboarding), or vault-wide lexicon export.

> **Pivot 1 (after V3 review):** cases are sparked by a *word*; the unit of
> work is the word **form**, not the root. The root's dictionary meaning is
> open *evidence* in the ledger from the start.
>
> **Pivot 2 (research-first, final):** there is **no reveal and no answer
> key**. Nothing is hidden behind a seal, because the thing being sought does
> not exist yet — it is *built*. The reader researches each form (ayah
> evidence + their own comments + cited references), then **submits an
> established meaning**. From then on the mushaf itself reflects the
> research: open-case forms are marked, established forms carry the reader's
> own interlinear gloss. First detective work — build, not guess.

---

## 1. Decided direction (locked)

| Decision | Choice |
|---|---|
| Core metaphors | Case board + trail expeditions + case files |
| Vocabulary mechanic | **Original research** — no reveal, no answer key; meanings are built and *established*, once, by the reader |
| Unit of research | The word **form** (lemma); root dictionary meaning is open reference evidence |
| Evidence kinds | Ayah cards + the reader's **comment slips** + **reference slips** (citations) — all live on the board, indexed per-form in the dossier |
| Establishing | Per form: submit a final meaning → status *established*; root-level verdict when evidenced forms are done (case may close *partial*) |
| Reader feedback | Open case on a form → mark on its words; established form → the reader's own **interlinear gloss** under the word (togglable) |
| Revision | Established meanings reopen with dated history — a visible research trail |
| Case unit | One case per **root family**, sparked by the word that was tapped |
| Case sources | Sparked while reading + hand-curated case files |
| Home | **Dual home** — Read and Investigate, two equal tabs |
| Gamification | None. The detective feel comes from interaction design |
| Audience | Built for general public later: onboarding, no jargon walls, shareable discoveries |
| Visual world | **Illuminated archive** — aged paper, ink, gold leaf, manuscript margins |
| Build path | Fresh start |

---

## 2. The core loop (what makes it detective work)

```
READ ──▶ NOTICE ──▶ OPEN CASE ──▶ RESEARCH ──────────────▶ ESTABLISH ──▶ THE MUSHAF ANSWERS BACK
 │        a word      the word's     per form, on the board:   submit the     open-case forms marked on
 │        tugs at     root FAMILY    ayah cards + your          form's final   the page; established forms
 │        you         becomes a      comment slips + cited      meaning        show YOUR interlinear gloss;
 │                    case file      reference slips;                          root verdict closes the case
 │                                   root core meaning open                    into the vault (or *partial*)
 └──────────────────────────── every jump leaves a visible trail ────────────────────────────┘
```

The crucial rules:

1. **Nothing is revealed — everything is built.** There is no answer key
   behind a seal. The meaning of a form in the Book's usage is the *product*
   of the case, not its hidden solution. Submitting an established meaning
   is the climax, and it is an act of authorship.
2. **The root's core meaning is reference evidence.** Lane, Mufradat et al.
   answer "what does ه-د-ي mean" — that sits open in the ledger. The
   interesting question — why هُدًى here and not هِدَايَة — is answered by the
   occurrences, the reader's reasoning, and the sources the reader cites.
3. **The research feeds back into reading.** Every word of a form under
   investigation carries a case mark; every word of an established form
   carries the reader's own gloss. The mushaf becomes progressively
   annotated by the reader's own scholarship — a personal tarjamah,
   earned form by form.

---

## 3. The three spaces

### 3.1 The Reading Room (tab 1 — "Read")

A beautiful, quiet mushaf reader. No panels, no noise. The detective layer is
*latent*: every word is quietly interactive.

```
┌──────────────────────────────────────────────────────────────┐
│  ٱقْرَأْ بِٱسْمِ رَبِّكَ ٱلَّذِى خَلَقَ ①                                    │
│                                                              │
│  margin →  ⚲ 3        (a small ink mark: "the root of this   │
│                        word appears 3 times nearby / N total)│
└──────────────────────────────────────────────────────────────┘
```

- Continuous ayah-after-ayah scroll, script toggle, font-size control,
  translation underlay (togglable, off by default — Arabic first).
- **Margin marks** (the "something is here" signal): faint, ink-drawn glyphs
  in the page margin, like a previous reader's pencil notes:
  - `⚲ n` — a word in this line has a root with *n* occurrences elsewhere
    (only shown for interesting counts: rare roots, or roots you're tracking).
  - `≡` — this exact phrase recurs verbatim elsewhere in the Book.
  - `✦` — a word from your vault appears here (you've met this root before —
    it lights softly in your vault's ink colour).
- **Long-press / click a word** → a small ink-stamp menu:
  *"Open a case"* · *"Follow the thread"* · *"Show root"* (only if already
  in your vault — otherwise the meaning stays sealed).
- **Open a case** slides the word out of the page like pulling a card from a
  file — transition into the Case Board with that word as the subject.
- **Follow the thread** starts a *trail* (see 3.4) without the full case
  ceremony: quick hop from occurrence to occurrence.

Design intent: the page looks like a manuscript someone before you has been
annotating. Reading stays serene; curiosity has handles everywhere.

### 3.2 The Case Board (tab 2 — "Investigate")

The heart. An **illuminated archive desk**: parchment surface, evidence cards,
ink threads connecting them, a case ledger on the side.

```
┌────────────────────────────────────────────────────────────────────┐
│ CASE: the root ك-ت-ب        status: OPEN     [seal: unbroken 🔏]   │
├──────────────────────────────────────────────┬─────────────────────┤
│                                              │  CASE LEDGER        │
│   ┌────────┐        ┌────────┐               │                     │
│   │ 2:282  │━━━━━━━━│ 96:4   │               │  Subject: كتب       │
│   │ …كاتب… │  same  │ …القلم… │               │  18 of 319 clues    │
│   └────────┘  root  └────────┘               │  examined           │
│        ┃                                     │                     │
│   ┌────────┐        ┌────────┐               │  YOUR HYPOTHESIS    │
│   │ 6:12   │        │ 58:22  │               │  ┌───────────────┐  │
│   │ كتب على │━━━━━━━━│ كتب في  │               │  │ "to fix/bind  │  │
│   │  نفسه   │ same   │ قلوبهم  │               │  │  permanently, │  │
│   └────────┘ pattern └────────┘               │  │  not just     │  │
│                                              │  │  'write'…"    │  │
│   (drag cards, draw threads, group clusters) │  └───────────────┘  │
│                                              │  [ Commit & break   │
│                                              │    the seal ]       │
├──────────────────────────────────────────────┴─────────────────────┤
│  EVIDENCE DRAWER: all occurrences of the subject, as cards to pull │
│  up · filterable by form (كِتَاب / كَاتِب / مَكْتُوب…) · sorted by surah  │
│  or by revelation order · each shows the ayah with the word inked  │
└────────────────────────────────────────────────────────────────────┘
```

Mechanics:

- **Evidence cards.** Each occurrence of the subject (root, word form, or
  phrase) is a card: ayah text with the subject word highlighted in ink,
  verse key as a stamped label, one-line context. Pull cards from the drawer
  onto the board; arrange them freely (spatial memory is the point).
- **Threads.** Draw a thread between two cards and *label it yourself*:
  "both about covenant", "same preposition follows", "opposite contexts".
  The system also offers computed threads (same form, same morphological
  pattern, shared second root in the ayah — from `/similar` and
  `/roots/{root}/linkages`) as faint dotted lines you can accept (ink them)
  or dismiss. Your threads are ink; machine suggestions stay pencil.
- **Clusters.** Lasso cards into a named group ("كتب = decree contexts",
  "كتب = scripture contexts"). Clusters become the skeleton of your
  hypothesis — most roots resolve into 2–4 usage senses, and discovering
  that *yourself* is the payoff.
- **Comment & reference slips.** Besides ayah cards, two more kinds of paper
  go on the board: **comment slips** (the reader's observations and
  arguments, in their own hand) and **reference slips** (citations — a
  lexicon entry, a tafsir passage, a book & page, a lecture, a URL — each
  with the reader's note on what it contributes). Slips are draggable,
  threadable to ayah cards and to each other, and clusterable — the board is
  the full research surface. Every slip is tagged to a form (or to the root
  itself) and indexed in the dossier.
- **The form dossier.** The ledger lists every form (lemma) of the family:
  occurrence count, evidence count (cards + slips), research status —
  *untouched → under investigation → established*. The root's core meaning
  (all dictionaries) sits above them, open, as reference. Each form row
  opens its research view: its slips, its cards, and the **establish slip**.
- **Establishing a meaning.** When the research satisfies the reader, they
  write the form's final meaning — concise, their own words — and submit.
  The form is stamped *established* (the ceremonial flourish). No reveal
  follows, because there is nothing left to reveal: the established meaning
  IS the product. It immediately begins appearing in the reader as the
  form's interlinear gloss.
- **Verdict & closing.** Once every form with evidence has been established,
  the root-level verdict slip unlocks: the synthesis of the family. Closing
  stamps the case and files it. Untouched forms leave the case *partial* —
  reopenable, honest. Established meanings can be **reopened** later (a new
  context that doesn't fit); prior meanings are kept as dated revisions, a
  visible research history.
- A case's subject can also be a **phrase** (from `/phrase-search`) or a
  **whole ayah** (evidence = related ayahs from `/similar`) — same board,
  same mechanics.

### 3.3 The Vault (accessible from both tabs)

Your personal lexicon — the *product* of the research, built entirely from
your cases.

- One **family page** per root: your root verdict on top, then each form
  with its established meaning, its revision history, and its evidence
  (cards, comment slips, cited references). The board is kept as a
  reopenable snapshot. Dictionary entries for the root sit alongside as the
  reference material they always were.
- **Re-encounter flow:** when reading and you meet an established form in a
  *new* context that doesn't fit your meaning, one tap adds that ayah to the
  case as new evidence and reopens the form — the old meaning is kept as a
  dated revision. Understanding is living, and its history stays visible.
- Export: any vault entry or case board → shareable image/PDF (the
  "shareable discoveries" hook for the public audience later).

### 3.4 Trails (the connective tissue)

A lightweight expedition mode for when a full case is too heavy:

- From any word: *Follow the thread* → jump occurrence to occurrence across
  surahs. Each hop is drawn onto a **trail map** — a horizontal strip of the
  114 surahs (sized by length) where your path arcs from point to point,
  like a travel route on an old map.
- The trail strip is persistent at the bottom edge, collapsible. Click any
  point to jump back. A trail can be promoted to a case ("this deserves a
  board") with all visited ayahs pre-loaded as evidence.
- Trails are saved with names ("the قلب thread, morning of…") and are
  themselves shareable artifacts.

### 3.5 Case Files (hand-curated)

Authored mysteries with narrative framing, for onboarding and depth:

- **Format:** one markdown/JSON file per case in `cases/`:
  `{ id, title, framing question, subject (root/phrase/ayah-set), ordered
  clue list (verse keys + optional per-clue prompt), author commentary
  (sealed until the user's verdict), difficulty }`.
- Example framings: *"This root appears exactly 7 times — trace what it
  binds together."* · *"Two words translators render identically. The Book
  never uses them interchangeably. Find the difference."* (خوف vs خشية) ·
  *"A phrase repeated verbatim in 3 distant surahs — what do the three
  contexts share?"*
- Curated cases run on the same board, but the evidence drawer releases
  clues **in the authored order** with per-clue prompts — a guided
  investigation. Author commentary sits under a second seal, opened only
  after the user's own verdict.
- The first 3–5 curated cases *are* the onboarding: no tutorial screens,
  just a first case simple enough to teach the loop ("case zero").

---

## 4. Visual language — the illuminated archive

- **Surfaces:** warm parchment tones, subtle paper grain; deep ink-brown
  text; board surface slightly darker (a leather desk pad).
- **Accents:** gold leaf for the focus/subject word only (used sparingly, it
  must stay special); lapis blue for your own ink (threads, hypotheses,
  verdicts); faded graphite for machine suggestions.
- **Iconography:** hand-drawn glyph style — margin marks, thread anchors,
  the wax seal, stamp labels. No flat modern icon set.
- **Typography:** KFGQPC Uthmanic / Amiri Quran for Quranic text (large,
  generous line-height, all four script variants supported); a humanist
  serif for UI/annotations (feels written, not printed); user's hypothesis
  rendered in an "ink handwriting" style face.
- **Motion:** paper-native — cards slide/settle with slight rotation,
  threads draw like ink flowing, the seal breaks once and stays broken.
  Nothing bounces. Reduced-motion mode honoured.
- **RTL:** Quranic content and board cards RTL; chrome LTR; numerals
  configurable.
- Light theme is primary (parchment); a "candlelight" dark theme later.

---

## 5. Backend & data

**Existing endpoints cover the investigation data fully:**
`/chapters`, `/chapters/{id}/verses`, `/verses/{key}` (+words/scripts/
translations), `/verses/{key}/similar` (now returns `phrase_run`, the matched
root run), `/verses/{key}/neighbours`, `/roots/{root}` (+forms/occurrences/
linkages), `/phrase-search`, `/search`.

**Research store (`research.db`, read-write) — `/research/*`:**
`cases`, `form-status`, `trails`, and **`notes`** (GET `?verse=|root=|lemma=`,
PUT, DELETE) — notes/questions on ayahs/words with answers + root/form
cross-references (V9). Schema self-migrates additively on connect.

**New needs (user-generated data):**

| Data | v1 storage | later |
|---|---|---|
| Cases (board layout, cards, threads, clusters, hypothesis, verdict, seal state) | localStorage/IndexedDB (local-first) | backend + accounts |
| Vault entries | local-first | backend + accounts |
| Trails | local-first | backend |
| Curated case files | static JSON bundled with the app | CMS/authoring tool |
| Margin-mark hints | computed client-side from `/verses/{key}/words` (+ a small root-frequency map fetched once) | precomputed endpoint `GET /chapters/{id}/marks` if slow |

One likely backend addition: `GET /roots/frequencies` (root → total count),
one cheap call cached forever, powering margin marks and "rare root" signals.

**The seal is a client-side discipline:** the app fetches root data lazily and
simply does not render `meaning_*`/`root_meanings` until commit. (Being
technically bypassable is fine — the user is only cheating themselves.)

---

## 6. State model (sketch)

```
appTab        : 'read' | 'investigate' | 'vault'
reading       : { surahId, scrollPos, script, translationOn, fontScale }
activeCase    : { id, subject: {type:'root'|'phrase'|'ayah', value,
                                sparkVerseKey?, sparkWordPos?, sparkForm?},
                  cards[{verseKey, wordPos, x, y, rotation}],
                  slips[{kind:'comment'|'reference', form?, text,
                         source?, locator?, x, y, rotation}],
                  threads[{from, to, label, source:'user'|'suggested'}],
                  clusters[{name, cardIds[]}],
                  formResearch: { lemma → {meaning, status:'open'|'established',
                                           establishedAt, revisions[]} },
                  verdict, status:'open'|'partial'|'closed',
                  curatedId?, revealedClueCount? }
vault         : { rootArabic → {verdict, confidence, caseId, unsealed:true} }
trails        : [{name, hops[{verseKey, wordPos}], createdAt}]
activeTrail   : index | null
server cache  : keyed (endpoint, params)
```

---

## 7. Milestones

The app lives in `app/` (fresh build; the old `ui/` focus-panel prototype was
retired and deleted). Research is stored server-side in `research.db` via the
FastAPI `/research/*` routes; UI prefs stay device-local. Every milestone
below is **shipped and verified** (tsc + vite build) unless marked otherwise.

### V0 — Foundation ✅
Vite + React + TS scaffold; typed API client; dual-tab shell
(Read / Investigate / Vault), hash-routed; local persistence layer.

### V1 — The Reading Room ✅
Mushaf reader: surah index + continuous scroll, script toggle
(Uthmani / Imlaei / IndoPak), font scaling, optional translation underlay.
Word tap → ink-stamp menu. Correct word-position tokenizer (waqf/sajda marks
carry no position, so root/gloss alignment is exact across scripts).

### V2 — Case creation & evidence drawer ✅
"Open a case" from any word → root-subject case. Evidence drawer of all
occurrences, filterable by form, sortable by mushaf / revelation order,
rendered in the selected script.

### V3 — The board ✅
Draggable cards (persisted); user-drawn threads with labels; clusters;
computed pencil suggestions (accept/dismiss, idempotent).

### V4 — Research-first core ✅
Comment + reference slips (source/locator/note), form-tagged, threadable,
clusterable. **Form dossier** replaces the sealed ledger: root core meaning
open as sourced reference; per-form status untouched → investigating →
established; establish flow; root verdict + close (full/partial); reopen with
dated revisions. Reader integration: dotted case marks on open forms, the
reader's own interlinear gloss on established forms (togglable), ⚖ evidence
marks + ✒ ayah-understanding panels. Vault = family pages from research.db.
Nothing is sealed — meanings are **built**, not revealed.

### Storage ✅
`research.db` (SQLite) + `/research/*` API; one-time IndexedDB→server
migration; hybrid schema (JSON case doc + queryable `form_research` /
`form_revisions`) driving reader marks and the gloss.

### V5 — Trails & rare-root marks ✅
Root-frequency map → ⚲ rare-root marks. "Follow the thread" expeditions with
the 114-surah trail strip (manzil-tinted track, prominent multi-occurrence
dots), prev/next through occurrences, saved-trails shelf, promote-to-case.

### V6 — Modern board & richer cases ✅
Full theme flip to the modern light look (tokens-level; retired the
illuminated-archive parchment). Board rebuilt as a clean canvas: CAD-style
zoom/pan, **⇤ Arrange** (group by form, mushaf order, height-aware rows),
word-anchored threads with auto-labels, **🖍 highlighter** (translucent washes,
per-card), **ayah cases** (related-ayah drawer via `/similar`, ayah dossier
with per-word root links), **✍ spelling-variant** badges (dagger-alif etc.,
compared on the morphology stem so prefixes don't false-flag), case→case
`‹ back` navigation, merged same-form dossier rows.

### V8 — The focus lens ✅
Pin a case (root or ayah) **or any ad-hoc ayah** as a reading lens from the
nav panel's **Focus** dropdowns (a saved-case lens and an ayah lens, mutually
exclusive; ad-hoc ayah uses a synthetic `ayah:<key>` id so nothing is written
to research). The mushaf then lights every echo: shared-root words in gold,
linked roots (linkage graph) softly tinted, ayahs matching by POS structure
marked with a left stripe, and every matching ayah carrying a ⊙ focus mark.

Enhancements shipped after the first cut:
- **⊙ "why in focus"** panel — explains each match: the shared **phrase**
  (longest contiguous run of shared roots, rendered as isolated-letter chips),
  the individual shared roots, and a **same-structure** POS comparison. Every
  reference names the **base** it compares against, with verse key **+ surah
  name** (e.g. "62:2 · Al-Jumuʿah"), on both rows.
- **Closest-first trail** — the ayah lens ranks matches by longest shared
  phrase, then phrase strength, then the engine's blended score (backend now
  returns `phrase_run`, the actual matched root run), instead of mushaf order.
- **Base ayah always visible** — the sticky banner carries the base ayah's
  full text (clickable to jump back) so it stays readable while hopping across
  surahs.
- **Connections map** — the banner's "⊞ closest first · map" opens a modal
  laying out every linked ayah grouped by surah (strongest-linked surah
  first), heat-tinted by closeness, ● marking shared-phrase matches, with
  direct jump — replacing purely linear stepping. (`FocusMap`.)

A sticky focus banner still shows the lens, legend, and **‹ N/total ›**
stepper. Trail hops also gold-light the exact matched word.

### V9 — Notes & questions ✅
A cross-cutting annotation layer, independent of cases, stored in a new
`notes` table in research.db (`/research/notes` GET `?verse=|root=|lemma=`,
PUT, DELETE). The reader attaches **notes** or **questions** to a whole ayah
or a specific word, and they surface in both spaces:
- **Reader** — a ✎ toggle by each ayah number (with count) opens the notes
  panel; the word menu adds word-scoped notes; a word carrying a note gets a
  subtle dotted underline.
- **Board** — each evidence card has a ✎ notes toggle opening the same panel,
  so a note written while reading appears on the board and vice versa.
- **Answerable questions** — a question has a real `answer` field (green
  block); writing an answer resolves it, "reopen" clears it.
- **Cross-references** — word notes store the word's `lemma` (exact form) and
  `root`. The word menu shows "🔗 N notes on this root · M open ?", split into
  **same word** and **other forms of the root**, each with a jump link — so an
  open question on one form is visible from every occurrence of the word/root.
- Reusable `NotesPanel` + `RelatedNotes`; shared component `VerseText` gained
  a `hasNoteFor` marker. Additive schema migration for pre-V9 databases.

### V7 — Export ✅
Per-case **⇩ Report** (standalone print-ready HTML → PDF: gold subject words,
preserved highlights, quran.com links, threads, notes, numbered references,
A4 print CSS) and **⇩ MD** (Markdown with `==highlights==` and links).

### Remaining / future (not committed)
- **Global open-questions view** — a toolbar badge / panel listing every
  unanswered question across the Book, not just when the word is tapped.
- **Curated case files** — authored mysteries with ordered clues; the first
  is onboarding ("case zero"). *(Adapted for research-first: author notes
  appear as peer comparison after you establish your own meaning — no
  answer-key seal.)*
- **Vault-wide export** — the whole vault as one publishable annotated lexicon.
- **Polish** — keyboard nav, ARIA/RTL screen-reader pass, reduced-motion,
  virtualized reader for long surahs, a one-click `research.db` backup.
- **Phrase marks** (≡ verbatim-repeat) in the reader; multi-subject cases;
  dark theme; revelation-order reading mode.

---

## 8. Component inventory

- `AppShell` (tabs, theme, persistence provider)
- Reading Room: `Reader`, `AyahBlock`, `WordToken`, `MarginMarks`,
  `InkStampMenu`, `ScriptToggle`, `SurahNav`
- Case Board: `CaseBoard` (pan/zoom canvas), `EvidenceCard`, `Thread`,
  `ClusterLasso`, `EvidenceDrawer`, `CaseLedger`, `HypothesisSlip`,
  `WaxSeal`, `VerdictPanel`
- Vault: `VaultIndex`, `RootPage`, `ConfidenceMark`, `ReencounterPrompt`
- Trails: `TrailStrip` (114-surah map), `TrailHop`, `TrailShelf`
- Focus lens: `focus.ts` (spec builder), focus banner, `FocusMap` (connections
  modal)
- Notes: `NotesPanel` (notes/questions + answers), `RelatedNotes` (root/form
  cross-references)
- Curated: `CaseFileLoader`, `CluePrompt`, `CommentarySeal`
- Shared: `Popover`, `Stamp`, `PaperCard`, export renderer

---

## 9. Open questions

1. Case board on mobile — full board with pan/zoom, or a simplified
   stacked "evidence list + clusters" view for small screens?
2. Should curated cases allow audio (recitation of each clue ayah) in v1,
   or defer? (Word audio URLs already exist in the DB.)
3. Trail strip geometry — surahs sized by verse count, or equal-width for
   legibility?
4. When a case subject is a root, should the evidence drawer default to
   *all* occurrences (can be 300+) or a curated slice (rare forms first,
   distinct contexts via `/similar` diversity)?
5. Working name for the app itself — worth choosing early since it shapes
   the archive's "voice" (stamp texts, seal insignia).
