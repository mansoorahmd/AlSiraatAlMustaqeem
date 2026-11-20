# AlSiraatAlMustaqeem — Mobile (Android, offline-first)

An Expo / React Native + TypeScript app that brings the **reading experience** of the web app to
Android, working fully **offline**. It ships the Qur'an corpus as an on-device SQLite database and
runs its own ports of the corpus queries — no network, no API, no account.

It is separate from the rest of the repo: not an npm workspace, its own `package.json`, and its
own on-device `research.db` for the reader's notes and preferences. (The web app keeps research
in the account on the research server; the mobile app does not talk to that server.) It was last
worked on in August 2026, before the web side moved to Postgres.

**In scope:** everything a reader touches. **Out of scope:** the Investigate side — the case
board, evidence cards, threads and clusters, the form dossier, establishing meanings and root
verdicts, curated case files, case export — and anything to do with accounts or the community.

---

## What's built

| Area | Notes |
|---|---|
| Mushaf reader | scripts (Uthmani / Imlaei / IndoPak / simple / Tajweed text), word-by-word, font scaling, resume reading, preferences sheet |
| Translations | all 168 editions bundled, with a picker (default: Saheeh International + Urdu) |
| Word sheet | transliteration, gloss, lemma, POS, root, **wazn** (Form I–XII, participles, masdar), spelling variants, follow, notes |
| Roots | explorer (rarest ↔ most common), lexicon page, dictionaries by language, forms, collocations, occurrences grouped by form, **my meaning** |
| Search | phrase (verbatim, alef-insensitive), related (free-text, full composite ranking), on-screen Arabic keyboard, verse-key jump, recent searches |
| Expression search | long-press to pick words in an āyah → every āyah where they co-occur; Verbatim / By-roots toggle |
| Notes & questions | on an āyah or a word; answer / reopen / edit / delete; global Open Questions screen |
| Marks | ≡ verbatim echoes, ✍ spelling variants (minority spelling only), ⚲ rare root, ↻ root repeated in one āyah, ⊙ focus, ✎ notes; a `LegendSheet` explains them |
| Related āyāt + focus lens | closest-first with shared roots and phrase run; pin an āyah as a reading lens |
| Trails | follow the exact written word **or** the root, stop by stop, with a 114-sūra strip; save and resume |
| Compare | named, saveable comparisons on a vertical timeline; "Add to Compare" wherever an āyah shows |
| Focus shortlist | up to 5 āyāt + 5 roots, persisted, surfaced on Home |
| Motifs | create / rename / delete; add roots from a root page |
| Home | continue reading, open questions, my meanings, recent trails, in focus |
| Share with… | an āyah or root bundle (Arabic, translation, roots, dictionaries, your notes) to the OS share sheet, with saved prompts and a dictionary picker |
| Backup | Home → **Back up my research** exports `research.db` through the OS share sheet |
| App icon, splash, onboarding | wired |

Screens: `Home`, `ReaderHome`, `Reader`, `Search`, `RootsExplorer`, `RootDetail`, `Trail`,
`Compare`, `Motifs`, `MyMeanings`, `OpenQuestions` (`src/screens/`).

### Still to do

- Run the actual **`eas build`** (needs an Expo account) to get the APK / AAB.
- Add a **KFGQPC Uthmanic** and an **IndoPak** font binary. Amiri Quran is bundled; IndoPak's
  Private-Use-Area waqf marks are stripped until a matching face is added
  (`assets/fonts/README.md`).
- Deferred, optional: Tajweed colour rendering, a dark theme, a deeper accessibility pass,
  precomputing the similarity index off-thread (it builds on first use behind a "Preparing…"
  overlay, ~2–3 s, then is cached).

---

## How it works

```
Expo app (React Native, TS)
├── assets/db/quran-mobile.db     read-only corpus, copied to the device on first launch
├── src/data/db.ts                Db interface + expo-sqlite impl + first-run bootstrap
├── src/data/{content,roots,linkages,search,echoes,expressions,spellings,variants,wazn}.ts
│                                 pure query modules, ported from the web side's corpus code
├── src/similarity/{lexical,morphology,compose,freetext}.ts
│                                 the similarity engine (related āyāt, focus lens, free-text search)
├── src/text/{constants,normalize}.ts
│                                 Buckwalter map + Arabic folding
├── src/data/api.ts               makeApi(db): a sync, on-device counterpart of the web app's client
├── src/data/research.ts          writable research.db (notes, questions, meanings, trails,
│                                 motifs, comparisons, focus, prefs)
└── src/screens/*
```

The query modules depend only on a tiny `Db` interface (`query / one / scalar / run / exec`). On
the phone that interface is backed by **expo-sqlite** (sync API); in the parity harness it's
backed by Node's built-in **node:sqlite**. The echo (≡) and spelling-variant (✍) indexes build
through an async read with chunked yielding, so the reader doesn't freeze when marks appear.

**Spelling variants.** `VariantIndex` (`data/variants.ts`) keys groups by lemma + morphology
(`raw_features`) + a normalised skeleton, excludes compounds and assimilations (words whose stems
carry more than one lemma, e.g. مِمَّا = مِن+مَا), and marks only the minority spelling. The word
sheet reads its variants from the same index, so a ✍-marked word always shows its spellings and
an unmarked one never does.

### Parity with the web side's corpus code

```bash
npm run parity        # needs esbuild (npm i -D esbuild) + the project quran.db
```

Bundles the real `src/data`, `src/similarity` and `src/text` modules and diffs their output
against the golden fixtures in `../corpus-core/test/fixtures`. Every new data-layer module gets a
parity check before its UI is built.

---

## Build & run (Android)

Prerequisites: **Node 22+**, the Expo tooling, and Android Studio (SDK + emulator) or a device
with USB debugging.

```bash
cd mobile
npm install

# 1) Build the offline corpus (reads ../quran.db → assets/db/quran-mobile.db).
#    A prebuilt copy may already be present; regenerate any time with:
npm run build:db          # or: node scripts/build-db.mjs /path/to/quran.db

# 2) Run on Android
npm run android           # expo run:android — builds a dev client & installs it
#   (first native build takes a while; afterwards `npm start` + `a` is enough)

npm run typecheck
```

For a shareable build use **EAS** (profiles are in `eas.json`):

```bash
npm i -g eas-cli
eas login
eas build -p android --profile preview       # cloud build → installable APK (sideload / share)
eas build -p android --profile production     # → AAB for Google Play
```

The `preview` profile emits a standalone **APK**; `production` emits an **AAB** for the Play
Store (which handles the ~143 MB corpus cleanly). Both run without Metro — the database is
bundled and copied on first launch.

### About the ~143 MB database

`assets/db/quran-mobile.db` is the **full corpus** — the same content as the project's
`quran.db`: every script, the complete word-by-word morphology, the classical lexicon
(`root_meanings`, ~48 MB), and all 168 translation/tafsir editions. It's copied into place on
first launch by `expo-sqlite`'s `SQLiteProvider` (`src/state/DbContext.tsx`).

`scripts/build-db.mjs` builds the asset. By default (`TRIM = false`) it ships the full corpus,
just consolidating the WAL into a single standalone file. Set `TRIM = true` for a smaller build
that drops the unused FTS shadow tables + the empty embeddings table and keeps only the editions
in `KEEP_RESOURCES`. After regenerating, bump `QURAN_DB_NAME` in `src/data/db.ts` so devices
recopy the new file.
