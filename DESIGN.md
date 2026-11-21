# MQ Research Gate — Design

> A **detective's study** for the Qur'an. Reading becomes investigative work: notice a
> word, open a case, gather every place the Book itself uses it, form a hypothesis, and
> only then weigh the dictionaries. Meaning is *earned from within the text* — the
> organic Qur'anic methodology, made tactile.

**Stack:** React + Vite + TypeScript SPA (`app/`) over the research server (`server/`, Hono +
Postgres + Better Auth), which holds the corpus, every account's research and the community.
An MCP server (`mcp/`) lets an AI study with the reader. Architecture, commands and the standing
UI rules are in `CLAUDE.md`; the server in `SERVER.md`.

This file is the design reference: what the product is, and the rules the community layer runs
on. The per-version build log lives in git; a digest is at the end.

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
   is the *product* of the case. Others' established readings may be visible (§6), but what
   distinguishes your scholarship is that your own establishment is a **separate, dated record
   of what you yourself held**, standing alongside the group's and never overwritten by it.
2. **The root's core meaning is reference evidence**, not the answer. The interesting
   question — why هُدًى here and not هِدَايَة — is settled by the occurrences, the reader's
   reasoning, and the sources they cite.
3. **Research feeds back into reading.** The mushaf becomes progressively annotated by
   the reader's own scholarship — a personal tarjamah, earned form by form.

## 3. The spaces

- **Read** — a quiet mushaf reader; every word is latently interactive. Margin marks
  (rare-root ⚲, repeated-phrase ≡, vault ✦, an āyah that is evidence in a case ⚖ or carries
  your established understanding ✒), a word menu (open a case, follow the word,
  notes/questions), all four scripts, optional translation underlay (off by default).
- **Investigate** — the case archive ↔ a **full-page canvas** case desk (n8n-style): a
  dot-grid board of evidence cards and slips with zoom/pan, threads (card↔card or to a
  specific word), colour-coded clusters, and Arrange. Board controls live in a floating
  **Tools** popover; **Evidence/Related āyāt**, **Dossier** and **Details** open as right
  side-sheets from a FAB stack. AI proposals are reviewed here, never auto-applied.
- **Study** (menu) — **Roots** explorer + lexicon pages, **Motifs** (بيوت), **Compare**
  workspace, **Vault** of established roots, **Where I stand apart** (divergences from the
  group's readings).
- **Trails** — the connective tissue: walk a root family or one exact written word
  occurrence-by-occurrence; promotable to a case.
- Cross-cutting: **Home** workbench, **⌘K command palette** (jump to āyah/root/case or
  search), one **activity bell** (proposals to review + open questions), the **account** button
  and **Settings** in the top bar, a **Guide** (in-app walkthrough that reads the live account
  and plan), and an **Admin** tab for maintainers.

## 4. Visual language

Warm parchment surfaces with subtle grain; deep ink-brown text. **Gold** for the
focus/subject word only (kept special); **lapis** for the reader's own ink (threads,
verdicts) and for community readings (◈); faded graphite for machine suggestions. Hand-drawn
glyph iconography. KFGQPC/Amiri for Qur'anic text (generous leading, all four scripts); a
humanist serif for UI. Paper-native motion, reduced-motion honoured. Qur'anic content + board
cards RTL, chrome LTR, numerals configurable (āyah marks use Western digits inside RTL brackets).

## 5. Data

Corpus endpoints (`/corpus/*`) cover the investigation: `/chapters`, `/verses/{key}` (+words,
scripts, similar, echoes, spelling, wazn), `/roots/{root}` (+forms, occurrences, linkages),
`/words/occurrences`, `/phrase-search`, `/search`, `/expression-search`. The reader's research
is `/research/*` in their account (`cases`, `form_research` + `form_revisions`, `trails`, `notes`,
`word_indications`, `user_root_meanings`, `motifs`, `compare_sets`, `settings`); `notes`,
`word_indications` and `motifs` carry a `source` (`me` / `ai`). See `SERVER.md` and `CORPUS.md`.

---

## 6. The community: rules of shared research

Research can be published, reviewed by other researchers, and agreed, without taking a
reader's own work out of their hands. How access is gated (roles, plans, audiences) is in
`SERVER.md`; this section is the rules of the review process itself, which the code enforces
(`server/src/claims.ts`, `submissions.ts`, `ids.ts`).

### Vocabulary

| Term | Means |
|---|---|
| **Locally established** | A form's meaning *you* established, in your own research. Dated, yours, never overwritten by anything. |
| **Globally established** | The reading that reviewers accepted as the group's agreed meaning for that form or root. |
| **Claim** | One author's reading of one subject (a form or a root), with its argument. |
| **Dissent** | A recorded disagreement with a globally established reading, preserved rather than resolved. |
| **Submission** | A frozen bundle of your work offered for review. |
| **Divergence** | A form you established whose meaning differs from the group's ("Where I stand apart"). |

The word *canon* is deliberately not used anywhere.

### Two records, side by side

`form_research` is the locally established record; the community never writes to it. The
group's reading lives in `global_forms`. They may differ permanently, and you never have to
reconcile them: adopting the group's reading is an ordinary revision of your own record, with
your reason attached, so the change of mind stays part of your history. The group's readings
reach the reader as **more indications**, shown in the same list as their own and marked as
theirs (lapis ◈, with status and dissent count). You cannot promote or edit someone else's
reading; to hold what they hold, you write it yourself.

### The rules

- **Establishment rule.** A claim is established when `approvals ≥ requiredApprovals` **and**
  `approvals > objections`: a majority *of the votes cast*, not of all moderators (waiting on
  people who never look would stall forever). `requiredApprovals` is config (1 while the group
  is small). No time windows, no quorum.
- **No self-approval.** A moderator may not approve their own claim. A maintainer may establish
  directly regardless of counts; it is recorded as their act.
- **Objections never block.** They are recorded, and against an established reading an objection
  becomes a **dissent** attached to it.
- **Three kinds of submission**, as distinct code paths rather than one generic merge:

  | Kind | Contents | Behaviour |
  |---|---|---|
  | **Additive** | Notes, published questions, evidence āyāt | Land as new attributed rows. Cannot conflict. Review is in/out only. |
  | **Competing** | Form indications, root verdicts | Contend for the globally established slot, as claims. |
  | **Document** | Cases | Always land as a new attributed case; never merged into anyone else's board. (Designed, not built.) |

- **Frozen snapshots.** A submission freezes its payload at submit time; the reader's own work
  carries on moving. Re-submitting creates a new submission that points at the previous one via
  `supersedes`, so a reviewer sees a replacement rather than two unrelated items.
- **Argument required.** A competing claim must carry its argument: a linked case, evidence
  āyāt, or reasoning. A bare assertion is a vote and can't be reviewed. Additive submissions
  stay argument-free.
- **Self-revision is a version.** Revising a reading you already got established creates a new
  version of your claim, the old version intact and still citable. Dissent is only for
  disagreeing with *someone else's* accepted reading.
- **A dissent stands alone.** It carries its own payload (it may include its own evidence) and
  references the claim version it objects to, so it survives if the context around it moves.
- **Single author.** One `author_id` per submission and per claim. No co-authoring.
- **Size cap.** 1 MB per submission item; over that is rejected with "split this submission".
- **Private by default.** Nothing is shared unless the reader publishes that item, and then only
  to the audience it names, once a reviewer approves it.

### Claims and citation IDs

Identifiers are content-addressed: `base32(sha256(canonical JSON))`, lower-case, unpadded,
URL-safe, with a prefix.

```
claim_id      = "clm_" + digest({ author_id, subject_kind, subject_value })
submission_id = "sub_" + digest({ author_id, target_kind, items })
dissent_id    = "dsn_" + digest({ author_id, claim_id, claim_version, payload })
```

- A claim is keyed by **author + subject**, with a separate `global_forms` pointer naming which
  claim version holds the group's slot. Two authors' readings of the same word are two claims
  that contend for the slot; they never overwrite each other.
- Successive readings by one author are **versions** of their claim, so `claim_id@version` pins
  exactly what was cited even after they change their mind.
- Submitting an identical bundle twice returns the same submission instead of duplicating it.

### Read live, never mirrored

The app reads the community from the server each time (`GET /community/readings`, `GET /claims`)
and keeps no local copy: a copy on the reader's machine could not be gated by plan or audience.
Each reading's status (`established` / `proposed` / `superseded`) is derived when it is read,
so a claim that gains or loses the group's slot corrects itself with no rewrite.

### Payloads carry a version

Every published payload (`payload_json`) carries a `schema_version` (`SCHEMA_VERSION` in
`submissions.ts`), so a reading published under an older shape can still be told apart and read.

### Superseded decisions

The first design of this layer assumed an offline, account-free local study with an optional
invite-only remote. Those assumptions were reversed in September 2026, and some names from that
era survive in the code:

- **Local `research.db` and offline study** → research lives only in the account, in Postgres.
  `derived_submissions` and `derived_proposed_claims` keep their `derived_` prefix but are now
  ordinary tables in the account's research (the outbox ledgers).
- **`local_id`, `GET /pull`, `sync_cursors`** (a device identity minted before sign-in; a
  cursor walk that mirrored the community into the reader's file) → removed in migration 0015.
  The `seq` columns on the community tables are what is left of the pull streams.
- **Invite-only, magic-link sign-in** → open sign-up as a free reader, email + password;
  invites remain as the way to bring someone in at a higher role.
- **Corpus as signed patch files only** → the corpus is served from Postgres; the patch channel
  still exists for `quran.db` (`CORPUS.md`).
- **"Phase 2 / 4 / 5"** in code comments refers to the original build order of this layer (the
  corpus patch channel, additive submissions, the claim spine). The last phase, redaction, was
  never built; it is listed below.

---

## Build history (digest)

Detail is in git; this is the shape of the arc.

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
  Investigate board** (add-only, tagged, never primary, version-checked); the case **report
  rebuilt as an argument** and a run of *silent* corpus bugs fixed.
- **V22** — **chrome & navigation**: rename to *MQ Research Gate*; top-bar hierarchy, ⌘K
  palette, merged activity bell; the **full-page canvas** case desk; per-cluster colours.
- **Backend port + desktop (Aug 2026)** — the Python/FastAPI backend ported to TypeScript and
  proven by golden-parity tests; the Electron shell.
- **Shared research (Aug 2026)** — the corpus patch channel, the research server (Postgres,
  Better Auth, roles, invites), submissions, the claim spine (propose, review, establish,
  dissent), community indications, "Where I stand apart".
- **Plans and the cloud (Sep 2026)** — plan tiers and gated community; the corpus moved into
  Postgres and served at `/corpus` (parity proven over 77,439 requests); personal API tokens;
  the Admin tab; Docker deployment; research moved into the account under row-level security;
  roles as a data ladder and audiences on published results; `research.db` and the local server
  removed; the MCP hosted at `/mcp`.
- **Since** — open sign-up, per-feature plan rules, the in-app Guide, spelling variants shown
  above each word.
- **Links (Nov 2026)** — tools for reading the Book through its own cross-references. They find
  and count; the reader decides what a link means.
  - **An āyah's links** (`corpus-core/src/links.ts`): everything it shares with the rest of the
    Book, rarest first: phrases, two-word pairs, written words (particles and names too, a
    leading و / ف set aside), dictionary forms and roots, each with the number of āyāt that carry
    it. Widespread markers are counted but not listed. Opened from a labelled **Links** button on
    every āyah; the āyah lens is started from the same panel.
  - **Rare links**: every marker that exactly 2–5 āyāt share, across the whole Book.
  - **Search by grammar** (`corpus-core/src/constructions.ts`): āyāt built the same way, from
    presets (opening with وَإِذْ, أَرَءَيْتَ, سَ / سَوْفَ + verb, ٱلَّذِى + verb, تَٱللَّهِ) or up to four
    word slots.
  - **Saved links, leads and speaker tags** (migration 0016): the reader keeps a link between
    two spans with its kind, a group name and a note; a link with one end is a lead to pursue;
    a tag records who speaks and to whom. All private research, proposable by the assistant.
  - **How many āyāt a reading rests on**: each form's meaning, an āyah's understanding and a
    case's verdict show the number of separate āyāt behind them, with a note when it is one. It
    reminds; it does not block.

- **Checking a reading (Nov 2026)** — tools that list every place in the Book and record what
  the reader decides about each. The Book is a closed text, so a rule can be set against all of
  it and one exception is enough to rethink it. The corpus answers "where"; the research holds
  "what I decided there". Nothing here interprets.
  - **Rule checks** (migration 0017): a rule in the reader's words, what would prove it wrong,
    and what it covers (a word as written, a word in all its forms, a root, a written shape, a
    grammar pattern, or any row of the Links panel). Every place is listed; each is marked fits,
    exception or not sure. One exception turns the tally red.
  - **Characters**: someone the reader names, the names and titles filed under them, and
    mentions: a name, title, description or pronoun at a place, *potential* until the reader
    *establishes* it. "Who uses which name" counts from the reader's own speaker tags.
  - **The Links panel is four tabs**: Links, Speakers, Characters, Pronouns, each with its
    count. The Pronouns tab lists the āyah's pronouns to point at a character.
  - **Dialogue**: a sūrah as a script of the reader's speaker tags, with every speech opener
    (قال، قالوا، قل، نادى) not yet tagged. A tag also records who else hears, and whether the text
    states the speaker or the reader inferred it.
  - **Tensions**: a saved link of the kind "these seem to disagree (to me)", open until the
    reader settles it and says how.
  - **Evidence against**: a case card counts for the reading or against it; the dossier says
    how many āyāt it rests on and how many stand against, and asks what would prove it wrong.
  - **From the corpus** (`corpus-core/src/occurrences.ts`, `voices.ts`, `wording.ts`): every
    occurrence of a marker, shape or pattern; **Spellings** (the words written more than one
    way); **What differs** between two āyāt, word against word; **Check wording** for any Arabic
    text; and grammar search by participle, verbal noun, verb form, attached pronoun, noun
    number and gender.
  - **The assistant** may suggest marks on a rule and file potential mentions; it cannot state
    a rule, name a character, establish a mention or settle a tension.
  - The Study menu is two columns, *In the Book* and *Your study*. The reader keeps its place in
    the address (`#/read/19:47`), so a refresh returns to the same āyah, and jumps made from the
    lens leave a way back.
- **What a reading rests on (Nov 2026)** — from the lecture on what an interpreter needs: take
  the meaning of a word from the Book before a dictionary, know what is the Book and what is a
  later source, and keep a record of where you changed your mind. Again the tools only count.
  - **What a case rests on**: a reference slip says what kind of work it cites (a dictionary, a
    tafsīr, a narration, a story from outside the Book). Wherever the āyāt count shows, one
    quiet line counts the āyāt for and against, the reader's observations and each kind of
    cited work. It does not judge.
  - **The root page is Book first**: the forms and where they occur, then the reader's own
    meaning, then the dictionaries under *written after the Book*, oldest first, each with its
    author and date where the work is known for certain.
  - **Earlier versions** (migration 0018): the text the reader replaced (a verdict, a form's
    established meaning, their meaning for a root, an indication) is kept with its date and,
    if they say, why they changed it. Only a text that had stood for ten minutes is kept, so
    typing does not fill the list.
  - **Motif spread**: where a motif's roots occur, by sūrah and by page of the muṣḥaf, and the
    pages with none. **Supplications**: every place the Lord is addressed with رَبَّنَا, رَبِّ or
    ٱللَّهُمَّ (143 places in 132 āyāt). **Opening and close**: the roots a sūrah's first āyāt
    share with its last.
  - **Spelling kinds**: one ت or two, and a letter doubled or written twice, are named; words
    that differ only by a grammatical ending (ذُو / ذِى) are kept out of the list, because that
    is grammar. Nothing is left under "other".
  - **Dialogue**: every verb of ن د و is listed, as *a call: speech may follow* where the text
    does not show speech after it; the reader sets one aside with *No speech here*, adds opener
    roots of their own, and tags an opener in place with *Tag it here*.
  - **Pronouns**: a word that carries two pronouns (خَلَقْنَـٰكُمْ) lists them apart, and each is its
    own place to point at a character.
  - **Check as a rule** starts a rule check from Spellings, a root's page, a word's menu and
    grammar search results, as well as the Links panel. A character and a rule each have an
    address (`#/characters/<id>`, `#/rules/<id>`).
  - **The way back**: a jump into the reader from a Study screen, Search or a case leaves
    *← Back to …* in the reader. The screen left stays alive behind the reader, so going back
    finds it as it was, at the same place on the page; it is rebuilt first when the research
    changed meanwhile (`Screens` in `app/src/App.tsx`, `returnTo` in the store).
  - On a narrow screen the top bar is two rows and never wider than the page.
## Not yet built

- **Redaction and tombstones.** A maintainer redacts a published row; its content is replaced by
  a record naming who, when and why (publicly), and the ID still resolves. The `redactions`
  table exists; nothing writes it.
- **Citation IDs in the UI** (`claim_id@version`) for writing.
- **Divergence in the reading surfaces** — a margin mark in the reader where your reading and
  the group's differ, and the group's reading with its dissents in the form dossier. Today
  divergence shows only on the "Where I stand apart" screen and in the indication panels.
- **Review UI for additive submissions** — claims can be reviewed in the app; submissions can't.
- **The evidence count for reviewers** — a reader sees how many separate āyāt their own reading
  rests on; a reviewer of a published reading does not see that count yet.
- **Case (document) submissions.**
- **Billing provider** — slots into the plan grant; plans are granted by a maintainer today.
- **Corpus patches for Postgres** — the patch tool writes `quran.db` only (`CORPUS.md`).
- **`?` shortcuts overlay** — the keyboard shortcuts work but are undiscoverable, and the
  `g`-chord targets still map to the pre-V22 tab letters.
- **Curated case files** — authored investigations with ordered clues (author notes shown
  as peer comparison *after* you establish your own meaning; no answer-key seal).
- **Ideas noted, not started:** vault-wide export as an annotated lexicon, multi-subject cases,
  a candlelight dark theme, revelation-order mode, a fuller accessibility pass (keyboard nav,
  ARIA/RTL screen-reader support).
