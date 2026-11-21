# The corpus

The corpus is the reference material: the Qur'an text in every script, each word's root and form
(morphology), the roots and their derived forms, the classical dictionaries (Lane, Lisān, Maqāyīs,
Mufradāt and others) keyed to each root, plus translations and search indexes. It is read-only to
the app and the MCP.

It exists in two places:

- **`quran.db`** (SQLite, project root, not in git) — the built source. Used by the tests, the
  parity check, the MCP with `MQ_CORPUS=local`, and the mobile app's build script.
- **Postgres schema `corpus`** on the research server — a copy loaded from `quran.db` and proven
  identical. This is what the app and the MCP read, at `/corpus`, gated by plan features
  (`SERVER.md`).

---

## `quran.db`

SQLite with WAL mode, foreign-key constraints enabled. Open it with DB Browser for SQLite or the
VS Code SQLite Viewer extension.

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

`corpus_meta` holds the edition (`corpus_version`, `schema_version`), so it travels with the file.

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

### Provenance

`quran.db` was assembled by a Python pipeline that lives outside this repo (archived). Its sources:

1. **Quran Foundation Content API v4** — Arabic text in multiple scripts, word-by-word tokens,
   translations, transliterations, and location metadata.
2. **Quranic Arabic Corpus v0.4 (Kais Dukes)** — per-segment morphology (POS, root, lemma, case,
   voice, mood, …) in Buckwalter, converted to Arabic Unicode.
3. **Lane's Lexicon CSVs** — English root meanings (~95% of Quranic roots).
4. **arabic_lexicons DB** — 9 classical/modern dictionaries (Hans Wehr, Lane's, Lisan al-Arab,
   Maqayees, Mufradat, and others), reaching ~99% coverage of English + Arabic meanings.

To rebuild or extend the corpus (more translation editions, a tafsir), restore that Python backup,
re-run its download/build/load steps, drop the fresh `quran.db` into the project root, and reload
Postgres (`npm run corpus:migrate`).

---

## The corpus in Postgres

### Loading it

```bash
npm run corpus:migrate              # load quran.db → Postgres schema "corpus", then verify
npm run corpus:migrate -- --verify  # re-verify an existing copy (e.g. after replacing quran.db)
```

Source is `QF_QURAN_DB` (default `./quran.db`), opened read-only. Target is the server's
`DATABASE_URL`, schema **`corpus`** — the research and community tables are never touched.
Code: `server/src/corpus/` (`schema.ts`, `load.ts`, `verify.ts`); tests
`server/test/corpus-migrate.test.ts`.

**Guarantees.** Refuses a non-UTF8 database before touching anything (Arabic would be corrupted).
The whole rebuild is **one transaction** — a failed load rolls back and the previous copy survives.
Re-running rebuilds to the same state. `corpus.corpus_meta` records the edition in the patch
channel's own keys (`corpus_version`, `schema_version`) plus the source file's sha256.

**Verification is total, not sampled.** Every table is reduced on both sides to a row count and an
order-independent fingerprint of every column of every row, so one changed diacritic fails it. Also
checked: column lists, the `word_occurrences` view (count + content), 9/9 foreign keys, 29/29
indexes, and that the copy is of *this* file. First real run: **294,804 rows, 143.5 MB, 18 s,
exact**.

**Translation choices that matter:**

- **`COLLATE "C"` on every text column.** Byte order — the exact equivalent of SQLite's `BINARY`.
  The database's own collation would sort and compare Arabic differently; identical ordering on
  both engines depends on this.
- **ids are copied verbatim**; AUTOINCREMENT tables become identity columns whose sequences are
  advanced past the copied ids, so a later insert can't collide.
- **FTS5 → Postgres full-text.** The two FTS5 tables were external-content indexes (no data of
  their own), so they become GIN indexes on `verses` / `verse_translations`.

### One corpus codebase, two drivers

Rather than a Postgres twin of the query layer (which would drift), **every corpus service is
written once**, async, against a small interface — `CorpusDb {query, one, scalar}` in
`corpus-core/src/corpus-db.ts` — with two drivers:

| Driver | Where | Used by |
|---|---|---|
| `sqliteCorpus(db)` | `corpus-core/src/corpus-db.ts` | tests, the parity check, the MCP with `MQ_CORPUS=local` |
| `pgCorpus(runner)` | `server/src/corpus/pg-corpus.ts` (`?` → `$n`) | the research server's `/corpus` |

`createCorpusServices(db)` (`corpus-core/src/corpus-services.ts`) builds all of them — content,
roots, linkages, wazn, expressions, echoes, links, constructions, spellings, free-text, similarity,
word forms. The route
builders in `corpus-core/src/routes/` take the services plus optional *entitlements* (translation
and lexicon filters); the research server mounts them at `/corpus` (`server/src/corpus/serve.ts`)
with the plan filters plugged in, and the tests mount the same builders over `quran.db`. Expensive
indexes are built once per process (`once()`); the server warms them at startup (`warmCorpus`).

**Portable SQL.** What makes one codebase give identical answers on both engines:

- `GROUP BY` every non-aggregated column (Postgres rejects bare columns; SQLite silently picks one).
- A **total** `ORDER BY` wherever order is visible — SQLite's storage order had been hiding ties.
  Example: 20:94 يَبْنَؤُمَّ carries two roots (ب ن ي, أ م م) at one word position; ordering by
  `root_form_id` as the last key fixed Postgres without changing SQLite's answer.
- `DISTINCT` → `GROUP BY … ORDER BY MIN(id)` (DISTINCT has no defined order).
- Nullable sort keys: `NULLS FIRST` ascending, `NULLS LAST` descending (SQLite's behaviour).
- Postgres `int8` counts are normalised to numbers in the driver.
- Text is `COLLATE "C"`, so Arabic compares byte for byte.

**Proven identical.** `npm run corpus:parity` serves the SAME routes over each driver and compares
the JSON of every answer over HTTP, key order included. Full sweep (2026-09-26): **77,439 requests,
all identical** — every chapter in every script, every verse (words, translations, echoes, similar
verses, neighbours, wazn, spellings), navigation filters, every root (list, detail, forms,
occurrences, linkages), root pairs, word occurrences, phrase / expression / free-text search.
`-- --quick` samples ~3,000. `server/test/corpus-parity.test.ts` runs ~50 URLs on a fixture in CI,
and `corpus-core/test/mcp-remote-corpus.test.ts` proves the MCP's tools answer identically over
HTTP.

### Study tools that find and count

`corpus-core/src/routes/tools.ts`, over `occurrences.ts`, `spellings.ts`, `voices.ts`,
`wording.ts`, `spread.ts`, `supplications.ts` and `frame.ts`; tests in
`corpus-core/test/study-tools.test.ts`. None interprets.

| Route | Answers |
|---|---|
| `POST /occurrences` `{kind, key, query?, limit?, offset?}` | every place a thing occurs, Book order, several per āyah where it recurs; `total` / `ayahs` are full counts, `places` capped at 6000 (`truncated`). Kinds: `phrase`, `pair`, `form`, `lemma`, `root` take a `LinkMarker.key` first, then typed Arabic (a form or lemma with or without marks, a root spaced, unspaced or in Buckwalter); `spelling` one rasm shape (the whole word or its stem written so, whatever the word), or `<group key>|<spelling>` (`3:35:3|ٱمْرَأَتُ`): one spelling of one word exactly as `GET /spellings` counts it, no place when the list has no such spelling; `construction` a grammar `query`. A pair key, or a Rare-links phrase key (n 2–5), answers from that marker's own āyāt (`LinkIndex.runPlaces`), so its count is the list's by construction; a Links-panel phrase whose key is also a Rare link's is counted the Rare link's way (first word with or without a leading و / ف) |
| `GET /spellings?kind=&q=&sort=` · `GET /spellings/:key` | every word written more than one way (the ✍ grouping), most places first, or by the Arabic alphabet with `sort=alpha`. A word is one group: inflections that agree once case and definiteness are set aside (for a verb also person, gender, number and mood) and write the stem with the same letters somewhere are joined, so كِتَٰب is listed once with and without ٱل and قَالَ counts قَالُوا۟; tense, voice, verb form and a noun's number keep words apart. Each spelling is shown in the vocalisation most of its words carry; each spelling's count, āyāt and places (12 in the list, all in a group). `kinds` names where two spellings part by the letters only (ت/ة at the end, alif or small alif, ى/ي/small ي, ا or ى, و or ا, hamza seat, one ت or two, a letter doubled; آ against ا is a mark, named only alone) or `ending`: the shapes differ only in final long vowels that are the case ending of each shape's commonest case (و/وا nominative, ى/ي genitive or accusative, ا in a nominative dual or an accusative with tanwīn). Without `kind`, groups whose only kind is `ending` are left out and counted in `hidden`; their words are not ✍ variants (`/verses/:key/spelling`, `/chapters/:id/variants`). A feminine noun is one group whether or not it is indefinite, so ٱمْرَأَتُ (12:30) meets ٱمْرَأَةً (27:23). A ة that a pronoun turned into ت (ٱمْرَأَتُهُ, رَحْمَتِهِ) is the script's rule, not a spelling. Where the bare word is written both ة and ت, its pronoun-carrying words are counted with neither and returned as the group's `withPronoun` (ٱمْرَأَت: ت 7, ة 4, with a pronoun 13), and they carry no ✍ mark; where the bare word is only ever ة, such a word is read with ة and counted in that spelling's `attached`, so a difference elsewhere still shows (صَلَوٰة, صَلَاتِهِمْ). `ending` is strict about two cases: the ا of tanwīn only where every indefinite accusative has it and nothing else does, and ا beside ى only in a dual or where the ى keeps to its case (so the ا of هُدَاىَ is a spelling). Not grouped at all: a stem's ا / آ after the question ءَ (آللَّهُ, read as ٱللَّه), and verbs ending in weak letters with a different short vowel before them (يَبْلُوَ / يَبْلَىٰ, يَسْقِى / يُسْقَىٰ). A group's key is its first word, `chapter:verse:word` |
| `GET /chapters/:id/speech-openers?roots=` | every verb of ق و ل (`sure: true`) and of ن د و (`sure` only where the corpus tags a vocative (VOC) or an explaining أَنْ (INT) after it before another verb). `roots` = up to 10 more roots, Arabic letters, comma-separated (422 beyond): their verbs come `added: true`, `sure` as for ن د و; unknown roots find nothing. Where speech ends is not guessed |
| `GET /verses/:key/pronouns?verbs=1` | separate pronouns (PRON stems), attached ones (PRON suffixes, and a PRON stem after a preposition prefix), and with `verbs=1` each verb's person / number / gender (`type: "verb"`, `pronoun` empty). `part` numbers a word's pronouns from 1 in segment order, the verb's subject counted even when not returned, so it never shifts (mentions are stored by it) |
| `POST /spread` `{roots}` | 1–60 roots (Arabic or Buckwalter; 422 otherwise): places (words) and āyāt per sūrah (all 114, with `verses`) and per page (`verses.page_number`, all 604), totals, `emptyChapters`, `emptyPages`, `unknown`. An āyah with two of the roots counts once |
| `GET /supplications?opening=` | every رَبَّنَا (رَبّ + نَا, accusative, not after an ACC-tagged particle such as إِنَّ), رَبِّ (the ى of "my" not written) and ٱللَّهُمَّ (its own lemma), Book order; `openings` always counts all three. The morphology cannot tell an object from an address (25:21 is listed) |
| `GET /chapters/:id/frame?n=` | the roots both in the first and the last `n` āyāt (1–10, default 3, lowered to half the sūrah); per root its places at each end, `level` (`form` = same rasm, `lemma`, `root`), `inBook` (words with the root); rarest first |
| `POST /wording-check` `{text}` | up to 200 words (422 beyond): `written` (exact, vowels and all), `letters` (same letters, other vowels; also the long ā the Book writes with و, ٱلصَّلَوٰة for الصلاة), `stem` (after setting aside و ف, then ب ل ك س, then ال), `none` |
| `GET /diff?a=&b=` | two āyāt aligned (longest common run of their folded words; the stretches between by least cost on lemma, root, part of speech); rows `same`, `marks`, `spelling`, `changed`, `only-a`, `only-b` |

Construction search also takes `derivation` (`ACT_PCPL`, `PASS_PCPL`, `VN`: the corpus's own
marks), `verbForm` (I–XII; the corpus writes no form for I, so a verb or derived noun with none
is I), `suffix` (the attached pronoun's person-gender-number code, or `any`) and `noun`
(`number`, `gender`; a noun with a gender and no number is singular, as the corpus leaves the
singular unmarked). Text copied from the displayed āyah writes two things differently from the
morphology (a hamza on a tatweel, the small high ي U+06E7); `asSegments` in `spellings.ts`
reconciles them before any lookup.

---

## The patch channel

How corrections to `quran.db` are shipped: one-way (maintainer → everyone), no review. A correction
is a *release*, not a database row — a **signed, versioned patch file** that is verified and
applied in order. The patch tool is `quran.db`'s one sanctioned writer.

**Not yet for Postgres.** The patch tool writes SQLite only. After patching `quran.db`, re-run
`npm run corpus:migrate` to carry the correction into the server's copy. (The `corpus_meta` keys
are already mirrored in Postgres, so the ordering and idempotency rules carry over when a
Postgres target is built.)

### The pieces

- **`corpus-core/src/corpus/patch.ts`** — the whole contract: canonicalization, `sha256`, Ed25519
  sign/verify, and `applyPatch` (verify → order/idempotency gate → apply in one transaction).
- **`corpus-core/src/corpus/keys.ts`** — loads the trusted public key (`QF_CORPUS_PUBKEY`, or
  `corpus/trusted-key.pub.pem`).
- **`corpus-core/src/corpus/cli.ts`** — `keygen` / `sign` / `apply` / `version`.
- **`GET /corpus/corpus/version`** (on the research server) — reports the loaded edition
  (`{ version, schemaVersion }`), read-only.

### Patch shape

```jsonc
{
  "id": "corpus-2026.08-003",
  "schemaVersion": 1,        // corpus schema this patch targets
  "patchVersion": 3,         // monotonic; applied in ascending order
  "parent": 2,               // the corpus_version required before applying (null = base)
  "note": "fix tatweel in 55:1; lexicon typo for ر-ح-م",
  "ops": [
    { "op": "upsert", "table": "verses", "key": { "verse_key": "55:1" }, "set": { "text_uthmani": "…" } },
    { "op": "delete", "table": "root_meanings", "key": { "root_id": 42, "resource": "scratch" } }
  ]
}
```

Ops address rows by **natural key** (verse_key, root, segment position — never an internal
rowid), so a patch stays valid across a full corpus rebuild. `upsert` = UPDATE the row matching
`key`, or INSERT `key`+`set` if absent; `delete` removes the row matching `key`. Table/column
names are validated as identifiers; all values are bound parameters.

### Guarantees

- **Signed** — Ed25519 over the canonical patch bytes; a tampered patch (content ≠ `sha256`) or
  one signed by an untrusted key is refused.
- **Ordered** — a patch whose `parent` isn't the current `corpus_version` is refused, so
  intermediate editions can't be skipped.
- **Idempotent** — re-applying an already-applied patch (`patchVersion ≤ current`) is a safe no-op.
- **Atomic** — all ops of a patch land in one transaction; a failing op rolls the whole patch back
  and the version is not advanced.

### Using it

```bash
# one-time: generate the maintainer keypair. Commit corpus/trusted-key.pub.pem;
# keep corpus/maintainer-key.priv.pem secret (it is gitignored).
npm run corpus -w @alsiraat/corpus-core -- keygen

# author a patch.json (see shape above), then sign it:
npm run corpus -w @alsiraat/corpus-core -- sign patch.json corpus/maintainer-key.priv.pem > signed.json

# apply to a corpus (defaults to ./quran.db; honours QF_QURAN_DB):
QF_QURAN_DB=/path/to/quran.db npm run corpus -w @alsiraat/corpus-core -- apply signed.json

# check the loaded edition:
npm run corpus -w @alsiraat/corpus-core -- version
```
