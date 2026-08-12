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

### `quran.db` — content (read-only)
The built corpus. The app never writes to it. Regenerating it requires the archived Python
pipeline (see "How quran.db was built" below); day-to-day you just use the existing file.

### `research.db` — the reader's own work (read-write)
Created and migrated automatically by the server on first run. Holds everything the reader
produces: cases (board layout, threads, clusters, slips, established meanings), trails,
notes/questions, word indications, motifs and comparisons. **This is the one irreplaceable file.**

Tables: `cases`, `form_research`, `form_revisions`, `trails`, `notes`, `user_root_meanings`,
`motifs`/`motif_roots`, `word_indications`, `compare_sets`/`compare_items` (see
`server/src/research.ts` for the schema). `notes` and `word_indications` carry a `source`
column — `'me'` for your own work, `'ai'` for anything proposed through the MCP server.

#### Saving your research to git

```bash
npm run save                    # checkpoint + commit research.db
npm run save -- "after surah 2" # ...with your own message
```

`research.db` **is** tracked in git (unlike `quran.db`, which is too large). But SQLite runs it
in **WAL mode**, so recent work often sits in the transient `research.db-wal` sidecar — which is
gitignored. A plain `git commit research.db` can therefore archive a database that is *missing
your latest work*, with no warning.

`npm run save` fixes that: it folds the WAL back into `research.db`
(`PRAGMA wal_checkpoint(TRUNCATE)`), then commits — and says so if nothing changed. **The server
can stay running.** If it reports the checkpoint was blocked by an active connection, close the
app and run it again.

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
