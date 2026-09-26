# Corpus patch channel

How corrections to `quran.db` are shipped. This is the **corpus channel** from
`SHARED_RESEARCH.md` §3: one-way (maintainer → everyone), no research schema, no auth — a
correction is a *release*, not a database row, and it reaches everyone as a **signed, versioned
patch file** the client verifies and applies in order.

Distinct from the research channel: nobody "submits" a corpus fix through review; the maintainer
publishes a patch and clients apply it. `quran.db` stays read-only to the app — the patch tool is
its one sanctioned writer.

## The pieces

- **`server/src/corpus/patch.ts`** — the whole contract: canonicalization, `sha256`, Ed25519
  sign/verify, and `applyPatch` (verify → order/idempotency gate → apply in one transaction).
- **`server/src/corpus/keys.ts`** — loads the trusted public key (`QF_CORPUS_PUBKEY`, or
  `corpus/trusted-key.pub.pem`).
- **`server/src/corpus/cli.ts`** — `keygen` / `sign` / `apply` / `version`.
- **`GET /api/v1/corpus/version`** — reports the loaded edition (`{ version, schemaVersion }`),
  read-only.
- Version lives in a `corpus_meta` table **inside `quran.db`**, so it travels with the file.

## Patch shape

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

## Guarantees

- **Signed** — Ed25519 over the canonical patch bytes; a tampered patch (content ≠ `sha256`) or
  one signed by an untrusted key is refused.
- **Ordered** — a patch whose `parent` isn't the current `corpus_version` is refused, so
  intermediate editions can't be skipped.
- **Idempotent** — re-applying an already-applied patch (`patchVersion ≤ current`) is a safe no-op.
  A client offline for months catches up by replaying patches in order.
- **Atomic** — all ops of a patch land in one transaction; a failing op rolls the whole patch back
  and the version is not advanced.

## Using it

```bash
# one-time: generate the maintainer keypair. Commit corpus/trusted-key.pub.pem;
# keep corpus/maintainer-key.priv.pem secret (it is gitignored).
npm run corpus -w server -- keygen

# author a patch.json (see shape above), then sign it:
npm run corpus -w server -- sign patch.json corpus/maintainer-key.priv.pem > signed.json

# apply to a corpus (defaults to ./quran.db; honours QF_QURAN_DB):
QF_QURAN_DB=/path/to/quran.db npm run corpus -w server -- apply signed.json

# check the loaded edition:
npm run corpus -w server -- version
```

## The corpus in Postgres (step 1 — data moved, verified)

The corpus is moving to the cloud. **Step 1 is done: the data is in Postgres and proven exact.**
The app and the MCP still read `quran.db`; they move over in step 2.

```bash
npm run corpus:migrate            # load quran.db → Postgres schema "corpus", then verify
npm run corpus:migrate -- --verify  # re-verify an existing copy (e.g. after replacing quran.db)
```

Source is `QF_QURAN_DB` (default `./quran.db`), opened read-only. Target is the remote's
`DATABASE_URL`, schema **`corpus`** — the remote's research tables in `public` are never touched.
Code: `remote/src/corpus/` (`schema.ts`, `load.ts`, `verify.ts`); tests `remote/test/corpus-migrate.test.ts`.

**Guarantees.** Refuses a non-UTF8 database before touching anything (Arabic would be corrupted).
The whole rebuild is **one transaction** — a failed load rolls back and the previous copy survives.
Re-running rebuilds to the same state. `corpus.corpus_meta` records the edition in the patch
channel's own keys (`corpus_version`, `schema_version`) plus the source file's sha256.

**Verification is total, not sampled.** Every table is reduced on both sides to a row count and an
order-independent fingerprint of every column of every row, so one changed diacritic fails it. Also
checked: column lists, the `word_occurrences` view (count + content), 9/9 foreign keys, 29/29 indexes,
and that the copy is of *this* file. First real run: **294,804 rows, 143.5 MB, 18 s, exact** — and the
same study query (every form of هدي) returns the identical answer, in the identical order, on both.

**Translation choices that matter:**

- **`COLLATE "C"` on every text column.** Byte order — the exact equivalent of SQLite's `BINARY`.
  This database's own collation (`English_United States.1252`) would sort and compare Arabic
  differently; the identical-order result above is the proof that this choice is load-bearing.
- **ids are copied verbatim**; AUTOINCREMENT tables become identity columns whose sequences are
  advanced past the copied ids, so a later insert can't collide.
- **FTS5 → Postgres full-text.** The two FTS5 tables were external-content indexes (no data of their
  own), so they become GIN indexes on `verses` / `verse_translations`.

### Step 2 — what porting the readers involves (not started)

- **Sync → async.** The corpus query layer (`server/src/roots.ts`, `content.ts`, `similarity/`,
  `echoes.ts`, `spellings.ts`, `wazn.ts`, `freetext.ts`, `linkages.ts`, `expressions.ts`) is built on
  synchronous `node:sqlite`; `pg` is async, so every function and every caller (routes, MCP tools)
  gains an `await`. This is the bulk of the work.
- **`LIKE` differs.** SQLite's `LIKE` is case-insensitive for ASCII; Postgres's is case-sensitive —
  use `ILIKE` wherever a query relied on that.
- **Arabic full-text needs its own decision.** Postgres's parser can split vocalised Arabic at the
  diacritics, depending on the database's character settings. Likely answer: a diacritic-folded
  search column, or `pg_trgm`. Compare results against FTS5 before switching search.
- **The signed patch channel** (`server/src/corpus/patch.ts`) writes SQLite; it needs a Postgres
  target. The `corpus_meta` keys are already mirrored, so the ordering/idempotency rules carry over.
- **Parity.** Run the server's existing golden-parity suite against the Postgres-backed layer — the
  same tests that proved the Python→TypeScript port.

## Still to wire (desktop integration)

The applier writes to `quran.db`, so it runs out-of-band, not through the live server (which
holds the corpus read-only). Remaining for a later pass:

- Copy the bundled `quran.db` into the OS user-data dir on first run (as `research.db` already is),
  so it's writable and patchable; the read-only handle then opens that copy.
- On startup, fetch any patches with `patchVersion > corpus_version` from the release feed and
  apply them in order before opening the window.
- Surface the loaded edition somewhere quiet (e.g. the Home *Your data* card).
