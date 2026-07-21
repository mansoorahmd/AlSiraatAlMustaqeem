# AlSiraatAlMustaqeem — Project Instructions

**Purpose:** Engage the Quran using an organic Quranic methodology — exploring the text through
its own internal linguistic structure, particularly the root-word system of Arabic. The app links
every word back to its trilateral/quadrilateral root and lets the reader *build* meaning through
investigation: gathering ayah evidence, notes, and cited references, following root/phrase trails,
and establishing their own understanding.

---

## Architecture

A TypeScript app in two parts, run as one npm workspace:

```
AlSiraatAlMustaqeem/
├── app/                  # React + Vite single-page app (the reader & investigation UI)
├── server/               # Hono API on Node (serves /api/v1) + Vitest parity tests
├── quran.db              # read-only content (Quran text, words, roots, translations)
├── research.db           # read-write user research (cases, trails, notes, established meanings)
├── package.json          # workspace root — the commands below live here
├── run-dev.bat / .sh     # convenience dev launchers
├── BACKEND_TS_MIGRATION.md
└── UI_ACTION_PLAN.md
```

- **`app/`** — the front end (React 18 + Vite + TypeScript). Talks to the API at `/api/v1`.
- **`server/`** — the back end (Hono + Node's built-in `node:sqlite`). Reads `quran.db`
  (read-only) and reads/writes `research.db`. Ported 1:1 from the original Python/FastAPI backend
  and verified by golden-parity tests (`server/test/`).

> The backend was migrated from Python to TypeScript — see `BACKEND_TS_MIGRATION.md`. The old
> Python data-pipeline and API code are no longer in this repo (archived separately).

**Requirements:** Node.js **22 or newer** (the API uses the built-in `node:sqlite`). No Python,
no native build tools needed.

---

## Running the app

All commands run from the **project root**.

```bash
npm install        # one-time — installs the app + server workspaces

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
produces: cases (board layout, threads, clusters, slips, established meanings), trails, and
notes/questions. **This is the one irreplaceable file — back it up by copying it.**

Tables: `cases`, `form_research`, `form_revisions`, `trails`, `notes` (see
`server/src/research.ts` for the schema).

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
