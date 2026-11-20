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
(`server/src/claims.ts`, `submissions.ts`, `pull.ts`, `ids.ts`).

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

### Pull is a log replay

`GET /pull` is a cursor walk over append-only rows ("everything with `seq > N`"), with **one
cursor per stream**: each table's `seq` is its own counter, so a shared cursor silently skips
rows. It is replayable and resumable; all-zero cursors are a full resync. It sends every claim
version, not only established ones, and each row's status (`established` / `proposed` /
`superseded`) is derived per pull. No CRDT and no bidirectional merge exist anywhere: outbound
is a submission queue, inbound is a log. The app reads the community live (`/community/readings`,
`/claims`) and keeps no local mirror, so nothing in the app or the MCP calls `/pull` today.

### Schema-change rule

Never remove or repurpose a column in the community tables. New fields are added nullable or
defaulted and ride inside `payload_json` first. Every payload carries a `schema_version`;
unknown keys are preserved on write and ignored on read.

### Superseded decisions

The first design of this layer assumed an offline, account-free local study with an optional
invite-only remote. Those assumptions were reversed in September 2026, and some names from that
era survive in the code:

- **Local `research.db` and offline study** → research lives only in the account, in Postgres.
  `derived_submissions` and `derived_proposed_claims` keep their `derived_` prefix but are now
  ordinary tables in the account's research (the outbox ledgers).
- **`local_id`** (a device identity minted before sign-in) → still a column on `users` and a
  route (`POST /me/local-id`), with nothing in the app that uses it.
- **Invite-only, magic-link sign-in** → open sign-up as a free reader, email + password;
  invites remain as the way to bring someone in at a higher role.
- **Corpus as signed patch files only** → the corpus is served from Postgres; the patch channel
  still exists for `quran.db` (`CORPUS.md`).
- **"Phase 0–7"** in code comments refers to the original build order of this layer. Phases 0–6
  are built; Phase 7 is the redaction work listed below.

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
  dissent), pull, community indications, "Where I stand apart".
- **Plans and the cloud (Sep 2026)** — plan tiers and gated community; the corpus moved into
  Postgres and served at `/corpus` (parity proven over 77,439 requests); personal API tokens;
  the Admin tab; Docker deployment; research moved into the account under row-level security;
  roles as a data ladder and audiences on published results; `research.db` and the local server
  removed; the MCP hosted at `/mcp`.
- **Since** — open sign-up, per-feature plan rules (23 features), the in-app Guide, spelling
  variants shown above each word.

## Not yet built

- **Redaction and tombstones.** A maintainer redacts a published row; its content is replaced by
  a record naming who, when and why (publicly), and the ID still resolves. The `redactions`
  table exists; nothing writes it.
- **Citation IDs in the UI** (`claim_id@version`) for writing.
- **Divergence in the reading surfaces** — a margin mark in the reader where your reading and
  the group's differ, and the group's reading with its dissents in the form dossier. Today
  divergence shows only on the "Where I stand apart" screen and in the indication panels.
- **Review UI for additive submissions** — claims can be reviewed in the app; submissions can't.
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
