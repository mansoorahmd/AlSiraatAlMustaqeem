# AlSiraatAlMustaqeem — Mobile (Android, offline-first)

An Expo / React Native + TypeScript app that brings the **Reader**, **Search**,
and **Roots** experiences to Android, working fully **offline**. It ships the
Quran corpus as an on-device SQLite database and runs the same queries the web
server runs — no network, no API.

> Scope of this first version (agreed): **Reader + Search + Roots**, Android
> first, offline-first. The case board, vault, echoes, focus lens and notes UI
> from the web app are intentionally out of scope here (the writable
> `research.db` schema and a personal-meaning editor are already wired so those
> can follow).

---

## How it works

```
Expo app (React Native, TS)
├── assets/db/quran-mobile.db     read-only corpus, copied to the device on first launch
├── src/data/db.ts                Db interface + expo-sqlite impl + first-run bootstrap
├── src/data/{content,roots,linkages,search}.ts
│                                 pure query modules — PORTED 1:1 from server/src
├── src/text/{constants,normalize}.ts
│                                 Buckwalter map + Arabic folding — verbatim from the server
├── src/data/api.ts               makeApi(db): a sync, on-device mirror of app/src/api/client.ts
├── src/data/research.ts          writable research.db (notes, questions, personal root meanings)
└── src/screens/*                 ReaderHome · Reader · Search · RootsExplorer · RootDetail
```

The query modules depend only on a tiny `Db` interface (`query / one / scalar /
run / exec`). On the phone that interface is backed by **expo-sqlite** (sync
API); in the parity harness it's backed by Node's built-in **node:sqlite**.
Same SQL, same transforms, same results — that's how parity is proven without
running the app.

### Parity with the server

```bash
npm run parity        # needs esbuild (npm i -D esbuild) + the project quran.db
```

Bundles the real `src/data` + `src/text` modules and diffs their output against
the server's golden fixtures (`../server/test/fixtures`). Current status:
**21/22 checks pass**; the single diff is `translations_1:1`, where the bundled
`quran.db` now carries more translation editions than the frozen fixture — the
SQL is identical to the server's, so on-device output matches what the server
returns today.

**Search — parity note.** Phrase search and all Reader/Roots queries are exact
ports. "Related" (free-text) search ports the server's free-text resolver and
the **lexical** half of its similarity engine (TF-IDF root overlap + phrase
run, weights 0.6/0.4). The server additionally blends a morphology (POS
n-gram) score; porting that blend is the one follow-up needed for full
composite-ranking parity. `overlap`, `phrase`, `phrase_run` and `shared` match
the server's lexical layer exactly.

---

## Build & run (Android)

Prerequisites: **Node 22+**, the Expo tooling, and Android Studio (SDK +
emulator) or a device with USB debugging.

```bash
cd mobile
npm install

# 1) Build the offline corpus (reads ../quran.db → assets/db/quran-mobile.db).
#    A prebuilt copy may already be present; regenerate any time with:
npm run build:db          # or: node scripts/build-db.mjs /path/to/quran.db

# 2) Run on Android
npm run android           # expo run:android — builds a dev client & installs it
#   (first native build takes a while; afterwards `npm start` + `a` is enough)
```

For a shareable APK/AAB use EAS:

```bash
npm i -g eas-cli
eas build -p android --profile preview      # cloud build → installable APK
```

### About the ~143 MB database

`assets/db/quran-mobile.db` is the **full corpus** — identical to the server's
`quran.db`: all 6 scripts, the complete word-by-word morphology, the classical
lexicon (`root_meanings`, ~48 MB), and **all 168 translation/tafsir editions**.
It's copied into place on first launch by `expo-sqlite`'s `SQLiteProvider`
(`src/state/DbContext.tsx`), which uses the native importer.

Delivery: ship as an **AAB** so Play handles the size; a bare APK this large is
fine for sideloading. (Optional: host the file and fetch it on first run instead
of bundling, to keep the install small — still fully offline afterwards.)

`scripts/build-db.mjs` builds the asset. By default (`TRIM = false`) it ships the
full corpus, just consolidating the WAL into a single standalone file. Set
`TRIM = true` for a smaller build that drops the unused FTS shadow tables + the
empty embeddings table and keeps only the editions in `KEEP_RESOURCES`. After
regenerating, bump `QURAN_DB_NAME` in `src/data/db.ts` so devices recopy the new
file.

**Choosing translations in the reader:** since all 168 editions are bundled, the
Reader's **Translations (N)** control opens a picker to select which editions
appear under each āyah (default: Saheeh International + Urdu). All editions stay
in the DB regardless.

---

## What each screen does

- **Read** — sūrah index → continuous āyah reader. Script toggle (Uthmani /
  Imlaei / IndoPak / simple), word-by-word gloss toggle, translation toggle.
  Tap any word for a sheet with its transliteration, gloss, lemma and POS, and
  a jump into that word's root.
- **Search** — *Phrase* (verbatim, alef-insensitive) and *Related* (free-text
  Arabic → āyāt sharing roots, with the resolved roots shown). On-screen Arabic
  keyboard so no system layout is needed.
- **Roots** — every root ordered rarest ↔ most common, filterable by meaning or
  spelling → a lexicon page with your own meaning (saved locally), the
  dictionaries grouped by language, the derived forms, the roots it co-occurs
  with, and every occurrence (tap to read it in context).

---

## Type-check

```bash
npm install && npm run typecheck
```
