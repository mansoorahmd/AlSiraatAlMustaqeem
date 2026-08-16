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
- [x] **3.2 Better Auth** — ✅ `src/auth.ts`: magic-link plugin, mapped onto our snake_case
  `users`, year-long session refreshed weekly; `0002_auth.sql` adds session/account/verification.
  Invite-only enforced twice: `disableSignUp: true` (Better Auth never creates a user) **and**
  `redeemInvite()` as the only creation path, granting the role carried by the invite.
  `src/invites.ts` + `bootstrap-cli.ts` (the first maintainer can't be invited).
  `invites.test.ts` (10 tests: single-use, expiry, duplicate email, role-from-invite).  ⇢ 3.1
  **Verified live** against PostgreSQL 18.4: service boots, magic link issued and redeemed,
  session cookie set, `GET /me` returns the bootstrapped maintainer's id + role — so the whole
  authn → session → role-gate chain works, not just the unit-tested parts.
- [x] **3.3 Role middleware** — ✅ `src/roles.ts`: ordered ladder + `requireRole(min)`
  (401/403/200), hand-rolled. `role-boundary.test.ts` (7 tests).  ⇢ 3.1
- [x] **3.4 Bind `local_id` → account** — ✅ `users.local_id`, bound at redemption
  (`redeemInvite({ localId })`) or later via `POST /me/local-id` (`bindLocalId`); reported by
  `GET /me`. Tested both paths.  ⇢ 1.1, 3.2
  *AC:* invite → sign-in → session survives offline (year-long session, sign-in verified live ✅);
  role gate enforced and tested ✅; local work authored before sign-in adopts the bound account ✅.

### Phase 3.5 — Account UI (added: the plan specified the server, never the client)

- [x] **3.5 Account & invites UI** — ✅ `app/src/api/remote.ts` (credentialed client for the
  remote; treats "not running" as *not connected*, never an error) + `AccountSheet.tsx` in a
  Home side-sheet: sign in by magic link, redeem an invite, issue invites (maintainer), link this
  device's `local_id`, sign out. **No passwords anywhere** — magic link replaces them.
  Desktop: `openSignIn` opens the sign-in page in an **in-app Electron window** so the cookie
  lands in the app's session, closing itself on the remote's new `GET /signed-in` page; the
  shell's stable port is in `TRUSTED_ORIGINS` (both `localhost` and `127.0.0.1`).
  *AC:* app typecheck + build clean; remote 31/31 (incl. `cors.test.ts`); `auth.ts`/`session.ts`
  now typecheck against the real `better-auth@1.6.27`.
- [x] **3.5a Fix: CORS only covered `/api/auth/*`** — ✅ `/me`, `/invites`, `/invites/redeem` had
  no CORS headers, so the browser blocked them. Because a CORS rejection throws from `fetch()`
  exactly like an unreachable server, the app reported the misleading *"research server isn't
  reachable"*. Now `app.use("*", cors(...))`, pinned by `cors.test.ts`; the client additionally
  probes `/health` with `mode: "no-cors"` to tell **down** from **origin-blocked** and says which.
  ⚠ Still needs your local run: the in-app sign-in window and the cross-origin session cookie.

**Phase 3 complete** — also `npm run smoke -w @alsiraat/remote`: 9/9 against real Postgres
(version, migrations, Better Auth tables, `gen_random_uuid()` default, role CHECK, dissent FK,
invite flow via node-postgres, `local_id` binding, cleanup).

---

## Phase 4 — Outbound submissions, additive kinds only (prove the pipe)

Smallest end-to-end loop; cannot conflict, so no claim machinery yet.

- [x] **4.1 Submission snapshot model** — ✅ `remote/src/submissions.ts`: payload frozen at submit
  time, `supersedes` pointer (own submissions only), and the id is **content-addressed**
  (`sub_` + base32 sha256 of author + items, `remote/src/ids.ts`) so re-submitting the identical
  bundle is idempotent instead of duplicating — a stronger guarantee than `expect_version`, which
  isn't needed while items are frozen snapshots rather than live reads.  ⇢ 0.2, 3.4
- [x] **4.2 Submit additive kinds** — ✅ note / question / evidence land as attributed rows;
  competing kinds are refused until Phase 5. Routes `POST|GET /submissions`, `GET /submissions/:id`,
  guarded at **researcher** (a reader may pull but not publish). `ShareButton` on Home's open
  questions — renders nothing unless you're signed in with permission.  ⇢ 4.1
- [x] **4.3 Size cap** — ✅ >1 MB per item rejected with "split this submission" (413).  ⇢ 4.1
  *AC:* create a note → submit → it appears as an attributed remote row ✅; over-cap rejected ✅.
  `submissions.test.ts` (14 tests). 45/45 remote.
- [x] **4.4 Local outbound ledger** — ✅ *(gap found in use: editing a shared record and
  re-sharing produced an orphaned duplicate, because the client never passed `supersedes` — it
  had no memory of what it had sent.)* `derived_submissions` in research.db now keys on
  `local_ref` and stores the `content_hash` as submitted, so the share control has three honest
  states that survive a restart: **↑** (never shared) · **Shared** (unchanged) · **Update**
  (edited since — re-shares chained via `supersedes`). Routes `GET|PUT /research/submission-log`.
  `submission-log.test.ts` (6 tests, incl. self-migration onto an older db). 120/120 server.

---

## Phase 5 — The spine: claims, review, global establishment, dissent

The convergence-free heart. Build after the pipe is proven but from the Phase 0 design.

- [x] **5.1 Claims tables** — ✅ used as frozen (`claims`, `claim_versions`, `dissents`,
  `global_forms`); `0003_claim_reviews.sql` lets a review attach to a CLAIM VERSION rather than
  only a submission, with one verdict per moderator per version.
- [x] **5.2 Content-addressed claim IDs** — ✅ `clm_` = hash(author + subject), so a claim is ONE
  AUTHOR'S reading and successive readings are versions of it: `id@v` pins exactly what was cited.
- [x] **5.3 Competing submissions must carry their argument** — ✅ `proposeClaim` refuses a bare
  assertion; it needs a linked case, evidence āyāt, or reasoning (§12.1).
- [x] **5.4 Review flow** — ✅ **majority of the votes cast** (the term was undefined; now locked
  in §2): established when `approvals ≥ requiredApprovals` **and** `approvals > objections`.
  Not a majority of all moderators — waiting on people who never look would stall forever.
  `REQUIRED_APPROVALS` is config (1 today). You may not approve your own claim; a maintainer may
  establish directly, recorded as their act. An objection never blocks, and against an
  established reading it becomes a **dissent** carrying its own payload (§12.4).
  `claims.test.ts` (13 tests).
- [x] **5.5 `sync-boundary.test.ts`** — ✅ the `derived_` prefix genuinely partitions the schema:
  every table is classified as sync-writable or the reader's own, an unclassified table fails the
  test, and the ledger is proven drop-safe. Caught a misleading `syncFormResearch` name (it
  reconciles the reader's own case board, nothing remote) — renamed.
  *AC:* a competing claim can be globally established ✅; a split files a dissent ✅; boundary
  test green ✅. Remote 58/58, server 49/49 on the affected suites.
- [x] **5.6 Propose / review from the app** — ✅ the spine was CLI-only; now the UI drives it.
  Client methods `remote.propose` / `remote.claims` / `remote.review` / `remote.establish` over
  the existing routes. In the indication editor: **◈ Propose to community** on your own reading
  (root scope) opens a panel that enforces §12.1 — a meaning alone can't be sent, it needs an
  argument (or a cited case). Selecting a community reading shows role-gated **✓ Approve / ✕
  Object / ★ Establish** (moderator+/maintainer), refusing your own reading exactly as the
  server does. All of it writes upstream, so each success says *"Sync to see it"* rather than
  faking a local change. Signed-in role comes from a shared `useMe()` hook.

## Phase 6 — Inbound pull + reader integration

- [x] **6.1 Pull** — ✅ `remote/src/pull.ts`: `GET /pull`, a cursor walk over append-only rows.
  Replayable, resumable, and all-zero cursors are a full resync. Locally
  `derived_global_forms` / `derived_dissents` / `derived_peer_indications` /
  `derived_sync_state` + `applyPull` (upsert by key, unknown payload fields kept verbatim).
  `POST /research/pull/{apply,reset}`; reset is always safe.  ⇢ 5.1

  **ONE CURSOR PER STREAM.** The first version shared a single `since` across all streams by
  taking the max, which reads as conservative but was a data-loss bug. Each table's `seq` is
  its own `bigserial`, so the counters run in parallel: once one stream reached seq 5, rows in
  another still at seq 3 were never delivered. Nothing errored — they simply never arrived,
  which is the worst failure mode a sync protocol can have. Found when pulled community
  indications didn't show: the shared cursor was already past them. `derived_sync_state` was
  keyed by `stream` from the start (schema §2) for exactly this reason, and the pull now uses
  it. Guarded by *"one stream running ahead never skips rows in another"*.
- [x] **6.3 Divergence surfacing** — ✅ the **⚖ "Where I stand apart"** screen (Study menu):
  every form you established whose meaning differs from the group's, both readings side by side,
  with a count of dissents filed against theirs, and a jump to the case where you established
  yours. It changes NEITHER reading — that is the point.  ⇢ 6.1
- [x] **6.2 Community indications** — ✅ *(replaces the planned "gloss layer toggle")*.

  **Why the change.** 6.3 compares one established reading of yours against one of theirs. But
  a reader doesn't hold one reading — they hold several indications per root and switch between
  them. `form_research` (case establishment) was empty in real use while `word_indications` held
  all the actual research, so the comparison screen had nothing to say. The design already named
  the right unit: §"Competing" says *form indications, root verdicts*.

  So the group's readings now arrive as **more indications**, shown in the same list as your
  own and marked as theirs — not as a verdict standing over against yours.

  - `pullSince` sends **every** claim version, not only established ones: a losing claim is
    still someone's argued reading. `status` (`established` | `proposed` | `superseded`) is
    **derived per pull**, so a claim that gains or loses the global slot corrects itself on the
    next walk with no upstream rewrite.
  - Migration `0004` adds `claim_versions.created_at`: `established_at` is NULL while merely
    proposed, and a re-pulled row must carry a **stable** date or an idempotent upsert would
    keep rewriting it.
  - Local `derived_peer_indications` (per `SHARED_RESEARCH_SCHEMA.md` §2), returned by
    `indicationsForWord` in **separate** `communityRoot` / `communityLemma` arrays — never
    merged into the reader's own, and covering both root and form scope.
  - UI: lapis + ◈ against the gold of your own work, with status and dissent count. No star and
    no ✕ — you cannot promote or edit someone else's reading. To hold what they hold, you write
    it yourself, which keeps every indication in your database one you actually chose.

  *AC:* resync is idempotent and can't damage local work ✅ — `remote/test/pull.test.ts` (9, new:
  `pullSince` had no test of its own before) and `server/test/sync-boundary.test.ts` (12,
  including that a peer-indication pull leaves `word_indications` byte-identical and that
  re-pulling updates in place rather than duplicating). Divergence screen ✅; **still to come:**
  dissents in the form dossier, and the ⚖ margin mark in the reader.

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
