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
  flight. Configuration (reading preferences, the research database, backups) lives in
  **Settings**, behind the gear in the top bar. Mixing "what am I working on" with "how is the
  app set up" is what turns a page into a dumping ground — if a card doesn't answer the
  screen's question, it belongs somewhere else.

## Architecture

A TypeScript app in three parts, run as one npm workspace:

```
AlSiraatAlMustaqeem/
├── app/                  # React + Vite single-page app (the reader & investigation UI)
├── server/               # Hono API on Node (serves /api/v1) + Vitest parity tests
├── mcp/                  # MCP server (stdio) — lets an AI study the corpus with you
├── quran.db              # read-only content (Quran text, words, roots, translations)
├── research.db           # read-write user research (cases, trails, notes, established meanings)
├── package.json          # workspace root — the commands below live here
├── run-dev.bat / .sh     # convenience dev launchers
├── BACKEND_TS_MIGRATION.md
└── DESIGN.md
```

- **`app/`** — the front end (React 18 + Vite + TypeScript). Talks to the API at `/api/v1`.
- **`server/`** — the back end (Hono + Node's built-in `node:sqlite`). Reads `quran.db`
  (read-only) and reads/writes `research.db`. Ported 1:1 from the original Python/FastAPI backend
  and verified by golden-parity tests (`server/test/`).
- **`mcp/`** — an MCP server over stdio that reuses the back end's query layer, so an AI client
  can study the corpus and your research with you. See "The MCP server" below.

> The backend was migrated from Python to TypeScript — see `BACKEND_TS_MIGRATION.md`. The old
> Python data-pipeline and API code are no longer in this repo (archived separately).

**Requirements:** Node.js **22 or newer** (the API uses the built-in `node:sqlite`). No Python,
no native build tools needed.

---

## Running the app

All commands run from the **project root**.

```bash
npm install        # one-time — installs the app, server and mcp workspaces

npm run dev        # start API (:8000) and web app (:5174) together
                   # open http://localhost:5174
                   # (wait for the "[api] AlSiraat API on http://localhost:8000" line
                   #  on first start — the API's first compile takes a few seconds)

npm test           # run the backend parity test suite (server/test)

npm run build      # build the web SPA → app/dist
npm start          # build + serve the SPA and API together on one port (:8000)
```

`run-dev.bat` (Windows) and `run-dev.sh` (macOS/Linux) just wrap `npm run dev`.

**Config (optional):** the server looks for the databases at the project root by default. Override
with env vars if needed: `QF_QURAN_DB`, `QF_RESEARCH_DB`, `PORT` (default 8000), and
`SERVE_STATIC=1` to also serve the built SPA (what `npm start` sets). CORS is open so a future
mobile app can call `/api/v1` directly.

---

## The two databases

**In plain terms.** The app is one web build (optionally wrapped in a desktop window).
Both the reader UI and the AI (through the MCP server) talk to a single Hono server, and
that server is the *only* thing that touches either database. It **reads** the fixed Qur'an
corpus and **reads and writes** the reader's personal research. Two files, two jobs:

- **`quran.db` is the reference material** — the Qur'an and everything known *about* its
  words: the text in every script, each word's root and form (morphology), the roots and
  their derived forms, the classical dictionaries (Lane, Lisān, Maqāyīs, Mufradāt, etc.)
  keyed to each root, plus translations and search indexes. It ships with the app, never
  changes, and is the shared factual ground everyone reasons from. Think *built-in
  dictionary and concordance*.
- **`research.db` is what you build on top of it** — your cases and board layout, per-form
  established meanings (with revision history), trails, notes and questions, your own root
  indications and motifs, saved comparisons, and UI settings. The corpus is fixed; this
  file grows with your scholarship, and it's the one irreplaceable file. Think *your
  personal, earned understanding of the Book*.

Anything an AI proposes through the MCP is tagged (`source = 'ai'`) and stays a proposal
until you accept it, so your own work and the AI's suggestions never blur together.

### `quran.db` — content (read-only)
The built corpus. The app never writes to it. Regenerating it requires the archived Python
pipeline (see "How quran.db was built" below); day-to-day you just use the existing file.

### `research.db` — the reader's own work (read-write)
Created and migrated automatically by the server on first run. Holds everything the reader
produces: cases (board layout, threads, clusters, slips, established meanings), trails,
notes/questions, word indications, motifs and comparisons. **This is the one irreplaceable file.**

Tables: `cases`, `form_research`, `form_revisions`, `trails`, `notes`, `user_root_meanings`,
`motifs`/`motif_roots`, `word_indications`, `compare_sets`/`compare_items`, `settings` (see
`server/src/research.ts` for the schema). `notes` and `word_indications` carry a `source`
column — `'me'` for your own work, `'ai'` for anything proposed through the MCP server.

Every top-level record you author (`cases`, `notes`, `trails`, `motifs`, `user_root_meanings`,
`word_indications`, `compare_sets`) also carries `author_id` + `origin`: `author_id` is your
account-independent **`local_id`** (a UUID minted on first run, kept in `settings`, exposed at
`GET /research/identity`), and `origin` is `'local'` for your work vs `'remote'` for peer work
pulled by a future sync. `source` says *who the agent was* (me/ai); `origin` says *where it came
from* (local/remote). When accounts arrive, the account binds to this `local_id`, so work done
before signing in stays correctly attributed. See `SHARED_RESEARCH_BUILD.md` (Phase 1).

#### Whose research is it? (the `owner` record)

**The database says who it belongs to, from inside itself.** `research.db` has a one-row `owner`
table holding a **name**, an email, and a uuid **derived from the email** (`uuidv5`,
`server/src/identity.ts`). That makes the file self-describing and portable: copy it to another
machine, rename it, or hand it to a colleague, and it still knows whose research it is.

- **Day 0 is whenever there's no usable database** — no file, or a file nobody has claimed. The
  app asks for a **name and email** (`OwnerGate`) before anything else and stamps them, so
  nothing is ever written un-attributed.
- **The uuid is the `local_id`** that remote work binds to — same person, same id, any machine.
- **It can be re-assigned.** You hold the file, so you may fix a typo or hand it on
  (`PUT /research/owner`, name and/or email). The research in the file is untouched; changing
  the email re-derives the uuid. Omitting the name keeps the existing one.
- **Moving machines is deliberately manual**: back the file up, carry it, open it there. There
  is no magic sync of local files.
- **Opening a database COPIES it in.** Working on a backup in place turns that backup into a
  live database (WAL sidecars appear beside it), so it stops being the untouched copy you took.
  `Databases.adopt()` copies the file to the working path and you edit the copy; any database
  already there is moved aside to `research-replaced-<timestamp>.db` — never overwritten — and
  the UI says where it went. `inPlace: true` opts out.
- **Home → Your data** shows the owner and the file, lets you change either, and can open any
  `.db` (a backup, a colleague's) — the desktop uses a native file dialog.
- **Publishing requires a match.** The share controls refuse when the signed-in account isn't
  the database's owner, so you can't publish someone else's research under your name.

`server/src/databases.ts` is deliberately dumb: it only remembers which files this *machine* has
opened (`databases.json`) so the app knows what to open at startup. It is never the source of
truth about identity — deleting it costs nothing but the recent-files list.

Opening a different file reopens the server's handle (`reopenResearch`) rather than restarting,
so the routes read `state.research` per request — never capture it.

#### Backing it up

`research.db` is **not** tracked in git — it's your personal data, so keep your own backups. Any
of three ways, all producing a *complete* copy (the WAL is folded in for you, so you never end up
with a half-written file):

- **In the app** — Home → *Your data* → **Back up research**. On the desktop this opens a save
  dialog; on the web build it drops a timestamped copy in a `backups/` folder next to the db.
- **From the command line** (app can be closed or open):

  ```bash
  npm run backup                  # → backups/research-<timestamp>.db next to the db
  npm run backup -- /path/out.db  # → an explicit location
  ```

  Honours `QF_RESEARCH_DB`, so it also backs up the desktop copy: `QF_RESEARCH_DB="<userData>/research.db" npm run backup`.
- **Copy the file yourself** — fine too, but SQLite runs in **WAL mode**, so first fold the WAL in
  (close the app for a clean shutdown, or `PRAGMA wal_checkpoint(TRUNCATE)`), else the copy misses
  recent work.

All three use SQLite's `VACUUM INTO` (see `server/src/backup.ts`), which writes a single merged
copy atomically — safe to run while you're working. In the **desktop app**, `research.db` lives in
the OS user-data dir (not the repo) — see `DESKTOP.md`.

---

## The MCP server (`mcp/`)

Lets an AI assistant (Claude Desktop, Claude Code, any MCP client) study the Book *with* you:
it can read the corpus and your research, and propose notes and indications for you to review.

```bash
npm run mcp                       # run it directly (stdio; for a client to launch)
npm run typecheck                 # includes the mcp workspace
QF_RESEARCH_DB=/tmp/smoke.db npm run smoke -w @alsiraat/mcp   # end-to-end smoke test
```

### Client configuration

**First, once:** run `npm install` in the project root — `mcp/` is a workspace and needs its
dependencies.

Then point your client at the launcher by absolute path. Nothing else is needed — no `cwd`, no
`env`:

```json
{
  "mcpServers": {
    "Organic-Quranic-Methodology": {
      "command": "node",
      "args": ["C:\\Users\\baapo\\Claude\\Projects\\AlSiraatAlMustaqeem\\mcp\\bin\\start.mjs"]
    }
  }
}
```

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
what to do if dependencies are missing. Databases are likewise resolved from the file's location,
not the working directory.

Override the databases with `QF_QURAN_DB` / `QF_RESEARCH_DB` if you want it to read a copy. The
app's own server does **not** need to be running — the MCP server opens the databases directly.

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
| Corpus (`quran.db`) | **read-only**, always |
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

## Viewing the databases

Open `quran.db` or `research.db` with **DB Browser for SQLite** (https://sqlitebrowser.org/) or the
VS Code **SQLite Viewer** extension.
