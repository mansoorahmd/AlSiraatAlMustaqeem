# Shared Research — frozen schema (the spine)

> Build-plan step **0.2**. This is the *locked* shape the research channel is built on
> (`SHARED_RESEARCH.md` §7/§9). Freezing it first means Phases 5–7 implement against a fixed
> target instead of redesigning mid-build. Nothing here is provisional; changes after this
> point go through the additive-migration rule at the end.
>
> Two invariants are load-bearing and encoded *in the schema itself*, not just in prose:
> 1. **Safety** — every local table that sync writes is named `derived_*`. Sync writes nothing
>    else. The prefix is the audit handle: `sync-boundary.test.ts` asserts every sync write
>    targets a `derived_%` table, so the one irreplaceable file is structurally protected.
> 2. **Forward-compat** — every synced row keeps its whole object in `payload_json` and a
>    `schema_version`. Unknown fields are preserved verbatim (an old client pulls rows a newer
>    one wrote); readers project the columns they understand out of the payload.

---

## 1. Identifiers — content-addressed, versioned

One scheme everywhere, so any claim can be cited stably in writing and a redaction never
dangles.

```
canonical(obj) = JSON with keys sorted, no insignificant whitespace, UTF-8
digest(obj)    = base32( sha256( canonical(obj) ) )          // lower-case, unpadded

claim_id      = "clm_" + digest({ author_id, subject_kind, subject_value })
submission_id = "sub_" + digest({ author_id, target_kind, items[].{kind,subject,payload} })
dissent_id    = "dsn_" + digest({ author_id, claim_id, claim_version, payload })
```

- A **claim is one author's reading of one subject** (`clm_` is stable across that author's
  revisions). Successive readings are **versions** of it; a citation pins `claim_id@version`.
  A different author's reading of the same subject is a *different* claim — they contend for
  the global slot (§4 below), they don't overwrite each other.
- Self-revision (§12.2) = a new `claim_versions` row with `supersedes_version` set; the old
  version stays and stays citable.
- IDs are URL-safe from day one (base32), so a future public web view needs no ID change.

---

## 2. Local — `research.db` derived tables (drop-safe, rebuildable)

Added by the same additive migration the store already uses (`CREATE TABLE IF NOT EXISTS`).
Sync writes **only** these; your own tables (`cases`, `form_research`, `notes`, …) are never
touched by sync. All are safe to `DROP` and re-pull.

```sql
-- the group's current established reading per subject (denormalised for the gloss layer)
CREATE TABLE IF NOT EXISTS derived_global_forms (
  subject_kind   TEXT NOT NULL,               -- 'form' (lemma) | 'root'
  subject_value  TEXT NOT NULL,
  claim_id       TEXT NOT NULL,
  version        INTEGER NOT NULL,
  meaning        TEXT NOT NULL DEFAULT '',     -- the reading, pulled out of payload for fast gloss
  author_id      TEXT NOT NULL,
  established_at INTEGER NOT NULL,
  payload_json   TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  seq            INTEGER NOT NULL,             -- source stream position (for resumable pull)
  PRIMARY KEY (subject_kind, subject_value)
);

-- the ledger of disagreements against a global claim version; carries its OWN evidence (§12.4)
CREATE TABLE IF NOT EXISTS derived_dissents (
  id             TEXT PRIMARY KEY,
  claim_id       TEXT NOT NULL,
  claim_version  INTEGER NOT NULL,
  author_id      TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  redacted       INTEGER NOT NULL DEFAULT 0,   -- 1 → tombstoned upstream (see derived_redactions)
  schema_version INTEGER NOT NULL,
  seq            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_derived_dissents_claim ON derived_dissents(claim_id, claim_version);

-- others' competing readings that are visible but not (or not yet) the global one
CREATE TABLE IF NOT EXISTS derived_peer_indications (
  claim_id       TEXT NOT NULL,
  version        INTEGER NOT NULL,
  author_id      TEXT NOT NULL,
  subject_kind   TEXT NOT NULL,
  subject_value  TEXT NOT NULL,
  status         TEXT NOT NULL,                -- 'proposed' | 'established' | 'superseded'
  payload_json   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  redacted       INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL,
  seq            INTEGER NOT NULL,
  PRIMARY KEY (claim_id, version)
);
CREATE INDEX IF NOT EXISTS idx_derived_peer_ind_subject
  ON derived_peer_indications(subject_kind, subject_value);

-- others' notes/questions/evidence (additive kinds), attributed
CREATE TABLE IF NOT EXISTS derived_peer_notes (
  id             TEXT PRIMARY KEY,
  author_id      TEXT NOT NULL,
  verse_key      TEXT, word_position INTEGER, lemma TEXT, root TEXT,
  kind           TEXT NOT NULL DEFAULT 'note', -- note | question | evidence
  payload_json   TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  redacted       INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL,
  seq            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_derived_peer_notes_verse ON derived_peer_notes(verse_key);

-- others' cases — always a standalone attributed document, never merged into your board (§6)
CREATE TABLE IF NOT EXISTS derived_peer_cases (
  id             TEXT PRIMARY KEY,
  author_id      TEXT NOT NULL,
  subject_kind   TEXT, subject_value TEXT,
  title          TEXT NOT NULL DEFAULT '',
  payload_json   TEXT NOT NULL,                -- the whole case JSON document
  created_at     INTEGER NOT NULL,
  redacted       INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL,
  seq            INTEGER NOT NULL
);

-- tombstones — the target id always resolves here even after its content is redacted
CREATE TABLE IF NOT EXISTS derived_redactions (
  target_kind    TEXT NOT NULL,               -- 'dissent'|'note'|'case'|'indication'|'claim_version'
  target_id      TEXT NOT NULL,
  target_version INTEGER,                      -- NULL for unversioned targets
  by_user_id     TEXT NOT NULL,
  reason         TEXT NOT NULL,               -- shown publicly
  created_at     INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  seq            INTEGER NOT NULL,
  PRIMARY KEY (target_kind, target_id, target_version)
);

-- OUTBOUND queue: my submissions and where they stand. Drop-safe because the underlying work
-- lives in my own tables — losing the queue costs a re-submit, not data.
CREATE TABLE IF NOT EXISTS derived_submissions (
  id             TEXT PRIMARY KEY,            -- content-addressed submission id
  target_kind    TEXT NOT NULL,              -- 'additive' | 'competing' | 'document'
  status         TEXT NOT NULL DEFAULT 'draft', -- draft|queued|submitted|approved|objected|withdrawn
  supersedes     TEXT,                        -- previous submission id (re-submission chain)
  payload_json   TEXT NOT NULL,              -- FROZEN snapshot at submit time
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  schema_version INTEGER NOT NULL
);

-- per-stream pull cursor: the last seq we've pulled for each remote stream
CREATE TABLE IF NOT EXISTS derived_sync_state (
  stream         TEXT PRIMARY KEY,           -- 'global_forms'|'dissents'|'peer_notes'|'peer_cases'|'peer_indications'|'redactions'
  position       INTEGER NOT NULL DEFAULT 0, -- highest seq applied
  updated_at     INTEGER NOT NULL
);
```

`local_id` (the account-independent identity, Phase 1) lives in the existing **`settings`** table
(your own data), not here — sync never writes it. `corpus_version` / `schema_version` (Phase 2)
are a property of the *corpus*, so they live in a tiny **`corpus_meta`** table **inside
`quran.db`** — the version travels with the file it describes (a rebuilt or re-shipped corpus
carries its own version), rather than in research.db.

---

## 3. Remote — Postgres (the authoritative research channel)

The research side only; the corpus channel ships signed static files, not rows (§2 locked).
Every pull-able table carries a monotonic `seq bigint` so inbound is a plain cursor walk —
no CRDT, no bidirectional merge.

```sql
CREATE TABLE users (
  id           uuid PRIMARY KEY,
  email        text UNIQUE NOT NULL,
  display_name text NOT NULL DEFAULT '',
  role         text NOT NULL DEFAULT 'reader',   -- reader|researcher|moderator|maintainer
  local_id     uuid,                              -- bound on first sign-in (§11)
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  code         text PRIMARY KEY,
  issued_by    uuid NOT NULL REFERENCES users(id),
  role         text NOT NULL DEFAULT 'reader',
  redeemed_by  uuid REFERENCES users(id),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- a claim = one author's reading of one subject (see §1). Their evolving position on it.
CREATE TABLE claims (
  id             text PRIMARY KEY,               -- clm_… (content-addressed by author+subject)
  author_id      uuid NOT NULL REFERENCES users(id),
  subject_kind   text NOT NULL,                  -- form|root
  subject_value  text NOT NULL,
  current_version int,                           -- the author's latest version
  UNIQUE (author_id, subject_kind, subject_value)
);

CREATE TABLE claim_versions (
  claim_id           text NOT NULL REFERENCES claims(id),
  version            int  NOT NULL,
  payload_json       jsonb NOT NULL,
  established_at     timestamptz,                -- NULL while proposed; set when it enters the slot
  supersedes_version int,                        -- self-revision chain (§12.2)
  schema_version     int NOT NULL,
  seq                bigint NOT NULL,            -- stream cursor
  PRIMARY KEY (claim_id, version)
);

-- the group's CURRENT established reading per subject — the "globally established" pointer.
-- Exactly one row per subject; it names which author's claim@version holds the slot.
CREATE TABLE global_forms (
  subject_kind   text NOT NULL,
  subject_value  text NOT NULL,
  claim_id       text NOT NULL,
  version        int  NOT NULL,
  established_at timestamptz NOT NULL DEFAULT now(),
  seq            bigint NOT NULL,
  PRIMARY KEY (subject_kind, subject_value),
  FOREIGN KEY (claim_id, version) REFERENCES claim_versions(claim_id, version)
);

CREATE TABLE dissents (
  id             text PRIMARY KEY,               -- dsn_…
  claim_id       text NOT NULL,
  claim_version  int  NOT NULL,
  author_id      uuid NOT NULL REFERENCES users(id),
  payload_json   jsonb NOT NULL,                 -- carries its own evidence (§12.4)
  created_at     timestamptz NOT NULL DEFAULT now(),
  seq            bigint NOT NULL,
  FOREIGN KEY (claim_id, claim_version) REFERENCES claim_versions(claim_id, version)
);

CREATE TABLE submissions (
  id           text PRIMARY KEY,                 -- sub_…
  author_id    uuid NOT NULL REFERENCES users(id),
  target_kind  text NOT NULL,                    -- additive|competing|document
  status       text NOT NULL DEFAULT 'submitted',-- submitted|approved|objected|withdrawn
  supersedes   text REFERENCES submissions(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE submission_items (
  id            text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES submissions(id),
  kind          text NOT NULL,                   -- note|question|evidence|indication|verdict|case
  subject_kind  text, subject_value text,
  claim_id      text,                            -- set when the item targets/creates a claim
  payload_json  jsonb NOT NULL,
  schema_version int NOT NULL
);

CREATE TABLE reviews (
  id            text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES submissions(id),
  moderator_id  uuid NOT NULL REFERENCES users(id),
  decision      text NOT NULL,                   -- approve|object
  comment       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE redactions (
  id            text PRIMARY KEY,
  target_kind   text NOT NULL,                   -- dissent|note|case|indication|claim_version
  target_id     text NOT NULL,
  target_version int,
  by_user_id    uuid NOT NULL REFERENCES users(id),
  reason        text NOT NULL,                   -- public
  created_at    timestamptz NOT NULL DEFAULT now(),
  seq           bigint NOT NULL
);

CREATE TABLE sync_cursors (
  user_id  uuid NOT NULL REFERENCES users(id),
  stream   text NOT NULL,
  position bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, stream)
);
```

Pull-able **streams** (each ordered by `seq`): `claim_versions`, `global_forms`, `dissents`,
`redactions`, and the additive peer feeds (`submission_items` of approved additive submissions,
projected into `peer_notes` / `peer_cases`). The client stores the last `seq` per stream in
`derived_sync_state` (local) mirroring `sync_cursors` (remote).

---

## 4. How the pieces move (invariants, not new tables)

- **Submit** → `submissions` + `submission_items`, frozen snapshot, `supersedes` on re-submit.
  Competing items must include their argument (a case/evidence bundle) or are rejected (§12.1).
- **Review** → `reviews`. On approval of a competing item, its reading becomes a
  `claim_versions` row; a majority elevates it into `global_forms`; a minority objection is
  written to `dissents` — never argued to a conclusion.
- **Establish** sets `claim_versions.established_at` and repoints `global_forms` for the subject.
- **Redact** writes `redactions` (content gone, id still resolves); next pull flags the local
  copy `redacted = 1` and keeps it read-only.
- **Pull** = for each stream, `SELECT … WHERE seq > :cursor ORDER BY seq`, upsert into the
  matching `derived_*` table, advance the cursor. Idempotent; a full resync = reset cursors to 0.

## 5. Migration & change rule (locked)

- Local `derived_*` tables are created additively with `CREATE TABLE IF NOT EXISTS`, exactly like
  the existing store — a new table never disturbs old data.
- **Never remove or repurpose a column.** New fields are added (nullable / defaulted) and, on the
  wire, ride inside `payload_json` first; a column is only promoted out of the payload once every
  supported client understands it.
- Every synced payload carries `schema_version`; unknown keys are preserved verbatim on write and
  ignored (not dropped) on read.
- Any change to this file is itself a schema event: bump the relevant `schema_version` and note it
  in the build log.

---

## Load-bearing choices made here (flag if you'd change one)

1. **A claim is keyed by `author + subject`**, with a separate `global_forms` pointer for the
   group's chosen reading — rather than one shared claim per subject. This keeps every author's
   reading independently citable and makes "two readings coexist" fall out for free.
2. **Per-table `seq` cursors** (a monotonic column on each pull-able table) rather than one global
   event log — simpler to reason about, and streams advance independently.
3. **`derived_` prefix as the write-boundary handle** — the safety test keys off the name, so the
   protection is mechanical, not a matter of remembering.
4. **Content address = base32(sha256(canonical JSON))** with `clm_`/`sub_`/`dsn_` prefixes.
