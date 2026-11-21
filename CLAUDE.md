# MQ Research Gate (repo: AlSiraatAlMustaqeem)

A study app for the Qur'an built on the **organic Qur'anic methodology**: meaning is established
from inside the text, through the Arabic root-word system. Every word links back to its root; the
reader builds meaning by investigation (gathering āyah evidence, notes and cited references,
following root and word trails) and establishes their own understanding. Readers can publish
readings to a reviewed community, and an AI assistant can study alongside them through an MCP
server, as a proposer only.

The project is **in development**. Remove legacy paths instead of keeping compatibility shims for
old data or old layouts.

## Architecture

Two things run: **Postgres** and the **research server**. The app (in a browser, or the desktop
window) and the MCP are clients of the research server; nothing else is a server.

```
your machine                              research server (server/, :8100)
  app  (Vite :5174, or desktop) ─ cookie ─▶  sign-in · gates (role / plan / audience)
  MCP  (stdio, or hosted /mcp)  ─ token ──▶  /corpus · /research · /community · /admin · /mcp
                                                      │
                                                  Postgres (:5432)
                                         corpus · research (row-level security) · accounts
```

```
AlSiraatAlMustaqeem/
├── app/           React 18 + Vite + TypeScript single-page app (reader and investigation UI)
├── server/        the research server (Hono + Postgres + Better Auth): corpus, research,
│                  accounts, roles, plans, community, the hosted MCP
├── corpus-core/   the corpus code (search, roots, similarity, …), its route builders, and the
│                  golden-parity tests; the research server runs it over Postgres
├── mcp/           MCP server: lets an AI study the corpus and propose into the reader's research
├── electron/      the desktop window around the built app (no back end of its own)
├── deploy/        Docker compose, Caddy, backup and update scripts
├── mobile/        separate offline Android app (Expo); not an npm workspace, has its own README
├── skills/        the organic-quran-study skill that drives the MCP
├── docs/          the atlas (atlas.json / atlas.html) and its feedback log
└── quran.db       the corpus source in SQLite, loaded into Postgres (not in git)
```

- **Corpus**: the Qur'an text in every script, per-word morphology, roots and forms, the classical
  lexicons, translations. Read-only. Served from Postgres at `/corpus`; `quran.db` is the source it
  is loaded from and the reference the parity checks compare against.
- **Research**: what a reader builds (cases and boards, notes and questions, indications and
  refinements, root meanings, motifs, trails, comparisons, saved links and leads, speaker tags,
  rule checks, characters and their mentions, the earlier versions of what they replaced,
  settings). It lives only in the
  reader's account on the research server, private by row-level security. There is no local file.
- **Access**: roles say what you may **do** (publish, review, establish, administer); plans say
  what you may **use and read** (27 plan features, plus per-translation and per-lexicon rules).
  Staff (moderator and maintainer) pass every plan gate. Every published result is seen only
  by the audience it names. Everything fails closed.
- **AI boundary**: a request made with an API token may only propose. Its writes are tagged
  `source = 'ai'`, are never primary, and never touch the reader's own items, verdicts or
  established meanings. A token can't publish, review or administer. The server enforces this
  (`server/src/research/boundary.ts`), and the MCP guard repeats it (`mcp/src/core.ts`).

**Requirements:** Node.js 22 or newer and Postgres 16 running locally. No Python, no native build
tools.

## Commands

All from the project root. Postgres must be running; the server connects to
`postgres://postgres:researchgate@localhost:5432/researchgate` unless `DATABASE_URL` says otherwise.

```bash
npm run dev                       # research server (:8100) + web app (:5174)
npm test                          # both suites (corpus-core/, server/); server tests use PGlite
npm run typecheck                 # every workspace
npm run server:migrate            # apply new migrations (dev does not auto-migrate; Docker does)
npm run corpus:migrate            # load quran.db into Postgres (~20 s), then verify
npm run corpus:parity -- --quick  # prove Postgres answers exactly as quran.db
npm start                         # build the app and preview it on :8000
npm run electron:dev              # the desktop app
npm run desktop:dist              # desktop installers → dist-desktop/
npm run mcp                       # the MCP over stdio
```

First time on a machine:

```bash
npm install
npm run server:migrate
npm run corpus:migrate
npm run bootstrap -w @alsiraat/server -- you@example.org "Your Name"     # the first maintainer
npm run set-password -w @alsiraat/server -- you@example.org 'a password'
```

## Where to read more

| File | Read it when |
|---|---|
| `DESIGN.md` | product design, the spaces, visual language, the community's rules, build history |
| `SERVER.md` | the research server: accounts, routes, roles, plans, audiences, research privacy |
| `CORPUS.md` | `quran.db` schema and provenance, the Postgres copy, parity, the patch channel |
| `MCP.md` | the MCP server: client setup, tools, the write boundary |
| `DEPLOY.md` | running it on a VPS with Docker |
| `DESKTOP.md` | the Electron shell |
| `mobile/README.md` | the Android app |
| `docs/atlas.json` | the structured map: access model, endpoints, phase status, the decision log with the why, a file map (`atlas.html` is its human view; update both together) |

Server migrations (`server/migrations/`) are the source of truth for the database schema.

---

# Rules that keep getting broken

## Word positions: always tokenize with `tokenizeVerse`

Corpus `word_position` is 1-based over the **words** of an āyah, and an āyah's text contains
standalone tokens that are **not** words: waqf/pause marks (ۛ ۖ ۗ), sajda (۩), rub‑el‑hizb (۞).
Splitting the text on whitespace and using `index + 1` as the position counts those marks and
shifts every highlight after the first one. Never map positions off a raw `split(" ")`.

Use `tokenizeVerse(text)` from `app/src/components/reader/format.ts`: it returns tokens where only
real words carry a `position` (marks get `position: null`), matching the morphology tables exactly.
Match on `tok.position === word_position`. The reader (`VerseText`), the export, and the form peek
all go through it; anything that highlights or maps a word by position must too.

## Lemma vs surface form

The corpus indexes words two ways and they are NOT interchangeable: the **lemma** (dictionary
form, `lemma_arabic`) and the **surface form** (the word as written in the āyah, `form_arabic` /
the reader's `Word.arabic`). One lemma covers several surface forms, e.g. lemma صُّلْب covers both
صُّلْبِ (singular, 86:7) and أَصْلَٰبِ (plural, 4:23), which carry different senses.

- The **evidence drawer** and the **indication editor's per-form list** enumerate **surface
  forms**, so each word as written is its own row.
- Per-form **refinements** are keyed by the **surface form**. The reader's gloss and the word menu
  match surface-first, then fall back to the lemma key (`indicationsForWord(lemma, root, surface)`;
  `AyahBlock.glossFor` tries `w.arabic` then `w.lemma`).
- The surface string in the editor comes from `word_occurrences.form_arabic` while the reader's
  comes from `Word.arabic`; they usually match, and the lemma fallback covers the cases they
  don't. Don't assume they're byte-identical.

## Arabic needs vertical room

Vocalised Arabic stacks marks **above and below** the baseline, so the glyphs are taller than a
Latin line. A normal UI `line-height` of 1.2–1.5 produces a line box shorter than the text, and
the moment that element also has `overflow: hidden` (for `text-overflow: ellipsis`) or a fixed
height, **the marks are sheared off**. It looks like a font bug; it's a layout bug.

Whenever you add anything that can contain Arabic (a list row, chip, badge, tooltip, truncated
label, table cell, popover) do all of:

- `line-height: 1.9` minimum for UI text with inline Arabic; **2.0–2.25** for Qur'anic text
  (`.quran` already does this; don't override it downward).
- Never put a fixed `height` on it. Use `min-height` so it can grow.
- If you truncate with `overflow: hidden`, make sure the line box has already been given the
  height above. Clipping happens at the padding box, so padding does *not* rescue it.
- Check it with a vocalised word that has marks both ways, e.g. `ٱلضَّآلِّينَ` or `مَعْلُومِ`.

**Spaced roots must not break across lines.** A root is displayed letter-spaced (ه د ي). The
display helper `spaced()` joins with a **non-breaking space** (U+00A0), not a plain one, so the
root can't wrap mid-word in a narrow container. The two exceptions are deliberate:
`indicationPrompt.ts` (AI-prompt text) and `exportCase.ts` (copied-out HTML/markdown) keep a plain
space so exported text stays clean. Any new `spaced` helper for on-screen text uses U+00A0.

**Arabic inside a control is metadata, not display text.** A list of forms or roots shown inline
in a hint or badge is sized down (≈1rem) and allowed to wrap; full Qur'anic-size `.quran` in a
message box blows the box open. Display-size Arabic is only for the reading surface itself.

## UI conventions

Keep **symmetry and alignment** the default in every screen. This is a standing requirement.

- **One grid, not many rows.** When several controls sit together (a toolbar, a menu, a button
  group), lay them out in a *single* grid with equal columns (`repeat(n, minmax(0, 1fr))`).
  Separate flex rows each size independently and drift out of alignment.
- **Icons in a fixed slot.** Give button icons a fixed-width, centred slot (e.g. `width: 1.4rem`)
  so glyphs of different widths line up in a column and the labels start at the same x.
- **Buttons are atomic.** `.ctl` is `inline-flex`, centred, `white-space: nowrap`. A button never
  wraps its label or drops its icon onto a second line; let a flexible neighbour shrink instead.
- **Consistent edges.** Align left edges of stacked items; keep equal gaps; cap floating popovers
  to the viewport (`max-height`, internal scroll) and keep a page margin
  (`max-width: min(…, calc(100vw - 2rem))`).
- **Reuse the tokens.** The paper aesthetic (warm paper, ink, gold) and the CSS variables in
  `app/src/styles.css` are the source of truth for colour and spacing. Don't hardcode.
- **A bare `.ctl` is invisible in a panel.** `.ctl` defaults to a transparent background *and* a
  transparent border, deliberately, so it disappears into a toolbar. Dropped into a panel or
  content area as a standalone action it reads as absent. A secondary action outside a toolbar
  must be given an edge (`border-color: var(--paper-edge); color: var(--ink)`), the way `.acct`,
  `.review-actions`, `.propose-actions` and `.diverge-actions` do.
- **A modal must never grow past the viewport.** Every modal caps at `max-height: 90vh`, is a
  `flex column`, gives the content region `overflow-y: auto; min-height: 0`, and keeps the header
  and the actions **outside** that scroll (actions pinned with `position: sticky; bottom: 0` and
  an opaque background). The actions must always be reachable. See `.propose`.
- **Icon-only buttons need `title` + `aria-label`**, and a visible hover state.
- **Errors** appear in a tinted block near the top of the panel with `role="alert"`, not as a bare
  red sentence wherever the failure happened.

### Build what people already know

The app is for the general public. For anything that exists in ordinary web apps (accounts,
sign-in, settings, profiles, invites) **use the conventional pattern**. Novelty belongs in the
research surfaces (the board, trails, the mushaf), never in the plumbing.

- **Account panels** look the way account panels look: avatar (initials fallback) + name + role
  badge + email, then labelled rows, then sign-out set apart at the end.
- **Show values, not forms.** Display a field as text with a pencil/edit affordance; open the
  input only when editing, with explicit Save/Cancel (Enter saves, Esc cancels).
- **Labels above controls**, controls full-width in a panel, all sharing **one left edge**.
- **One primary action per section** (`.ctl.primary`, filled), everything else secondary.
  Alternative paths ("Have an invite code?") read as a sentence with a link, not a rival button.
- **A screen does one job.** Home is a workbench: what you were reading and what you have in
  flight. Configuration lives in **Settings**, behind the gear in the top bar. If a card doesn't
  answer the screen's question, it belongs somewhere else.
