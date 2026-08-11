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

Status: **V0–V20 done.** Research-first loop complete (research.db, slips,
form dossier, reader gloss & case marks, full lexicons) + V5 trails &
rare-root marks + V6 modern board (zoom/pan, arrange, word threads, segment
highlights, ayah cases, spelling variants, case navigation) + **V7 export**:
print-ready HTML report (→ PDF) and Markdown, with quran.com links,
highlights, threads, notes and cited references + **V8 focus lens** (pin a
case or any ayah as a reading lens; closest-first trail ranked by shared
phrase; ⊙ "why in focus" with base + surah; connections map) + **V9 notes &
questions** (notes/questions on ayahs and words, answerable questions, root/
form cross-references — shared between reader and board) + **global open-
questions view** (toolbar ❓ badge + dropdown of every unanswered question,
jump-to-ayah).

> **Backend migrated to TypeScript** (see `BACKEND_TS_MIGRATION.md`): the
> FastAPI service was ported 1:1 to `/server` (Hono + node:sqlite), parity-
> tested, and is now the sole backend. One npm workspace, `npm run dev`.

Also shipped: **V11** research home (dashboard + resume-reading), **V12** Roots
explorer & lexicon pages, **V13** search + on-screen Arabic keyboard + keyboard
shortcuts, **V14** root collocations + Motifs (بيوت), **V15** occurrences-by-form
+ the compare workspace. See below. Later: curated case files, reader
polish/accessibility.

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
  hypothesis — most roots resolve into 2–4 usage indications, and discovering
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

### Global open-questions view ✅
Toolbar **❓ badge** (gold count) opening a dropdown of every unresolved
question across the Book — each with its location (verse key · surah, word in
gold) and a jump-to-the-ayah action; answered questions drop off. Backend
already served it via `/research/notes`; frontend `OpenQuestions` + badge.

### V10 — Verbatim echoes (≡) ✅
The Book's own repetition, surfaced. Contiguous phrases that recur **word-for-
word** across the Quran (refrains like *fabiʾayyi ālāʾi rabbikumā tukadhdhibān*,
recurring formulas, the basmala) are detected and marked in the reader.

Design:
- **Backend** — an `EchoIndex` over folded surface words (`text_imlaei_simple`),
  built once and cached. Indexes contiguous word n-grams (min 3, capped length)
  and keeps those occurring in ≥2 distinct verses.
  - `GET /chapters/{id}/echoes` → verse keys in the chapter that contain a
    repeated phrase (cheap bulk signal for reader marks).
  - `GET /verses/{key}/echoes` → the maximal repeated phrases in that verse,
    each with its text and the other verse keys where it occurs.
- **Reader** — a ≡ mark by the ayah number when the ayah carries an echo; a
  tap opens a panel listing each repeated phrase and everywhere else it appears,
  with jump links (like a ready-made trail). Reuses the existing mark/panel
  pattern; no fragile sub-word highlight in v1.
- New: `EchoPanel` component; `VerseText`/`AyahBlock` echo mark; server
  `echoes.ts` + routes; unit tests over known repeats.
- **v2 shipped:** inline **amber highlight** of the exact repeated span
  (positions come straight from the index, so no fragile fold-matching);
  **echo lens** — clicking an occurrence jumps there and lights the phrase in
  place; **compare here** — pulls the other ayahs *inline*, stacked and
  highlighted, so you read them without leaving your spot; each labelled with a
  full **verse key · surah name** reference.

### V11 — Research home (dashboard) ✅
The workbench you return to. A **Home** tab (the default landing) that ties the
scattered research artifacts into one view, each with a one-click jump:
- **Continue reading** — resumes at the exact last ayah you viewed. The reader
  tracks the top-most ayah in view (IntersectionObserver) into device-local
  `reading.lastVerseKey`; the tile jumps there and shows verse key · surah.
- **Open cases** — open/partial investigations (subject, desk size).
- **Open questions** — unanswered questions across the Book.
- **Recent trails** — expeditions to resume.
- **Established meanings** — count of forms you've settled → the Vault.
- **Explore the roots** — link into V12.
Read-only over existing stores (`archive.cases/trails/notes`, `form-status`);
`Home` screen + `home` tab.

### V12 — Roots explorer & lexicon pages ✅
A **Roots** tab (also linked from Home) listing every root in the Book:
- **Order rarest → most common** (default) or the reverse — the rarest roots
  carry the most distinctive language. Client-side sort/filter over all ~1,600
  roots (filter by English meaning or Buckwalter/Arabic).
- Click a root → a full **lexicon page** (`RootDetail`): every dictionary
  meaning grouped by source (Lane's, Hans Wehr, Lisān al-ʿArab, Mufradāt, …),
  the derived **forms** with counts, and **every occurrence** as clickable ayah
  chips that jump into the reader with the word lit.
- **My meaning** — the reader's own definition for a root, saved to a new
  `user_root_meanings` table in research.db (`/research/root-meanings`), sitting
  beside the dictionaries as a personal source. Read-only display with an
  ✎ Edit/Add button; editor with Save/Cancel + status.
- New: `RootsExplorer`, `RootDetail`; server route group; `archive.rootMeanings`.

### V13 — Search + Arabic keyboard + shortcuts ✅
A front door onto the search engine that already existed (no backend work):
- **Search** tab with two modes — **Phrase** (verbatim, alef-insensitive,
  `/phrase-search`) with the matched span washed amber in each result, and
  **Related** (free-text Arabic → ayahs by shared roots/structure, `/search`),
  showing the roots it resolved. Debounced; click a result to read it.
- **On-screen Arabic keyboard** (`ArabicKeyboard`) — tappable letters + hamza
  forms; used by Search and the Roots filter, so no system Arabic layout needed.
- **Keyboard shortcuts** (`Shortcuts`): `/` → Search; `g` then h/r/s/i/v/o →
  the tabs; `j`/`k` → next/prev ayah in the reader.

### V14 — Collocations + Motifs (بيوت) ✅
Turning the root page into an investigation surface, and letting the reader
group roots by their own themes:
- **Collocations** — "the company it keeps": on a root's page, the roots it most
  co-occurs with in the same ayah, ranked by association strength (surfacing the
  already-built linkage engine, `/roots/{root}/linkages`). Each is clickable to
  open that root's page (a shared `openRoot` store action drives cross-nav).
- **Motifs (بيوت)** — reader-defined collections of roots sharing a linguistic
  motif. Tag a root into an existing or new motif from its page; a **Motifs**
  tab browses them all (member roots as chips → open the lexicon page; inline
  rename; delete). Stored in `motifs` + `motif_roots` in research.db
  (`/research/motifs`); `archive.motifs`, `Motifs` screen.

### V15 — Occurrences-by-form + compare workspace ✅
- **Occurrences grouped by form** on the root page: a root's ayahs are clustered
  under each derived form (lemma) with its POS + count, so the reader can see
  how the indication shifts form-to-form (noun هُدًى vs verb يَهْدِي …). Frontend-only.
- **Compare workspace** — pin ayahs and roots (⇋ button on each ayah and on a
  root's page) and study them together in the **Compare** tab. Enables the classic
  near-synonym (عَلِمَ / عَرَفَ) and parallel-passage exercises.

### V15.1 — Named, saveable comparisons (parity with mobile) ✅
- The compare tray became a set of **named, saved comparisons** — persisted in
  research.db (`compare_sets` + `compare_items`, routes under
  `/research/compare-sets`, `archive.compare` client, `compare/ops.ts`). No longer
  session-only.
- Two views: a **list** of saved comparisons (title · count · updated · active
  flag; rename, delete, ＋ New) and a **vertical timeline board** where each pinned
  item is a node on a thread. Roots **shared with the item above** are pinned atop
  the card (and washed in the verse via `focusFor`); a node **glows gold** when its
  item shares a root with any other. Cards collapse; ayah cards carry an inline
  **✎ Note** (same global note store) and a Read → jump; root cards show meaning,
  lexicons, collocations, Lexicon →.
- Pins land in the **active** comparison from anywhere (`useAddToCompare` +
  `addToActiveCompare`), confirmed by a transient **toast** ("Added to ‹name›").
  Active-set id is a device-local pref; the Compare tab badge = the active set's
  count. Store: `activeCompareSetId`, `compareTick`, `toast`.

### V16 — Word indications (several meanings per word, switchable) ✅
- A word (lemma) can now hold **multiple indications** — the different "feels" a word
  carries in different contexts (e.g. أَفْلَحَ as *attain/triumph* vs the
  *till/cultivate* undertone). Indications are **global to the lemma**, shown wherever
  the word appears. Backend: `word_indications` (id, lemma, root, label, meaning,
  is_primary) + `indication_assignments` (verse_key, word_position → indication) in
  research.db, routes under `/research/indications` and `/research/indication-assignments`.
- One indication is the **primary** (★) — the default gloss everywhere. You can also
  **pin THIS āyah's occurrence** to a specific indication ("use for this āyah"), which
  overrides the primary just there. First indication added is auto-primary; deleting
  the primary promotes the next; deleting an indication clears its assignments.
- Managed from the **word menu** (tap a word → *✒ Indications (N)*): list indications, add
  one (short label + meaning), set primary, delete, and assign the current
  occurrence. The menu header shows the indication active on this word ("— this āyah"
  or "— primary of N").
- The **reader gloss** resolves in order: per-āyah assignment → the word's primary
  indication → (fallback) the established case meaning. `IndicationsPanel`,
  `archive.indications`, Reader `indicationPrimary`/`indicationAssign` maps + `indicationTick`.

  **V16.2 — root indications + per-form refinements (final model).** Redesigned so
  indications are anchored at the **root** with per-**form** refinements:
  - A root holds several indications (its "feels"); **one is primary** (the default
    gloss). `word_indications` scope='root', `is_primary` unique per root.
  - Each root indication has a **refinement** for each form (lemma) — the shade that
    indication takes in that exact word. `word_indications` scope='lemma', `parent_id` = the
    root indication (added `parent_id` column, self-migrating). Forms not yet refined
    show an empty "complete for ‹form›" slot (**soft** — nothing blocked).
  - Reader gloss (Primary-only): this form's refinement of the root's primary
    indication → that indication's own text → established case meaning. Server `glossData()`
    returns primary-indication text per root + per-form refinements + rootless lemma
    primaries; Reader builds `indicationRefine`/`indicationRootText`/`indicationLemmaText` maps.
  - Rootless words (particles/names) keep a plain standalone lemma indication.
  - **Indication Editor modal** (`IndicationEditor`) — the meaning-setting surface: root
    header + core meaning; left rail lists the root's indications (add / pick primary /
    delete / rename); centre shows **every unique form of the root** with its own
    editable meaning for the selected indication (so any form can be set from one place,
    not just the tapped word), the tapped form pinned first and unfilled forms
    flagged; right rail is a **Dictionaries** panel (the root's lexicon entries)
    for lookup while writing. Opened from the word menu's ✒ Indications (rooted words)
    and from each form in the Investigate dossier. New endpoint
    `GET /indications/:id/refinements`.
  - Endpoints: `/indications/gloss`, `/indications/for-word`, `/indications/:id`(+`/primary`),
    `/refinements/:id`. Per-occurrence assignment removed (superseded by
    Primary-only). `IndicationsPanel` rebuilt (root indications + refinement editors +
    "N of M forms" completion); surfaced in the reader word menu **and** the
    Investigate form dossier.
- *Web only so far — mirror to mobile later.*

### V17 — Follow the exact word (parity with mobile) ✅
A thread could only follow a **root**, which left particles and proper names
unwalkable — they have no root at all. The word menu now offers both:

- **➶ Follow root** — every form of the family (unchanged behaviour).
- **➶ Follow this word** — only this exact written spelling (rasm; vowel marks
  ignored, so the same word in another case still matches). Available on *every*
  word, including rootless ones.

Server: `WordFormIndex` (`server/src/spellings.ts`) assembles each word's full
written surface from **all** segments — prefixes like وَ and ٱل are part of the
written word — and caches a rasm → occurrences map (~1s to build once, then
instant). Route `GET /words/occurrences?surface=&limit=`; tests in
`word-occurrences.test.ts` (rooted word, rootless مِن, prefix-sensitivity, limit).

Web: `TrailRecord.subjectKind` ("root" | "word", carried in the trail doc — no
migration), `startWordTrail`, and `TrailStrip` picks its occurrence source by
kind and tags the subject chip *root* / *word*. Promote-to-case is hidden on word
threads, since there's no root family to open a case on.

### V18 — Reader & root-page polish ✅
- **Āyah end mark carries the reference.** ﴿٢:١٢٧﴾ instead of ﴿١٢٧﴾ — surah and
  āyah — with the surah name on hover ("Al-Baqarah · 2:127") and in the aria
  label. `unicode-bidi: isolate` keeps the numerals in reading order inside the
  RTL line.
- **Long glosses are readable.** The corpus root gloss can be a paragraph (ن-ف-ق
  is 1,125 characters) and arrived as a centred, unclamped wall with entries glued
  together ("…another.nafaqan (n.acc.) hole…"). `tidyGloss()` spaces punctuation
  that is stuck to the next word (letters only, so "acc.)" and "3.5" survive);
  the block is left-aligned, clamped to 4 lines, with *show all*. Lexicon entries
  clamp to 8 lines each and the list now actually scrolls — `.wm-lex-list` had a
  `max-height` with no `overflow`, so entries past 15rem were unreachable.
- **Tapping the root opens its lexicon page.** The root in the word-menu header is
  now a link (hover shows "open root →"), keyed by `root_buckwalter` — not the
  Arabic form — so it lands on the same record the Roots explorer uses and your
  my-meaning / motif tags for that root are not split into a duplicate.
- **Collocations show their evidence.** Clicking a "keeps company with" chip opens
  the **āyāt where both roots occur** inline (verse key + text, click to read),
  with "open ‹root› →" still in the panel header. Server
  `RootLinkages.sharedVerses` + `GET /roots/:root/with/:other`; tests assert the
  count equals the `cooccur` that `/linkages` reports, plus symmetry, mushaf
  order, limit and 404s.

### V19 — MCP server: study the Book with an AI ✅
A third workspace, `mcp/`, speaking MCP over **stdio** so Claude Desktop / Claude Code can
work on the corpus and the reader's research directly. It reuses `server/src`'s query
layer via `createState()`, so it inherits every index (roots, echoes, spellings,
word-forms, linkages, similarity) without duplicating logic.

**Decided scope** — corpus read-only, research read + *limited* writes:

| | |
|---|---|
| Corpus | read-only, always |
| Translations | **not exposed** — meaning is built from Arabic, morphology and the lexicons |
| May write | notes/questions + indications with per-form refinements (see V20 for the board) |
| May never | edit or delete the reader's work, set an indication **primary**, or touch motifs/comparisons |
| Every write | tagged `source='ai'`, surfaced under **✦ Proposed** to accept or discard |

- **Tools, two layers.** Composed (`study_root`, `read_ayah`, `find_where_roots_meet`,
  `trace_word`, `search_quran`, `compare_forms`, `my_research_on`) so one call answers a
  study question; plus thin mirrors (`get_root`, `list_roots`, `get_verses`, `get_linkages`,
  `get_echoes`, `get_wazn`, `get_spelling_variants`, `get_similar_ayat`) as escape hatches.
- **Methodology travels with the server.** Resources `alsiraat://method` (the organic method
  and its hard rules), `alsiraat://write-policy`, `alsiraat://research/summary`; prompts
  `test_indication`, `study_ayah`, `review_my_root`. Every prompt is prefixed with the method,
  so a client inherits the rules — including the real loophole: the lexicons themselves quote
  the Qur'an and gloss words theologically, and those passages are later application.
- **Provenance + review.** `notes` and `word_indications` gained a `source` column
  (self-migrating), `/research/proposed` lists what an AI proposed, and
  `/research/proposed/:kind/:id/accept` adopts it. The app shows a **✦ Proposed** badge in the
  toolbar with accept/discard per record, and an `AI` tag on proposed indications in the editor.
- **Verified against a real MCP client** (`mcp/scripts/smoke.ts`, `npm run smoke -w @alsiraat/mcp`):
  17 tools listed with correct read-only annotations, composed tools returning real data,
  refusals surfacing as readable messages, and the database asserted afterwards.

> **Launching it is deceptively fragile** — two real failures, hence `mcp/bin/start.mjs`:
> **(a)** `npm start` prints its banner to **stdout**, which on stdio *is* the JSON-RPC channel,
> so the client fails with `Unexpected token '>', "> @alsiraa"...`. **(b)** `node --import tsx
> src/index.ts` fails too, because clients launch with an arbitrary working directory (Claude
> Desktop on Windows uses `C:\WINDOWS\system32` and ignores `cwd`) and `--import` resolves the
> loader relative to the CWD: `Cannot find package 'tsx' imported from C:\WINDOWS\system32\`.
> The launcher is plain `.mjs`, registers tsx resolved from **its own** location, suppresses the
> node:sqlite ExperimentalWarning, and explains itself if dependencies are missing. `index.ts`
> also routes `console.*` to stderr so a stray log in shared code cannot corrupt the protocol.
>
> Two bugs worth remembering, both caught by that smoke test rather than by reading:
> **(1)** `guard.sanitiseIndication` *deleted* the `primary` key instead of forcing it false —
> and `saveIndication` treats a missing flag as "first indication for this root becomes
> primary", so the AI's proposal silently became the reader's default gloss. It now sets
> `primary: false` explicitly. **(2)** `server/src/state.ts` resolves its database paths at
> *import* time, so setting `process.env` before calling `createState()` was too late; the MCP
> entry point imports it dynamically after settling the environment.

### V20 — MCP: read, create and write on the Investigate board ✅
The board was walled off in V19. It is now open — deliberately, and asymmetrically: an AI may
**add** freely and **change only what it added**, and may never draw the conclusion. Nine tools
(26 total): `list_cases`, `read_case` (read); `open_case`, `add_evidence`, `add_slip`,
`link_evidence`, `group_evidence`, `revise_own_item`, `propose_conclusion` (write).
`my_research_on` now really returns cases — its description had claimed so since V19.

| | |
|---|---|
| May create | cases on a root / phrase / āyah |
| May add | evidence āyāt, comment + reference slips, labelled threads, clusters |
| May change | **only items it authored** — the reader's are refused by id |
| May never | write `verdict`, `status` or `formResearch`; conclusions go to `proposals` |
| Reader applies | **✦ Proposed conclusions** on the desk — accept turns one into the verdict or an established form meaning; nothing else can |

- **The guard is structural, not advisory** (`mcp/src/cases.ts`). `saveGuarded()` restores
  `verdict`/`status`/`formResearch` from the *pre-write* document on every save, so even a buggy
  tool cannot apply a conclusion — the prohibition does not depend on each tool behaving.
- **Whole-document saves force optimistic concurrency.** A case is one JSON blob rewritten by
  `saveCase`, so there is no partial write and a concurrent app edit would be clobbered. Every
  board write carries the `updated_at` it last read (`expect_version`) and is **refused** if the
  case moved on. The AI re-reads and retries; the reader never loses an edit silently.
- **The AI never supplies board coordinates.** `placeItem()` walks a grid and returns the first
  slot that collides with nothing, so additions never land on top of the reader's layout.
- **Provenance lives inside the case JSON** — no migration. The subtle part: `SlipRecord.source`
  already means *the work being cited* and `ThreadRecord.source` *how a thread was offered*, so
  slips and threads carry provenance on `author`, and `isAiOwned` checks both fields
  **explicitly** rather than falling through one to the other. The first version did fall
  through — which would have read a reader's slip citing Lane's Lexicon as AI-authored and let
  the AI delete it. There is a test named for that trap.
- **Visible in the app.** AI cards/slips get a gold rule and a ✦ corner mark (title explains
  the origin); proposed conclusions render in a dashed panel on the desk with accept/discard.
- **Tested per prohibition** (`server/test/case-boundary.test.ts`, 11 tests): each refusal has
  its own test — editing the reader's card, deleting their slip, verdict/status untouched while
  evidence still lands, an established-form proposal never reaching `formResearch`, a stale
  write refused, linking ids that are not on the case. Plus a board round-trip in the smoke
  test, verified through a real client handshake.

### Fixes & hardening (this pass) ✅
Bugs found while getting indications working end-to-end — recorded because several
were invisible-by-inspection and cost real time:

- **Gloss never used a form's refinement** (the headline bug). The Reader wrote
  the lookup key with a **NUL byte** separator (`` `${root}\x00${lemma}` ``) while
  `AyahBlock` read it with a **space** — an invisible mismatch, so every lookup
  missed and the gloss silently fell back to the root indication. The word menu looked
  right because it matches server-side by lemma (a different path), which made the
  bug look like a caching problem. Both sides now use one separator, verified by
  extracting the write/read separators from the two files and comparing them.
  *Lesson: for invisible-character bugs, dump raw bytes (`repr`) — don't re-read
  the source, and don't "verify" with a simulation that reimplements the logic.*
- **`word_indications.lemma NOT NULL`** — the first schema required a lemma, but ROOT
  indications have none, so every "add indication" 500'd. `CREATE TABLE IF NOT EXISTS` can't
  relax a constraint → added a one-time table rebuild that preserves existing rows.
- **`no such column: parent_id` on boot** — the `parent_id` index sat in `SCHEMA`,
  which runs *before* the migration that adds the column. Index creation moved
  after the migration.
- **Indication Editor edits were lost** — the modal was rendered *inside* the word menu
  (a fixed, scrollable popup with its own outside-click handling). Moved to the
  reader level; the overlay now closes on `click` (not `mousedown`) so a focused
  field's blur-save commits first.
- **Reader hangs with My gloss on** — a whole surah's interlinear gloss stacks were
  laid out at once. Added `content-visibility: auto` per āyah (off-screen āyāt skip
  layout/paint) and replaced per-token `words.find(...)` with an O(1) position→word
  map built once per āyah (was O(words²) per render).
- **"⊞ compare here" froze the tab** — it fetched and rendered *every* occurrence
  of a repeated phrase inline. Now caps the inline list (12) with the rest as jump
  chips, and keys its fetch on stable primitives so it can't loop.
- **Stale research reads** — `Cache-Control: no-store` on `/api/v1/research/*`
  only. Deliberately scoped: research data is read-write, Quran content is
  immutable and stays cacheable. (A per-request cache-busting query param was
  tried and reverted — it wasn't the cause and added avoidable overhead.)

- **Arabic descenders were clipped** (ع ج ح, low kasra/shadda). Self-inflicted:
  `content-visibility: auto` — added to keep long surahs responsive — applies
  **paint containment**, which clips to the padding box, and `.ayah` had no
  padding. Fixed with vertical padding that scales with the reader size plus
  leading 2.1 → 2.25, keeping the perf win.
- **Expanding echo "compare here" hung the tab.** Not volume: the server answers
  in 2-5ms and the inline list was already capped at 12. Expanding a panel reflows
  the page, so the reader's IntersectionObserver fired in bursts; each fire
  dispatched `setLastVerse`, and the store wrote the *whole* reading prefs to
  IndexedDB on every `reading` change — which also meant ordinary scrolling was
  hitting IndexedDB every tick. Prefs now persist on a 500ms trailing debounce
  (with a pagehide/unmount flush), observer bursts collapse into one settled
  dispatch, and an āyah with a panel open opts out of content-visibility.
- **node:sqlite plans some SQL pathologically.** Both correlated `EXISTS` and
  `IN (… INTERSECT …)` against the `word_occurrences` VIEW wedged the process with
  no error, though the same SQL runs in 0.08s under other SQLite builds. Root-pair
  lookups use two indexed `word_segments` queries intersected in JS (~50ms); the
  reason is recorded at the call site so it isn't "simplified" back.
- **Dead code removed:** `spellingVariantsForWord` / `stemSurfaces` (superseded by
  `SpellingIndex.variantsForWord` during the مِمَّا fix) and the per-occurrence
  sense-assignment tables/methods (superseded by primary-only indications).

### Remaining / future (not committed)
- **`?` shortcuts overlay** — a discoverable cheat-sheet for the keyboard
  shortcuts (they work but are currently invisible).
- **Curated case files** — authored mysteries with ordered clues; the first
  is onboarding ("case zero"). *(Adapted for research-first: author notes
  appear as peer comparison after you establish your own meaning — no
  answer-key seal.)*
- **Vault-wide export** — the whole vault as one publishable annotated lexicon.
- **Polish** — keyboard nav, ARIA/RTL screen-reader pass, reduced-motion,
  virtualized reader for long surahs, a one-click `research.db` backup.
- **Reach** — shared `/shared` types + a mobile client on the versioned API;
  multi-subject cases; dark theme; revelation-order reading mode.

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
  cross-references), `OpenQuestions` (global unanswered-question badge)
- Echoes: `EchoPanel` (repeated-phrase occurrences + inline compare); server `echoes.ts`
- Home: `Home` (dashboard); resume-reading via `reading.lastVerseKey`
- Roots: `RootsExplorer` (all roots, rarest↔common), `RootDetail` (lexicon page +
  user meanings + collocations + motif tagging); server `user_root_meanings`
- Search: `Search` screen, `ArabicKeyboard`, `Shortcuts`; `lib/arabic.ts`
- Motifs: `Motifs` screen (بيوت); server `motifs` + `motif_roots`
- Compare: `Compare` screen; store `compare` tray + `⇋` pins
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
