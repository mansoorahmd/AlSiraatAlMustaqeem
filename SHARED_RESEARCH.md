# Shared Research & Access Control — module design

> The app stays what it is: a local study, offline, no account needed to read and reason.
> This module adds a **second place** where research can be published, reviewed by other
> researchers, and agreed — without ever taking the local work out of the reader's hands.
>
> Status: **requirements refined, not yet a build plan.** Decisions below marked *(locked)*
> came from you. Items under §11 are my recommendations awaiting your yes/no.

---

## 1. Vocabulary (plain, because the jargon tripped us once)

| Term | Means |
|---|---|
| **Locally established** | A form's meaning *you* established, in your own `research.db`. Dated, yours, never overwritten by anything. |
| **Globally established** | The reading that moderators accepted into the remote database as the group's agreed meaning for that form. |
| **Dissent** | A recorded disagreement with a globally established reading, preserved rather than resolved. |
| **Submission** (your "PR") | A bundle of your work offered upstream for review. |
| ~~**Group**~~ | *Retired with teacher/learner routing (§4).* Submissions now go to one shared moderator queue, so no grouping is needed. |
| **Derived tables** | Local tables holding copies of remote data. Always rebuildable, always safe to delete. |

The word *canon* is deliberately not used anywhere in this document.

---

## 2. Direction (locked)

| Decision | Choice |
|---|---|
| Offline study | Unchanged. Local `quran.db` + `research.db` remain the working set. |
| What requires an account | The remote only. One sign-in, cached, then offline indefinitely. |
| Registration | **Invite-only.** No public signup surface. |
| Auth stack | **Better Auth** for authentication (Hono + Postgres, magic-link/passkey, invites); **hand-rolled role middleware** for authorization *(locked, see §4)*. |
| Corpus flow | One-way, remote → local. Corrections and new editions only. |
| Corpus transport | **Static, signed, versioned patch files** *(locked)* — not a hosted DB. Corrections are *releases*: a manifest with `sha256` + signature, each patch a list of upsert/delete ops by natural key against a target schema version; the client applies them in order and records `corpus_version`. |
| Research flow | Local is the source of truth for your own work. You submit upstream; you pull others' work down. |
| Remote research holds | A reviewed core of globally established readings **plus** attached dissents, with disagreement history kept. |
| Establishment | **Two parallel records that coexist** — locally established (yours) and globally established. They may differ permanently. |
| Submission unit | Anything: one indication, one note, a whole case, or a mixture. |
| Review outcome | Moderators may split. Majority reading merges; the minority objection is **filed as dissent**, not argued to a conclusion. |
| Removal of history | Maintainer may redact. **Tombstone with the reason shown publicly** — the ID always resolves. |
| Redacted item on your disk | **Marked redacted, your copy preserved.** What you actually read stays checkable. |
| Reader gloss | **Switchable layer** — my meanings / globally established / both. |
| Divergence from the group | **Margin mark in the reader** where your reading and the agreed reading differ. |
| Privacy | **Private by default**, per-item opt-in push. Open questions may be published deliberately to ask the group. |
| Citation | Globally established readings need **stable, versioned IDs**. |
| Public web view | **Not now.** Everything is read through the app. |
| The founding rule | *"Nothing is revealed"* is **retired**. The app is a research tool; the gate is no longer visibility, it is **status**. |

### The rule change, stated for the record

`DESIGN.md §1` locks *"Original research — no reveal, no answer key"*, and §2 principle 1 reads
*"Nothing is revealed — everything is built."* That is now superseded. Others' work is visible;
what distinguishes your scholarship is that **your local establishment is a separate, dated
record of what you yourself held**, standing alongside the group's. `DESIGN.md` needs editing,
not just extending — the old wording will otherwise read as a live constraint to whoever picks
this up next.

---

## 3. Two channels, not one system

They share nothing but a login. Building them together is the main way this module could go wrong.

| | Corpus channel | Research channel |
|---|---|---|
| Direction | One-way down | Up (submissions) and down (pulls) |
| Payload | Corrections, new editions, morphology fixes | Claims, arguments, reviews, dissents |
| Shape of data | Releases | Relations |
| Conflict | None possible | The entire problem |
| Who may publish | Maintainer only | Any researcher may submit |
| Who may receive | **Everyone** — a correction is not a privilege | Reader role and above |

Note the last row: role-gating *receipt* of a correction makes no sense. The gate belongs on
**publishing** a patch, which is a maintainer act.

---

## 4. Roles & access

Four roles, one ladder. Maintainer is also admin — editorial and destructive authority in one
hat *(locked)*.

| Role | May |
|---|---|
| **reader** | Pull globally established readings and dissents. No submissions. |
| **researcher** | Everything above, plus submit; publish own open questions. |
| **moderator** | Everything above, plus approve / object on submissions (an objection becomes a dissent). |
| **maintainer** | Everything above, plus publish corpus patches, issue invites, grant roles, veto, redact. |

**No tiers, no teacher/learner routing** *(locked — revised)*. Every submission lands in **one
shared moderator queue**; any moderator may approve or object, and the maintainer covers gaps.
This replaces the earlier `basic`/`advanced` tier and `teacher_id` mentorship routing — a single
flat ladder is enough, and a moderator role that can approve is simpler than per-user teacher
links. (If structured mentorship is ever wanted, add it later as its own feature.)

Resist per-root or per-surah permissions until somebody actually needs them.

### Auth stack *(locked)*

Split the problem: **buy authentication, build authorization.**

- **Authentication — [Better Auth](https://better-auth.com).** Framework-agnostic TypeScript,
  first-class **Hono** integration, runs on the remote's **Postgres**, self-hosted, MIT, no
  per-user cost. It handles sign-in, sessions/tokens, and — via its plugins — **magic-link /
  passkey** login (no passwords for an invite-only group) and **invite** redemption. Its
  `users` / `invites` tables line up with §9; the long-lived cached session serves the
  "sign in once, then offline indefinitely" requirement. (Not Lucia — sunset into a guide.
  Not a hosted service like Clerk — cost + external dependency, and it fights offline-first.)
- **Authorization — hand-rolled.** The four-rung ladder (`reader < researcher < moderator <
  maintainer`) is one ordered enum, a `role` column, and a tiny Hono middleware
  `requireRole('moderator')`. A permissions library (CASL / Casbin / oso) is overkill for a
  single linear ladder. Rolling it ourselves mirrors the existing write-boundary guard, so a
  `role-boundary.test.ts` drops in beside `case-boundary.test.ts` / `provenance.test.ts`.

The authenticated surface stays tiny: the **local reader needs no auth** (mints `local_id`,
never touches the network), and the **corpus channel needs none** (public signed patch files).
Only the research routes — sign-in, invite redeem, submit, pull — are gated.

---

## 5. Establishment: two records, side by side

- `form_research` (existing table) **is** the locally established record. It keeps its current
  shape, its revision history in `form_revisions`, and — importantly — **sync never writes to it.**
- A new derived table holds globally established readings.
- Divergence is computed by comparing the two, and surfaces in three places:
  1. a new **margin mark** in the reader (suggest ⚖, alongside ⚲ ≡ ✦ ↻ ✍);
  2. the form dossier, showing both readings and the dissents attached to the group's;
  3. a working queue — *forms where I stand apart from the group* — which is arguably the most
     valuable list in the whole app.
- The gloss layer toggle (mine / group / both) extends the mechanism the translation underlay
  already uses.

You never have to reconcile the two. Adopting the group's reading is an ordinary revision of
your own record, with your reason attached — the change of mind stays part of your history.

---

## 6. Submissions and review

### Three merge behaviours

"Anything can be a submission" is really three different operations. Naming them now prevents a
generic merge engine that handles none of them well.

| Kind | Contents | Behaviour |
|---|---|---|
| **Additive** | Notes, published questions, evidence āyāt, trails | Land as new attributed rows. Cannot conflict. Review is in/out only. |
| **Competing** | Form indications, root verdicts | Contend for the globally established slot. Majority merges; minority objection files as dissent. |
| **Document** | Cases | Always land as a **new attributed case**. Never merged into anyone else's board. |

### Submissions are immutable snapshots

A submission freezes its payload at submit time; your local work carries on moving. Re-submitting
creates a new version that references the previous one. You already learned this lesson once —
a case is a single JSON document rewritten whole, which is why board writes carry `expect_version`.
A submission that read live from a moving local case would reproduce that bug across the network.

### Citation IDs

Every claim gets a **content-addressed, versioned ID** — derived from author, subject
(root / lemma / scope) and the canonical payload, rendered URL-safe. Consequences:

- stable across sync, so it can be cited in writing;
- a revision creates a new version, so `id@v` pins exactly what was cited;
- a redaction leaves the ID resolving (see below), so citations never dangle;
- URL-safe from day one means a public web view can be added later without changing any ID —
  worth the five minutes now even though you said app-only.

### Dissent and redaction

Dissents accumulate as a ledger against a globally established reading. The maintainer may
redact one: the row survives, its content is replaced by a redaction record naming who, when and
**why, publicly** *(locked)*. On your machine, next sync marks your cached copy
`redacted_upstream` and **keeps the content read-only** — a dissent that shaped your reasoning is
not erased from your own record.

---

## 7. Where remote data lives locally

> **Frozen (build-plan 0.2):** the exact `derived_*` tables are specified in
> **`SHARED_RESEARCH_SCHEMA.md`** §2. The `derived_` prefix is the write-boundary handle.

You chose peer and group data inside `research.db`, tagged by author. That's workable, with one
invariant that must hold from the first commit:

**All remote-sourced data lives in tables marked `derived`.** They are rebuildable from the
remote, excluded from any "my work" export, and safe to drop and resync at any time. Your own
tables are untouched, and `source` on them keeps meaning exactly what it means today
(`me` / `ai`).

```
research.db
├── yours (irreplaceable, never written by sync)
│     cases, form_research, form_revisions, trails, notes,
│     user_root_meanings, motifs, word_indications, compare_*, settings
└── derived (drop-safe, always rebuildable)
      global_forms, dissents, peer_indications, peer_notes, peer_cases,
      redactions, submissions (outbound queue), sync_state
```

The point is not tidiness. It is that a sync bug must be structurally incapable of damaging the
one file you cannot replace, and that a full resync is always a safe recovery action.

---

## 8. The write boundary, extended

Today's guard protects you from the AI: propose only, never `primary`, never a verdict, never
establish. **Sync is a second writer that is not you**, and needs identical discipline.

| | |
|---|---|
| `quran.db` | read-only, always (unchanged) |
| Sync may write | derived tables only |
| Sync may never | mark a local form established; set an indication `primary`; edit or delete your notes, indications, cases, trails or motifs; write your verdicts |
| Every synced row | carries `author_id` and `origin = 'remote'`, and is visually distinct in the UI |
| Every synced payload | carries a schema version; unknown fields are preserved verbatim, never dropped |

That last row is forward-compatibility: an older client will eventually pull rows written by a
newer one. Dropping unknown keys silently corrupts other people's work.

Add `sync-boundary.test.ts` beside the existing `case-boundary.test.ts` and
`provenance.test.ts`. The reason those tests exist is the reason this one should.

---

## 9. Remote schema sketch (Postgres)

> **Frozen (build-plan 0.2):** the authoritative, column-level schema — local `derived_*`
> tables *and* this remote side — now lives in **`SHARED_RESEARCH_SCHEMA.md`**. The sketch
> below is kept as the readable overview; the schema file is the source of truth.

Research side only — this is where Postgres genuinely earns its place.

```
users(id, email, display_name, role, local_id, created_at)
invites(code, issued_by → users, role, redeemed_by, expires_at)
submissions(id, author_id, status, target_kind, created_at, supersedes → submissions)
submission_items(id, submission_id, kind, subject, payload_json, claim_id)
reviews(id, submission_id, moderator_id, decision, comment, created_at)
claims(id, subject_kind, subject_value, current_version)
claim_versions(claim_id, version, author_id, payload_json, established_at)
dissents(id, claim_id, claim_version, author_id, payload_json, created_at)
redactions(id, target_kind, target_id, by_user_id, reason, created_at)
sync_cursors(user_id, stream, position)
```

Pulls are a cursor walk (`since_position`) over append-only streams. Because the local mirror is
derived and drop-safe, **no CRDT and no bidirectional row merge is needed anywhere** — outbound
is a submission queue, inbound is a replayable log. Keep it that way.

---

## 10. Build order

0. **`research.db` one-click backup**, with the WAL checkpoint handled. Already on your open list.
   Sync is the first feature capable of losing that file — do this before anything else.
1. Identity plumbing: mint `local_id` at first launch, stamp it on rows you create; bind it to a
   real account on first sign-in.
2. **Corpus patch channel.** Fully separable, needs no research schema, delivers value alone.
3. Postgres + **Better Auth** (magic-link/passkey + invites) + hand-rolled role middleware
   (reader / researcher / moderator / maintainer) with `role-boundary.test.ts`.
4. Outbound submissions, **additive kinds only** (notes, published questions, evidence). Smallest
   end-to-end loop that proves the whole pipe.
5. Review flow → globally established forms → dissent ledger. Design claim IDs here.
6. Inbound pull into derived tables; gloss layer toggle; the ⚖ mark and its working queue.
7. Redaction and tombstones; expose citation IDs.

Steps 2 and 3 are independent and can run in parallel.

---

## 11. My recommendations — awaiting your decision

Four things I proposed that you haven't ruled on. They're written into the document above as
though accepted; say the word on any you'd rather do differently.

1. ~~**Don't model the corpus in Postgres.**~~ **DECIDED (locked, §2).** `quran.db` is 150MB
   of derived data built by a pipeline that isn't in this repo. Corrections are *releases*, not
   rows. We publish **versioned, signed static patch files** (a manifest with `sha256` and
   signature; each patch a list of upsert/delete ops by natural key, plus a target schema
   version) and the client applies them in order, recording `corpus_version`. If corrections are
   ever authored in a database, that DB sits behind the patch *generator* only — the client
   contract stays identical.
2. **Derived, drop-safe tables** inside `research.db` rather than plain author-tagged rows in
   your own tables (§7).
3. **The three merge behaviours** as distinct code paths rather than one generic merge (§6).
4. **The extended write boundary and its test** (§8).

### Identity — resolved *(locked)*

The app **mints a local identity immediately** at first launch, stamps your rows with it, and
binds it to a real account the first time you sign in (the account carries a `local_id`, §9).
Studying never requires a network or an account; the remote alone does. This replaces the earlier
*"one-time sign-in at first launch,"* which would have forced network + account on the very first
run — the cheap decision now, versus a data migration later.

---

## 12. Resolved (this pass)

Every prior open question now has a decision *(locked)*:

1. **A competing submission must carry its argument.** An indication or verdict submitted to
   contend for the global slot attaches a linked case or a minimal evidence bundle; a bare claim
   is a vote and can't be reviewed. Additive submissions stay argument-free. A moderator may still
   accept on their own reading of the attached evidence.
2. **Revising a form you already got globally established → a new claim version under your name**,
   the old version intact and still citable (`id@v`). Not a dissent against yourself — dissent is
   only for disagreeing with *someone else's* accepted reading.
3. **No co-authored submissions in v1** — single `author_id`. A contributors list can be added
   later; it's purely additive.
4. **A dissent carries its own payload** (may include its own evidence) and references the claim
   version it objects to. It must stand on its own — pointing only at the submission makes it
   fragile to redaction and meaningless once context moves.
5. **Submission size is capped at 1 MB per item** (case boards are the offender). Over the ceiling
   is rejected with "split this submission." Revisit the number if real boards exceed it.
6. **Dissolved by the role change (§4).** With no teacher/learner routing there is no teacher to
   go inactive: every submission sits in one shared moderator queue, any moderator may act, and
   the maintainer covers gaps.
