# AlSiraatAlMustaqeem — Project Instructions

**Purpose:** Engage the Quran using an organic Quranic methodology — exploring the text through
its own internal linguistic structure, particularly the root-word system of Arabic. The app links
every word back to its trilateral/quadrilateral root and lets the reader *build* meaning through
investigation: gathering ayah evidence, notes, and cited references, following root/phrase trails,
and establishing their own understanding.

---

## Design conventions (UI)

Keep **symmetry and alignment** the default in every screen — this is a standing
requirement, not a per-task nicety.

- **One grid, not many rows.** When several controls sit together (a toolbar, a menu,
  a button group), lay them out in a *single* grid with equal columns
  (`repeat(n, minmax(0, 1fr))`) so every item lines up on the same grid lines. Separate
  flex rows each size independently and drift out of alignment — avoid them for groups.
- **Icons in a fixed slot.** Give button icons a fixed-width, centred slot
  (e.g. `width: 1.4rem`) so glyphs of different widths (emoji especially) line up in a
  column and the labels start at the same x.
- **Buttons are atomic.** `.ctl` is `inline-flex`, centred, `white-space: nowrap` — a
  button never wraps its label or drops its icon onto a second line. Let a flexible
  neighbour (a title) shrink instead.
- **Consistent edges.** Align left edges of stacked items; keep equal gaps; cap floating
  popovers to the viewport (`max-height`, internal scroll) and keep a page margin
  (`max-width: min(…, calc(100vw - 2rem))`).
- Paper aesthetic (warm paper, ink, gold) and the CSS variables in `app/src/styles.css`
  are the source of truth for colour/spacing — reuse them, don't hardcode.

### Arabic needs vertical room (this keeps getting broken)

Vocalised Arabic stacks marks **above and below** the baseline — fatḥa/ḍamma above, kasra and
shadda stacks below — so the glyphs are taller than a Latin line. A normal UI `line-height` of
1.2–1.5 produces a line box shorter than the text, and the moment that element also has
`overflow: hidden` (for `text-overflow: ellipsis`) or a fixed height, **the marks are sheared
off**. It looks like a font bug; it's a layout bug.

Whenever you add anything that can contain Arabic — a list row, chip, badge, tooltip,
truncated label, table cell, popover — do all of:

- `line-height: 1.9` minimum for UI text with inline Arabic; **2.0–2.25** for Qur'anic text
  (`.quran` already does this — don't override it downward).
- Never put a fixed `height` on it. Use `min-height` so it can grow.
- If you truncate with `overflow: hidden`, make sure the line box has already been given the
  height above — clipping happens at the padding box, so padding does *not* rescue it.
- Check it with a vocalised word that has marks both ways, e.g. `ٱلضَّآلِّينَ` or `مَعْلُومِ`.

**Spaced roots must not break across lines.** We display a root letter-spaced (ه د ي). A
normal space between the letters is a line-break opportunity, so in any narrow or flex-squeezed
container the root wraps mid-word (`ه د` / `ي`). The display helper `spaced()` therefore joins
with a **non-breaking space** (` `), not a plain one — every render copy of it does this.
The two exceptions are deliberate: `indicationPrompt.ts` (AI-prompt text) and `exportCase.ts`
(copied-out HTML/markdown) keep a plain space so exported text stays clean. If you add another
`spaced` helper, use ` ` for anything shown on screen.

### Build what people already know

This app is for the general public, not for us. For anything that exists in ordinary web
apps — accounts, sign-in, settings, profiles, invites — **use the conventional pattern**.
Novelty belongs in the research surfaces (the board, trails, the mushaf), never in the
plumbing. A reader should never have to *learn* how to sign in.

- **Account panels** look the way account panels look: avatar (initials fallback) + name +
  role badge + email, then labelled rows, then sign-out set apart at the end.
- **Show values, not forms.** Display a field as text with a pencil/edit affordance; open the
  input only when editing, with explicit Save/Cancel (Enter saves, Esc cancels). Never leave a
  bare input and a floating Save sitting on screen — that reads as an unfinished form.
- **Labels above controls**, controls full-width in a panel, all sharing **one left edge**.
  Don't hang a label to the left of an input in a narrow sheet.
- **One primary action per section** (`.ctl.primary`, filled), everything else secondary.
  Alternative paths ("Have an invite code?") read as a sentence with a link, not a rival button.
- **A bare `.ctl` is invisible in a panel (this keeps getting broken).** `.ctl` defaults to a
  transparent background *and* a transparent border — deliberately, so it disappears into a
  toolbar. Drop one into a panel or a content area as a standalone action and it reads as absent:
  the user reports "no button is visible." A secondary action outside a toolbar must be given an
  edge (`border-color: var(--paper-edge); color: var(--ink)`), the way `.acct`, `.review-actions`,
  `.propose-actions` and `.diverge-actions` do. Only genuine toolbar buttons stay borderless.
- **Icon-only buttons need `title` + `aria-label`**, and a visible hover state.
- **A modal must never grow past the viewport (this keeps getting broken).** A dialog centred on
  the screen with no height cap will, the moment its content is long, push its own action buttons
  below the bottom edge — the user sees a headless, footless slab and "the buttons are hidden."
  Every modal must: cap at `max-height: 90vh`, be a `flex column`, give the content region
  `overflow-y: auto; min-height: 0` so it scrolls, and keep the header and the actions **outside**
  that scroll (actions pinned with `position: sticky; bottom: 0` and an opaque background). The
  actions are the one thing that must always be reachable — never let them scroll away. See
  `.propose`.
- **Arabic inside a control is metadata, not display text.** A list of forms/roots shown inline in
  a hint or badge must be sized down (≈1rem) and allowed to wrap; dropping full Qur'anic-size
  `.quran` into a message box blows the box open. Display-size Arabic is only for the reading
  surface itself.
- Errors appear in a tinted block near the top of the panel with `role="alert"` — not as a
  bare red sentence wherever the failure happened.
- **A screen does one job.** Home is a workbench: what you were reading and what you have in
  flight. Configuration (reading preferences, where your research is kept) lives in
  **Settings**, behind the gear in the top bar. Mixing "what am I working on" with "how is the
  app set up" is what turns a page into a dumping ground — if a card doesn't answer the
  screen's question, it belongs somewhere else.

## Word positions: always tokenize with `tokenizeVerse` (this keeps getting broken)

Corpus `word_position` is 1-based over the **words** of an āyah — and an āyah's text contains
standalone tokens that are **not** words: waqf/pause marks (ۛ ۖ ۗ), sajda (۩), rub‑el‑hizb (۞).
Splitting the text on whitespace and using `index + 1` as the position counts those marks and
shifts every highlight after the first one (a form's word lights up one or more slots to the
left/right of where it should). Never map positions off a raw `split(" ")`.

Use `tokenizeVerse(text)` from `components/reader/format.ts`: it returns tokens where only real
words carry a `position` (marks get `position: null`), matching the morphology tables exactly.
Match on `tok.position === word_position`. The reader (`VerseText`), the export, and the form
peek all go through it — anything that highlights or maps a word by position must too.

## Lemma vs surface form

The corpus indexes words two ways and they are NOT interchangeable: the **lemma** (dictionary
form, `lemma_arabic`) and the **surface form** (the word as written in the āyah, `form_arabic` /
the reader's `Word.arabic`). One lemma covers several surface forms — e.g. lemma صُّلْب covers
both صُّلْبِ (singular, 86:7) and أَصْلَٰبِ (plural, 4:23), which carry different senses.

- The **evidence drawer** and the **indication editor's per-form list** enumerate **surface
  forms**, so each word as written is its own row.
- Per-form **refinements** are keyed by the **surface form**. The reader's gloss and the word
  menu match surface-first, then fall back to the lemma key so refinements written before this
  switch still resolve (`indicationsForWord(lemma, root, surface)`; `AyahBlock.glossFor` tries
  `w.arabic` then `w.lemma`).
- When you change what a "form" means anywhere, remember the surface string in the editor comes
  from `word_occurrences.form_arabic` while the reader's comes from `Word.arabic`; they usually
  match, and the lemma fallback covers the cases they don't. Don't assume they're byte-identical.

## Architecture

Two things run: **Postgres** and the **research server**. The app (in a browser, or the desktop
window) and the MCP are clients of the research server; nothing else is a server.

```
your machine                              research server (server/, :8100)
  app  (Vite :5174, or desktop) ─ cookie ─▶  sign-in · gates (role / plan / audience)
  MCP  (stdio, started by Claude) ─ token ─▶  /corpus · /research · /community · /admin
                                                      │
                                                  Postgres (:5432)
                                         corpus · research (row-level security) · accounts
```

```
AlSiraatAlMustaqeem/
├── app/                  # React + Vite single-page app (the reader & investigation UI)
├── server/               # the research server: corpus, research, accounts, community (Postgres)
├── corpus-core/          # the corpus code (search, roots, similarity, …) + its golden-parity tests
├── mcp/                  # MCP server (stdio) — lets an AI study with you
├── electron/             # the desktop window around the built app
├── deploy/               # Docker compose, Caddy, backups (DEPLOY.md)
├── quran.db              # the corpus source, loaded into Postgres (not in git)
└── package.json          # workspace root — the commands below live here
```

- **`app/`** — the front end (React 18 + Vite + TypeScript). Reads the **corpus** from the
  research server (`${VITE_REMOTE_URL}/corpus`, default `http://localhost:8100/corpus`), and reads and
  writes your **research** in your account there (`${VITE_REMOTE_URL}/research`).
- **`server/`** — the research server (Hono + Postgres + Better Auth): the corpus, every account's
  private research (`server/src/research/`), accounts, roles, plans, the community. See `SERVER.md`
  and `CORPUS.md`.
- **`corpus-core/`** — the corpus code and its route builders, which the research server runs over
  Postgres. `corpus-core/src/corpus-db.ts` also drives it over
  `quran.db` (node:sqlite) for the tests, the parity check and the MCP's `MQ_CORPUS=local`. Ported
  1:1 from the original Python/FastAPI backend and verified by golden-parity tests (`corpus-core/test/`).
- **`mcp/`** — an MCP server over stdio so an AI client can study the corpus and your research with
  you. See "The MCP server" below.
- **`electron/`** — the desktop app: it serves `app/dist` from a tiny built-in file server and opens a
  window at it (`DESKTOP.md`).

> The backend was migrated from Python to TypeScript — see `BACKEND_TS_MIGRATION.md` (history). The
> old Python data-pipeline and API code are no longer in this repo (archived separately).

**Requirements:** Node.js **22 or newer**, and Postgres 16 running locally. No Python, no native
build tools.

---

## Running the app

All commands run from the **project root**. Postgres must be running; the research server connects
to `postgres://postgres:researchgate@localhost:5432/researchgate` unless `DATABASE_URL` says otherwise.

```bash
npm run dev        # the research server (:8100) and the web app (:5174) together
                   # open http://localhost:5174
```

First time on a machine:

```bash
npm install                                          # every workspace
npm run server:migrate                               # create/upgrade the tables (also after pulling new migrations)
npm run corpus:migrate                               # load quran.db into Postgres (~20 s)
npm run bootstrap -w @alsiraat/server -- you@example.org "Your Name"     # the first maintainer
npm run set-password -w @alsiraat/server -- you@example.org 'a password'
npm run set-plan -w @alsiraat/server -- you@example.org pro             # or open the corpus in Admin
```

The research server does **not** apply migrations when it starts in development — run
`npm run server:migrate` after pulling a change that adds one (the Docker deployment applies them on
start).

Other commands:

```bash
npm test                          # both test suites (corpus-core/, server/)
npm run typecheck                 # every workspace
npm run corpus:parity -- --quick  # prove Postgres answers exactly as quran.db
npm start                         # build the app and preview it on :8000
npm run electron:dev              # the desktop app
npm run desktop:dist              # desktop installers → dist-desktop/
```

---
## The corpus and your research

**In plain terms.** The app is one web build (optionally wrapped in a desktop window). It
**reads** the fixed Qur'an corpus from the research server (Postgres, loaded from `quran.db` and
proven identical), and **reads and writes** the reader's personal research **in their account** on
the same server — private to each account by row-level security (SERVER.md, "Your research, in
your account"). Nothing of the research is kept on the reader's machine. Two jobs:

- **The corpus is the reference material** — the Qur'an and everything known *about* its
  words: the text in every script, each word's root and form (morphology), the roots and
  their derived forms, the classical dictionaries (Lane, Lisān, Maqāyīs, Mufradāt, etc.)
  keyed to each root, plus translations and search indexes. It never changes (corrections
  ship as signed patches) and is the shared factual ground everyone reasons from. Think
  *built-in dictionary and concordance*. Reading it is a plan-gated **resource** on the research
  server — the admin can make it free.
- **Your research is what you build on top of it** — your cases and board layout, per-form
  established meanings (with revision history), trails, notes and questions, your own root
  indications and motifs, saved comparisons, and UI settings. The corpus is fixed; your research
  grows with your scholarship. Think *your personal, earned understanding of the Book*.

Anything an AI proposes through the MCP is tagged (`source = 'ai'`) and stays a proposal
until you accept it, so your own work and the AI's suggestions never blur together.

### `quran.db` — the corpus source (read-only)
The built corpus, loaded into Postgres by `npm run corpus:migrate` (CORPUS.md) and the reference
the parity checks compare against. The app never writes to it. Regenerating it requires the
archived Python pipeline (see "How quran.db was built" below); day-to-day you just use the
existing file.

### Your research — in your account (read-write)
Schema `research` on the research server (`server/migrations/0010_research_rls.sql`), one set of
tables for every account, each row carrying its `user_id` and visible only to that account.
The code is `server/src/research/` (`store.ts` the queries, `routes.ts` the HTTP routes, `serve.ts`
the per-request binding to the signed-in user).

Tables: `cases`, `form_research`, `form_revisions`, `trails`, `notes`, `user_root_meanings`,
`motifs`/`motif_roots`, `word_indications`, `compare_sets`/`compare_items`, `settings`, and the
outbox ledgers `derived_submissions`/`derived_proposed_claims`. `notes`, `word_indications` and
`motifs` carry a `source` column — `'me'` for your own work, `'ai'` for anything proposed through
the MCP server. Top-level records also carry `author_id` (your account id) and `origin`.

**Backing it up** is the research server's job: the nightly Postgres dump (DEPLOY.md, "Backups")
covers every account's research.

---

## The MCP server (`mcp/`)

Lets an AI assistant (Claude Desktop, Claude Code, any MCP client) study the Book *with* you:
it can read the corpus and your research, and propose notes and indications for you to review.

```bash
npm run mcp                       # run it directly (stdio; for a client to launch)
npm run typecheck                 # includes the mcp workspace
REMOTE_TOKEN=mqrg_… npm run smoke -w @alsiraat/mcp   # end-to-end smoke (writes into that account)
```

### Client configuration

In the app: **Account → Connect an AI assistant → Create token**. The MCP reads the corpus from
the research server **as you** — it sees exactly what your plan allows — so it needs a personal
API token. The app shows the token once, ready to paste.

**Hosted (nothing to install).** The research server runs the same MCP at `/mcp` over streamable
HTTP (`server/src/mcp-http.ts`):

- Claude app (desktop or claude.ai): Settings → Connectors → Add custom connector →
  `https://<server>/mcp/mqrg_…` (the token in the path, for clients that take only a URL)
- Claude Code, Cursor, other clients — the token as a header:

```json
{
  "mcpServers": {
    "Organic-Quranic-Methodology": {
      "type": "http",
      "url": "https://<server>/mcp",
      "headers": { "Authorization": "Bearer mqrg_…" }
    }
  }
}
```

**Local (stdio).** Needed only for `MQ_CORPUS=local` (offline, reading `quran.db`) or to work on
the MCP itself. Run `npm install` in the project root once, then point `args` at the launcher by
absolute path (no `cwd` needed):

```json
{
  "mcpServers": {
    "Organic-Quranic-Methodology": {
      "command": "node",
      "args": ["C:\\Users\\baapo\\Claude\\Projects\\AlSiraatAlMustaqeem\\mcp\\bin\\start.mjs"],
      "env": { "REMOTE_URL": "http://localhost:8100", "REMOTE_TOKEN": "mqrg_…" }
    }
  }
}
```

| Env | Meaning |
|---|---|
| `REMOTE_URL` | the research server (default `http://localhost:8100`) |
| `REMOTE_TOKEN` | your personal API token (revoke it in the app to cut the AI off) |
| `MQ_CORPUS=local` | read `quran.db` instead of the research server — offline work; no token needed |
| `QF_QURAN_DB` | where `quran.db` is, for `MQ_CORPUS=local` |

When it can't read the corpus it tells the AI why, in words it can pass on: no or revoked token →
create one in the app; below the corpus tier → which plan is needed; server unreachable → set
`REMOTE_URL`, or `MQ_CORPUS=local`. (`mcp/src/corpus-client.ts`; `corpus-core/test/mcp-remote-corpus.test.ts`
runs every corpus tool both ways and requires identical answers.)

`mcp/bin/start.mjs` exists because launching this server is deceptively fragile. Two failures
worth knowing about, both hit in practice:

- **`npm start` breaks the protocol.** npm prints its banner to **stdout**, and on stdio
  transport stdout *is* the JSON-RPC channel, so the client dies with
  `Unexpected token '>', "> @alsiraa"... is not valid JSON`. (`npm start --silent` avoids it,
  but see the next point.)
- **`node --import tsx src/index.ts` breaks too.** Clients launch servers with an arbitrary
  working directory — Claude Desktop on Windows uses `C:\WINDOWS\system32` and ignores `cwd` —
  and `--import tsx` resolves the loader **relative to the working directory**, so it fails with
  `Cannot find package 'tsx' imported from C:\WINDOWS\system32\`.

The launcher sidesteps both: it is plain `.mjs` (no loader needed to start), registers tsx
programmatically resolved **from its own location**, prints only to stderr, and says plainly
what to do if dependencies are missing. `quran.db` (for `MQ_CORPUS=local`) is likewise resolved
from the file's location, not the working directory.

Your **research** is in your account: the MCP reads it, and writes proposals into it, through the
research server with the same token — within the guard below, which the server also enforces for
every token request (`mcp/src/research-client.ts`). There is no offline research: without the
research server the tools that read or write your research say so.
`corpus-core/test/mcp-remote-research.test.ts` runs the real tools against the research server.

For running it by hand (not via a client), `npm run mcp` from the project root still works.

### What it exposes

**Tools — composed** (one call answers a study question): `study_root`, `read_ayah`,
`find_where_roots_meet`, `trace_word`, `search_quran`, `compare_forms`, `my_research_on`.
**Tools — thin** (single endpoints): `get_root`, `list_roots`, `get_verses`, `get_linkages`,
`get_echoes`, `get_wazn`, `get_spelling_variants`, `get_similar_ayat`.
**Tools — the Investigate board**: `list_cases`, `read_case` (read); `open_case`,
`add_evidence`, `add_slip`, `link_evidence`, `group_evidence`, `revise_own_item`,
`propose_conclusion` (write).

**Prompts:** `test_indication` (test a proposed meaning against every form of a root),
`study_ayah`, `review_my_root`.

**Resources:** `alsiraat://method` (the organic method and its hard rules — clients read this
first), `alsiraat://write-policy`, `alsiraat://research/summary`.

### The boundary on writes — enforced in code, not trusted to the model

| | |
|---|---|
| Corpus (research server, or `quran.db`) | **read-only**, always — and only what your plan allows |
| Translations | **not exposed at all** — the method builds meaning from Arabic, morphology and the lexicons |
| May write | notes/questions; indications with per-form refinements; cases and their board items |
| May never | edit or delete **your** notes, indications, or board items |
| May never | set an indication **primary** (your default gloss) |
| May never | write a case's **verdict** or **status**, or mark a form **established** — proposals only |
| May never | touch motifs, comparisons or your root meanings |
| Every write | tagged as AI-authored and reviewable in the app (**✦ Proposed**, and ✦ on board items) |

**The Investigate board.** An AI may open cases and add evidence āyāt, comment and
reference slips, labelled threads and clusters — and may reword or remove *only the items
it added itself*. Its conclusions go into a `proposals` list on the case, shown under
**✦ Proposed conclusions** on the desk; accepting one there is the only way it can become
your verdict or an established form meaning.

Two mechanics worth knowing:

- **Card placement is automatic.** The AI never supplies board coordinates; the server
  places new cards/slips on a free grid slot so nothing lands on top of your layout.
- **Board writes are version-checked.** A case is stored as one JSON document and
  rewritten whole on save, so a concurrent AI write could otherwise clobber an edit you
  made in the app. Every write carries the `updated_at` the AI last read and is **refused**
  if the case moved on — it must re-read and retry. Nothing of yours is lost silently.

`mcp/src/core.ts` holds the guard; `mcp/src/method.ts` holds the methodology text. The guard
forces `primary: false` explicitly — omitting it would let the *first* indication for a root be
auto-promoted, which is precisely what must not happen.

---

## `quran.db` schema (reference)

SQLite with WAL mode, foreign-key constraints enabled.

### Root hierarchy

```
roots
  id, root_buckwalter (UNIQUE), root_arabic, letters_arabic,
  letter_count, meaning_en, meaning_ar
    ↓
root_meanings                          ← per-source dictionary meanings
  id, root_id → roots, source, language, meaning, source_ref
  UNIQUE(root_id, source, language)
    ↓
root_forms
  id, root_id → roots, lemma_buckwalter, lemma_arabic,
  pos, pos_english, pos_arabic, pos_class, occurrence_count
    ↓
word_occurrences  ← VIEW (STEM segments joined to root_forms, roots, verses, words)
```

`roots.meaning_en` / `meaning_ar` are convenience columns synced from the highest-priority source
in `root_meanings`.

### Text & location

```
chapters   id, name_simple, name_arabic, name_complex, revelation_place,
           revelation_order, bismillah_pre, verses_count, pages_first, pages_last
juzs       id, juz_number, verse_mapping (JSON), first_verse_id, last_verse_id, verses_count
verses     id, chapter_id → chapters, verse_number, verse_key (UNIQUE, e.g. "2:255"),
           verse_index, text_uthmani, text_uthmani_simple, text_imlaei, text_imlaei_simple,
           text_indopak, text_uthmani_tajweed, juz_number, hizb_number, rub_el_hizb_number,
           page_number, ruku_number, manzil_number, …
words      id, verse_id → verses, verse_key, position, translation_text, transliteration_text,
           root_form_id → root_forms, root_buckwalter, root_arabic,
           lemma_buckwalter, lemma_arabic, pos, pos_arabic, pos_english, pos_class, …
word_segments
           id, verse_key, word_position, segment_number,
           segment_type (PREFIX | STEM | SUFFIX), form_buckwalter, form_arabic,
           tag, pos, pos_arabic, pos_english, pos_class,
           lemma_buckwalter, lemma_arabic, root_buckwalter, root_arabic,
           root_form_id → root_forms (STEM only), verb/noun morphology features, …
```

### Translations & search

```
translation_resources   id, name, language_name, author_name, resource_type (translation | tafsir)
verse_translations      id, verse_id → verses, verse_key, resource_id → translation_resources,
                        language_name, text
verses_fts / translations_fts   FTS5 indexes (unicode61)
```

### Handy queries

```sql
-- every occurrence of a root (e.g. هدي)
SELECT * FROM word_occurrences WHERE root_arabic = 'هدي';

-- a root with all its dictionary meanings
SELECT r.root_arabic, rm.source, rm.language, rm.meaning
FROM roots r JOIN root_meanings rm ON rm.root_id = r.id
WHERE r.root_arabic = 'هدي'
ORDER BY rm.language, rm.source;
```

---

## How `quran.db` was built (provenance)

`quran.db` was assembled by a Python pipeline that now lives outside this repo (archived). For the
record, its sources were:

1. **Quran Foundation Content API v4** — Arabic text in multiple scripts, word-by-word tokens,
   translations, transliterations, and location metadata.
2. **Quranic Arabic Corpus v0.4 (Kais Dukes)** — per-segment morphology (POS, root, lemma, case,
   voice, mood, …) in Buckwalter, converted to Arabic Unicode.
3. **Lane's Lexicon CSVs** — English root meanings (~95% of Quranic roots).
4. **arabic_lexicons DB** — 9 classical/modern dictionaries (Hans Wehr, Lane's, Lisan al-Arab,
   Maqayees, Mufradat, and others), reaching ~99% coverage of English + Arabic meanings.

To rebuild or extend the corpus (e.g. add more translation editions or tafsir), restore that
Python backup and re-run its download/build/load steps, then drop the fresh `quran.db` back into
the project root.

---

## Viewing the corpus file

Open `quran.db` with **DB Browser for SQLite** (https://sqlitebrowser.org/) or the
VS Code **SQLite Viewer** extension.
