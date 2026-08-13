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

## Still to wire (desktop integration)

The applier writes to `quran.db`, so it runs out-of-band, not through the live server (which
holds the corpus read-only). Remaining for a later pass:

- Copy the bundled `quran.db` into the OS user-data dir on first run (as `research.db` already is),
  so it's writable and patchable; the read-only handle then opens that copy.
- On startup, fetch any patches with `patchVersion > corpus_version` from the release feed and
  apply them in order before opening the window.
- Surface the loaded edition somewhere quiet (e.g. the Home *Your data* card).
