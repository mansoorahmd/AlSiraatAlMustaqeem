# Shared Research — build plan

> Turns `SHARED_RESEARCH.md` (the locked design) into an ordered, checkable build. Every
> decision here is already settled in that document; this file is *how* and *in what order*.
>
> Two ropes run the whole way through and are **not** optional:
> - **Safety invariant** — a sync/network bug must be structurally unable to touch the one
>   irreplaceable file. Remote data only ever lands in `derived`, drop-safe tables; your own
>   tables and your establishment are never written by sync.
> - **Forward-compat** — every synced payload carries a schema version; unknown fields are
>   preserved verbatim, never dropped (an old client will pull rows written by a newer one).

Legend: **⇢ depends on** · *AC* = acceptance criteria · files are indicative.

---

## Phase 0 — Safety & the spine on paper (before any network code)

Sync is the first feature that can lose `research.db`, and the claim/dissent schema is the
spine everything hangs off. Lock both before writing sync code.

- [x] **0.1 One-click `research.db` backup** with the WAL checkpoint handled (a clean copy,
  not a half-written one). ✅ `VACUUM INTO` core (`server/src/backup.ts`) + `POST /research/backup`
  route; Home → *Your data* button (desktop save dialog via `window.desktop`, web → sibling
  `backups/`); `npm run backup` CLI fallback; `backup.test.ts` (WAL-dirty → complete copy, 4 tests);
  documented in `INSTRUCTIONS.md`.
  *AC:* backup of a live, WAL-dirty db opens clean and complete; documented in `INSTRUCTIONS.md`. ✅
- [x] **0.2 Finalise the derived-table + claim/dissent schema on paper.** ✅ Frozen in
  **`SHARED_RESEARCH_SCHEMA.md`**: local `derived_*` tables (global_forms, dissents,
  peer_indications/notes/cases, redactions, submissions, sync_state), the remote Postgres side
  (users, invites, claims, claim_versions, global_forms, dissents, submissions, submission_items,
  reviews, redactions, sync_cursors), the content-addressed `clm_/sub_/dsn_` ID scheme, the
  per-table `seq` cursor model, and the additive-migration + `derived_` write-boundary rules.
  §7/§9 now point to it as source of truth.
  *AC:* §7/§9 reviewed and frozen; no table added later without a migration note. ✅

---

## Phase 1 — Local identity (no network, no account)

- [x] **1.1 Mint `local_id`** (UUID) at first launch, persisted in `research.db` settings. ✅
  `ResearchStore.ensureLocalId()` (stable across sessions); exposed at `GET /research/identity`.
- [x] **1.2 Stamp `author_id = local_id`, `origin = 'local'`** on every row the reader creates. ✅
  `author_id`/`origin` columns added additively to `cases`, `notes`, `trails`, `motifs`,
  `user_root_meanings`, `word_indications`, `compare_sets`; set on every `save*` (preserved on
  update); pre-Phase-1 rows backfilled once via `stampTable`. `source` (me/ai) still answers *who
  the agent is*, `origin` answers *local vs remote*.  ⇢ 1.1
  *AC:* every new + migrated row carries author + origin; `identity.test.ts` (mint, stability,
  legacy backfill) + `provenance.test.ts` extended. ✅ 108/108 tests, typechecks clean.

---

## Phase 2 — Corpus patch channel (fully separable, delivers value alone)

No research schema, no auth — can run in parallel with Phase 3.

- [x] **2.1 Patch file format** — ✅ `server/src/corpus/patch.ts`: signed envelope (Ed25519 over
  canonical bytes + `sha256`), patch with `schemaVersion`/`patchVersion`/`parent`, ops = upsert/
  delete by **natural key**. Documented in `CORPUS.md`.
- [x] **2.2 Client applier** — ✅ `applyPatch`: verify → order + idempotency gate → apply in one
  transaction; `corpus_version`/`schema_version` recorded in a `corpus_meta` table inside
  `quran.db`; `GET /corpus/version` reports it.  ⇢ 2.1
  *AC:* signed patch upgrades deterministically; bad/again-applied = safe no-op; tamper + untrusted
  key rejected; atomic rollback on a bad op. ✅ `corpus-patch.test.ts` (6 tests). 114/114 total.
- [x] **2.3 Patch generator** (author side) — ✅ `server/src/corpus/cli.ts` (`keygen`/`sign`/
  `apply`/`version`) via `npm run corpus -w server -- …`; private key gitignored.  ⇢ 2.1
- [ ] **2.4 Desktop integration** (follow-up) — copy `quran.db` to user-data (writable), apply
  pending patches on startup before opening the window, show the edition in the UI. (See `CORPUS.md`.)

---

## Phase 3 — Remote foundation: Postgres + Better Auth + roles

- [x] **3.1 Stand up the remote research service** — ✅ new `remote/` workspace (Hono + `pg`),
  full schema in `migrations/0001_init.sql`, forward-only idempotent migration runner + CLI,
  service skeleton. Schema validated against real Postgres via **PGlite** (`migrations.test.ts`).
  Defaults to `postgres://postgres:researchgate@localhost:5432/researchgate`. (You run `createdb`
  + `npm run remote:migrate` on your box.)
- [ ] **3.2 Better Auth** — magic-link sign-in + invite redemption; long-lived cached session
  (sign in once, then offline indefinitely).  ⇢ 3.1  *(next step)*
- [x] **3.3 Role middleware** — ✅ `src/roles.ts`: ordered ladder + `requireRole(min)`
  (401/403/200), hand-rolled. `role-boundary.test.ts` (7 tests).  ⇢ 3.1
- [ ] **3.4 Bind `local_id` → account** on first sign-in; stamp remote rows with `author_id`.  ⇢ 1.1, 3.2  *(next step)*
  *AC:* invite → sign-in → session survives offline; role gate enforced and tested ✅; local work
  authored before sign-in adopts the bound account.

---

## Phase 4 — Outbound submissions, additive kinds only (prove the pipe)

Smallest end-to-end loop; cannot conflict, so no claim machinery yet.

- [ ] **4.1 Submission snapshot model** — payload frozen at submit time, `supersedes` pointer,
  `expect_version` on the write (so a moving local case can't corrupt a submission).  ⇢ 0.2, 3.4
- [ ] **4.2 Submit additive kinds** — notes, published open questions, evidence āyāt; they land
  upstream as new **attributed** rows.  ⇢ 4.1
- [ ] **4.3 Size cap** — reject > **1 MB per item** with "split this submission."  ⇢ 4.1
  *AC:* create a note → submit → it appears as an attributed remote row; over-cap is rejected.

---

## Phase 5 — The spine: claims, review, global establishment, dissent

The convergence-free heart. Build after the pipe is proven but from the Phase 0 design.

- [ ] **5.1 Claims tables** — `claims`, `claim_versions`, `dissents` (from 0.2).
- [ ] **5.2 Content-addressed claim IDs** — hash(author + subject + canonical payload) → URL-safe
  `id`; a revision is a new `id@v` that pins exactly what was cited.  ⇢ 5.1
- [ ] **5.3 Competing submissions must carry their argument** — an indication/verdict attaches a
  linked case or minimal evidence bundle; additive stays argument-free.  ⇢ 4.2, 5.1
- [ ] **5.4 Review flow** — moderator approve/object; majority reading merges to *globally
  established*; a minority objection is **filed as dissent**, never argued to a conclusion.  ⇢ 5.3
- [ ] **5.5 `sync-boundary.test.ts`** — sync writes `derived` only; never marks a local form
  established, never sets an indication `primary`, never edits/deletes your notes/indications/
  cases/trails/motifs.  ⇢ 5.1
  *AC:* a competing claim can be globally established; a split files a dissent; boundary test green.

---

## Phase 6 — Inbound pull + reader integration

- [ ] **6.1 Pull** globally established readings + dissents into `derived` tables — a cursor walk
  over append-only streams, replayable, drop-safe (full resync is always a safe recovery).  ⇢ 5.1
- [ ] **6.2 Gloss layer toggle** — mine / group / both (extends the translation-underlay
  mechanism).  ⇢ 6.1
- [ ] **6.3 Divergence surfacing** — the **⚖ margin mark**, the form dossier showing both readings
  + attached dissents, and the *"where I stand apart"* working queue.  ⇢ 6.1
  *AC:* resync is idempotent and can't damage local work; divergence shows in all three places.

---

## Phase 7 — Redaction, tombstones, citations

- [ ] **7.1 Redaction** — maintainer redacts a row; content replaced by a tombstone naming
  who / when / **why (public)**; the ID always resolves.  ⇢ 5.1
- [ ] **7.2 Local preservation** — next sync marks the cached copy `redacted_upstream` and keeps
  it **read-only** (a dissent that shaped your reasoning is not erased from your record).  ⇢ 6.1, 7.1
- [ ] **7.3 Expose citation IDs** (`id@v`) in the UI for writing.  ⇢ 5.2

---

## Ordering & parallelism

```
0 ──▶ 1 ──▶ 4 ──▶ 5 ──▶ 6 ──▶ 7
      │            ▲
      └──▶ 3 ──────┘
   2 (independent — runs any time after 0)
```

Phase **2 (corpus)** and Phase **3 (remote/auth)** are independent and can run in parallel;
both only need Phase 0 done. Everything from 4 onward is the research channel and is linear.

## Definition of done (per phase)

A phase is done when its *AC* holds, its tests are green (`npm test`, `npm run typecheck`), and
any new tables are reflected in `INSTRUCTIONS.md` (schema) and, if user-facing, `DESIGN.md`.
