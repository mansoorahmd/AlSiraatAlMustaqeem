# Remote research channel (`remote/`)

The invite-only research server. It holds **everything**: the **Qur'an corpus**, **each account's own
research** (private, one Postgres schema per account), and the **community**, where research is
published, reviewed, and agreed (`SHARED_RESEARCH.md`). The app and the MCP read and write it as the
signed-in user.

Backed by **Postgres** (where a structured, multi-writer, transactional store earns its place —
`SHARED_RESEARCH.md` §3). The corpus lives in schema `corpus`, loaded from `quran.db` and proven
identical (`CORPUS.md`); each account's research in `research_<account id>`. Access follows one rule:
**features are role-based, resources are plan-based**, and every published result is seen only by its
**audience** (below).

## What's built (Phase 3)

- **Schema** — `migrations/0001_init.sql`: the full research-channel schema from
  `SHARED_RESEARCH_SCHEMA.md` §3 (users, invites, claims, claim_versions, global_forms, dissents,
  submissions, submission_items, reviews, redactions, sync_cursors), with role/kind CHECKs, `seq`
  cursors, and referential integrity. `0002_auth.sql` adds Better Auth's `session` / `account` /
  `verification` tables and the identity columns on `users`. Validated against real Postgres.
- **Migration runner** — `src/migrate.ts` (forward-only, tracked in `_migrations`, idempotent),
  CLI `src/migrate-cli.ts`.
- **Role ladder + guard** — `src/roles.ts`: `reader < researcher < moderator < maintainer`,
  `requireRole(min)` Hono middleware (401 unauthenticated, 403 below the rung). Hand-rolled, not a
  permissions library.
- **Authentication** — `src/auth.ts`: Better Auth with the **magic-link** plugin, mapped onto our
  snake_case `users` table, year-long sessions (sign in once, then work offline).
- **Invite-only registration** — `src/invites.ts`: issue / redeem / bind, single-use, expiring.
- **Routes** — `src/app.ts` (below).

### The division of labour

Better Auth owns **authentication** — identity, sessions, magic-link tokens. Our own code owns
**authorization** (`users.role`) and the domain link (`users.local_id`); those are never declared
to Better Auth, and the session middleware reads the role straight from the `users` table. This is
the "buy authentication, build authorization" decision (`SHARED_RESEARCH.md` §4).

### How invite-only is enforced

Two independent locks:

1. `disableSignUp: true` — Better Auth will **never** create a user.
2. The only code path that creates one is `redeemInvite()`, which requires a valid, unexpired,
   unredeemed code and grants **the role carried by the invite** (never a role from the request).

So the flow is: maintainer issues a code → invitee redeems it (account created) → invitee signs in
by magic link. An uninvited email can request a link but no account will ever exist for it.

## Using it from the app (no curl needed)

**Home → Research community → “Account & invites”** is the whole UI:

- **Sign in** — email + password. No email transport needed.
- **Redeem an invite** — “I have an invite code”: enter your email, **choose a password**, paste
  the code. That creates your account, links this device's research to it, and signs you in.
  Every later sign-in is just email + password.
- **Issue invites** (maintainer only) — pick a role, get a code to share (30 days, single use).
- **Link this device** — binds your `local_id` so work done before you had an account is
  attributed to you.
- **Connect an AI assistant** — mint a personal API token for the MCP (shown once, inside a
  ready-to-paste MCP config), see when each was last used, revoke any.
- **Sign out.**

Maintainers also get an **Admin** tab in the top bar (see "Administering it" below).

If the remote isn't running, the panel says so and your own research still works; reading the
Qur'an needs it, and a banner at the top of the app says why when it can't read (offline, sign in,
or which plan is needed).

### Sharing your work (Phase 4)

Home → *Open questions* → the **↑** button beside a question offers it to the community. It only
appears if you're signed in as a researcher or above; a reader (or anyone signed out) never sees
an action they can't use.

Only **additive** kinds can be submitted so far — notes, questions, evidence āyāt — because they
can't conflict with anyone else's work, so no review machinery is needed to accept them. Competing
claims (form indications, root verdicts) are refused until Phase 5.

What's sent is a **frozen snapshot**: editing the note afterwards doesn't change what you
submitted. Submissions are content-addressed, so sending the identical thing twice returns the
same submission rather than duplicating it. Items over 1 MB are rejected — split them.

The control has three states, remembered in `research.db` (`derived_submissions`) so they survive
a restart:

| | |
|---|---|
| **↑** | never shared — send it |
| **Shared** | shared, unchanged since |
| **Update** | edited since you shared — re-sharing chains to the previous submission via `supersedes`, so a moderator sees a replacement rather than two unrelated items |

### Why passwords, not magic links

Magic link is still configured and works, but it needs an email transport to be useful, and on
the **desktop** it's worse than that: a link opened from a mail client signs in the *system
browser*, not the app. Passwords avoid both problems — the app posts credentials and gets a
session cookie directly.

Registration stays invite-only through two locks: the public `POST /api/auth/sign-up/email` route
is closed (403), and the only caller of Better Auth's `signUpEmail` is `/invites/redeem`, which
requires a valid code and grants **the role carried by the invite**.

The desktop window loads `http://localhost:<port>` (not `127.0.0.1`) so it is *same-site* with
the remote on `localhost:8100` — otherwise the browser refuses to send the `SameSite=Lax` session
cookie and the app can never appear signed in.

**Forgotten passwords** reset by email. In the app, Account → *Email me a reset link* calls
`POST /api/auth/request-password-reset`; the email (`src/mailer.ts`, SMTP) carries a one-time link
valid for an hour, which lands on this server's own **`/reset-password`** page (`src/reset-page.ts`;
no referrer, no external assets, the token removed from the address bar). Setting the new password
signs out every other device. The answer is the same whether or not the address has an account.
With `EMAIL_TRANSPORT=console` the email is printed to the server log instead, and a maintainer can
still run `set-password` (it hashes with Better Auth's own hasher and upserts the `account` row).

**Across sites.** Deployed, the server is on its own https:// domain while the app runs on the
reader's `localhost` — different sites — so over HTTPS the session cookie is issued
`SameSite=None; Secure` (`crossSiteCookies`, `src/config.ts`), or the browser wouldn't send it.

## Routes

| Route | Who |
|---|---|
| `/api/auth/*` | Better Auth (magic-link sign-in, session) |
| `GET /health` | public |
| `GET /signed-in` | public — the magic-link landing page |
| `POST /invites` | maintainer |
| `POST /invites/redeem` | public — the code *is* the credential |
| `GET /me` | any signed-in user (id, role, plan, bound localId) |
| `POST /me/local-id` | any signed-in user (bind this device) |
| `POST /me/name` | any signed-in user (display name) |
| `GET /me/tokens` · `POST /me/tokens` | any signed-in user — list / mint personal API tokens (below) |
| `DELETE /me/tokens/:id` | any signed-in user — revoke one of your own |
| `POST /plan` | maintainer — grant/revoke a plan tier by email (the manual stand-in for billing) |
| `GET /plan-tiers` | public — the plan ladder (name, rank, label) |
| `PUT /plan-tiers/:name` · `DELETE /plan-tiers/:name` | maintainer — edit the ladder |
| `GET /resource-access` | public — every resource rule `{kind, key, minPlan}` |
| `PUT /resource-access/:kind/:key` | maintainer — `{minPlan: "<tier>" \| "free" \| null}` |
| `DELETE /resource-access/:kind/:key` | maintainer — drop a per-item rule |
| `GET /admin/users` | maintainer — every user with role and plan |
| `PUT /admin/users/:id/role` | maintainer — `{role}`; won't demote the last maintainer |
| `PUT /admin/users/:id/plan` | maintainer — `{plan, expiresInDays?}` |
| `GET /admin/resources` | maintainer — every translation and lexicon with its rule, unfiltered |
| `GET\|POST /corpus/*` | resource `corpus` — the whole Qur'an corpus from Postgres (below) |
| `GET /community/readings` · `POST /divergences` · `GET /claims` · `GET /pull` | reader+ and resource `community` |
| `POST /submissions` · `POST /claims` | the **publish** role (researcher by default) — `{…, audience: {minRole, minPlan}}` |
| `GET /submissions` | any account — your outbox |
| `GET /submissions/:id` | its author, or staff |
| `POST /claims/:id/versions/:v/review` · `…/establish` | moderator · maintainer — `{…, audience}` confirms or changes who may see it |
| `GET\|PUT\|DELETE /research/*` | any account — **your own research** (same paths and JSON as the local `/api/v1/research`) |
| `GET /research/export` · `POST /research/import` | any account — download a research.db · merge one in (session only) |
| `GET /roles` · `PUT\|DELETE /roles/:name` | public · maintainer — the role ladder |
| `GET /feature-access` · `PUT /feature-access/:feature` | public · maintainer — publishing's minimum role |

**Signing in.** The app uses the Better Auth session cookie. A headless client — the MCP — uses a
**personal API token** instead: `Authorization: Bearer mqrg_…`. Tokens are made in the app (Account →
*Connect an AI assistant*), shown once, stored only as a SHA-256 hash, and revocable; a token acts
exactly as its user, roles and plan included (`src/api-tokens.ts`, `src/session.ts`).

## Access: features are role-based, resources are plan-based

Two independent axes, one question each:

- **Features** — what you may **do** — are gated by **role** (`requireRole` / `requireFeature`,
  `src/roles.ts`, `src/role-ladder.ts`): keeping research needs any account; publishing needs the role
  the maintainer chose (researcher by default); review `moderator`; establishing, inviting and
  administering `maintainer`. Below it: 401 (signed out) or 403 (role too low).
- **Resources** — what you may **read** — are gated by **plan** (`requireResource`,
  `src/resource-access.ts`). Below it: 401 if a sign-in is needed, **402** `{detail, resource, plan}`
  if a higher plan is.

### The role ladder

Roles are a person's **standing**, and the ladder is **data** (`role_levels`):
`reader 0 · student 10 · researcher 20 · scholar 30 · moderator 80 · maintainer 100`. Three rungs are
**fixed** because the staff powers hang on them: reader (the bottom), moderator (review) and
maintainer (administer). Between reader and moderator a maintainer adds, renames, re-ranks or removes
learner rungs (rank 1–79). A higher rank can do everything a lower one can. A principal carries its
role's rank (loaded at sign-in), so every guard is a comparison; an unknown role ranks below everyone.
Which role **publishing** needs is the maintainer's choice (`feature_access`, researcher by default).

### Audiences: who sees a published result

Every published result (a claim version, a submission) carries an **audience**: at least a role
**and** at least a plan (either may be empty), e.g. *scholars and above, on Pro*. The **author
proposes** it when publishing; the **reviewer confirms or changes** it when approving or establishing.
Every read of the community (claims, the group's reading, dissents, reading chips, ⚖ divergence and
its count, the pull) shows a viewer only what their role *and* plan reach. Authors always see their
own; moderators and maintainers see everything, since they review it. The community resource rule
(below) still applies to all of it.

### The plan ladder

The ladder is **data**, in `plan_tiers` — each tier a name, a **rank** and a label — so a
maintainer defines it at runtime, e.g. `free (0) < pro (100) < premium (200)`. A higher rank unlocks
everything a lower one does. `free` is always rank 0. Tier names are free-form, but a tier is only
ever *what's paid for*: standing (student, scholar) is a **role**, and the power to administer
is the `maintainer` **role**.

Every rule fails **closed**: an unknown tier never passes, and a **lapsed** plan (`plan_expires_at` in
the past) counts as `free`. A tier can't be removed while an account holds it or a resource needs it.

### The resources

`resource_access (kind, key, min_plan)`. `min_plan` is a tier, `free` (= any signed-in account), or
`NULL` (= public, no sign-in at all).

| kind | key | Guards | Below the tier |
|---|---|---|---|
| `corpus` | `*` | every `/corpus` route | 401 / 402 |
| `community` | `*` | community readings, claims, dissents, divergences, pull | 401 / 402 |
| `translation` | resource id | that translation in any result | **left out** — the request still succeeds |
| `lexicon` | source (`lanes_lexicon`, `lisan_ul_arab`, …) | that dictionary's entries on a root page | **left out** |

`corpus` and `community` default to `pro`. A translation or lexicon with no rule needs only what the
corpus needs. Rules are cached for 10 s per process: a change applies at once on the instance that made
it, and within 10 s on any other.

### Administering it

In the app: sign in as a maintainer and open the **Admin** tab — plan tiers, *who can read* (the corpus,
the community, each translation and dictionary), and people (each user's role and plan, with an optional
expiry). The same, scripted:

```bash
npm run access -w @alsiraat/remote -- show                         # the ladder + every rule
npm run access -w @alsiraat/remote -- tier scholar 200 "Scholar"   # add or change a tier
npm run access -w @alsiraat/remote -- tier-remove student          # remove an unused tier
npm run access -w @alsiraat/remote -- corpus public                # anyone may read the corpus
npm run access -w @alsiraat/remote -- corpus free                  # any signed-in account
npm run access -w @alsiraat/remote -- corpus scholar               # scholar or higher
npm run access -w @alsiraat/remote -- community pro                # the community's tier
npm run access -w @alsiraat/remote -- translation 131 scholar      # translation 131 needs scholar
npm run access -w @alsiraat/remote -- translation 131 none         # back to "same as the corpus"
npm run access -w @alsiraat/remote -- lexicon lanes_lexicon scholar  # Lane's lexicon needs scholar

npm run set-plan -w @alsiraat/remote -- me@example.org scholar     # grant, no expiry
npm run set-plan -w @alsiraat/remote -- me@example.org pro 30      # grant for 30 days
npm run set-plan -w @alsiraat/remote -- me@example.org free        # revoke
```

Billing isn't wired yet; the plan grant (Admin tab, `set-plan`, `POST /plan`) is the seam a payment
provider slots into. `GET /me` returns `plan`, `planLabel`, `planRank`, `planExpiresAt` and
`planActive` (= can read the community). Never infer "paid" from the tier name.

**Staff need a plan too.** A maintainer on `free` can administer everything but still gets 402 on a
`pro` resource — grant yourself a tier (or open the resource) if that's not what you want.

## Your research, in your account

Each account's research (cases and boards, notes and questions, indications and refinements, motifs,
comparisons, settings, and the outbox of what was published) lives in its **own Postgres schema**,
`research_<account id>`, created on first use (`src/research/schema.ts`). Its tables are derived from
the research.db DDL itself, so a file and a schema can't drift.

**Private by construction.** Every `/research` request runs in one transaction on one connection with
`SET LOCAL search_path` to the signed-in account's schema, taken only from the authenticated
principal, never from the request. The shared research code never names a schema, so it can only
ever see that person's tables. No route reads another person's research, for staff either.

**The same code as a file.** `ResearchStore` (`server/src/research.ts`) is async over a small driver
interface: SQLite for a research.db, Postgres here (`src/research/pg-research.ts`). The routes are the
local server's own (`server/src/routes/research.ts`). `remote/test/research-cloud.test.ts` runs 78
scripted research calls against both and requires identical answers.

**The AI boundary, on the server.** A request made with an API token (the MCP) may only propose:
records are tagged `ai` and are never primary; nothing is deleted or overwritten; on a case (even
yours) it may add its own items but never touch yours, the verdict, the status or established
meanings; it can't publish, accept its own proposals, or change settings
(`server/src/research-boundary.ts`).

**In and out.** `POST /research/import` merges a research.db into the account: it adds what isn't
there, never overwrites or deletes, is atomic, and accepts up to 100 MB; importing twice adds nothing.
The app offers it as *Bring it into my account* (reading the local server's research.db, which is left
untouched) and *Import a research.db…*. `GET /research/export` downloads a complete research.db.

## The corpus, served from the cloud

The whole Qur'an corpus is served from Postgres at **`/corpus`** — the same paths, query parameters
and JSON as the local API (`/corpus/verses/2:255?words=true` answers exactly like
`/api/v1/verses/2:255?words=true`): verses in every script, words, chapters, roots and forms, lexicons,
linkages, echoes, similar verses, spellings, wazn, and phrase / expression / free-text search.

It is **the same code** as the local server, not a port: every corpus service is written against one
`CorpusDb` interface (`server/src/corpus-db.ts`) with two drivers — SQLite locally, Postgres here
(`src/corpus/pg-corpus.ts`) — and `src/corpus/serve.ts` mounts the shared route builders with the plan
filters. The corpus indexes are built once at startup (`warmCorpus`). The app and the MCP read the
corpus from here; see CORPUS.md for how the copy is loaded and proven identical.

## Configuration

| Env | Default |
|---|---|
| `DATABASE_URL` | `postgres://postgres:researchgate@localhost:5432/researchgate` |
| `REMOTE_PORT` / `REMOTE_BASE_URL` | `8100` / `http://localhost:8100` |
| `AUTH_SECRET` | a dev placeholder — **set a real secret in any deployment** |
| `TRUSTED_ORIGINS` | `localhost` and `127.0.0.1` on 5174 (Vite), 8000 (built SPA) and 51789 (desktop) |
| `EMAIL_TRANSPORT` | `console` — emails (resets, magic links) are printed to the log; `smtp` sends them |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | — / `587` / `true` only for port 465 (STARTTLS otherwise) |
| `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | the SMTP login, and the From: line (`MQ Research Gate <no-reply@…>`) |
| `NODE_ENV` | `production` makes the server **refuse to start** on an unsafe environment — no or dev `AUTH_SECRET`, no `DATABASE_URL`, a non-https `REMOTE_BASE_URL`, SMTP chosen but unset |

**Deploying:** see [`DEPLOY.md`](DEPLOY.md) — one VPS with Docker (Postgres, this server, Caddy for
HTTPS), the corpus load, the first maintainer, backups.

## Running it

```bash
npm install                      # plain install; no flags needed

createdb researchgate            # or: psql -U postgres -c 'CREATE DATABASE researchgate'
npm run remote:migrate           # → applied: 0001_init.sql, 0002_auth.sql

# verify against YOUR server (the unit tests run on PGlite, not real Postgres):
npm run smoke -w @alsiraat/remote

# watch the claim spine work end to end — propose, review, establish, dissent.
# It creates temporary people (the majority rule needs several moderators) and cleans
# up after itself; --keep leaves the rows so you can inspect them.
npm run remote:demo

# the first maintainer can't be invited — create one out of band:
npm run bootstrap -w @alsiraat/remote -- you@example.org "Your Name"

# bootstrap creates the account with NO password, so give it one (also how a maintainer
# resets a forgotten password, since no reset email is configured):
npm run set-password -w @alsiraat/remote -- you@example.org "a good long password"

npm run remote:dev               # http://localhost:8100/health
```

Then, to exercise the flow end to end. Keep `remote:dev` running in one terminal (magic links
are printed there) and run these in another.

**Windows CMD** — one line each, double quotes, inner quotes escaped:

```cmd
:: 1. request a sign-in link; open the URL printed in the server terminal
curl -X POST localhost:8100/api/auth/sign-in/magic-link -H "content-type: application/json" -d "{\"email\":\"you@example.org\"}"

:: 2. confirm who you are (cookie jar from the browser, or -b/-c to persist one)
curl localhost:8100/me -b cookies.txt

:: 3. issue an invite (maintainer only)
curl -X POST localhost:8100/invites -b cookies.txt -H "content-type: application/json" -d "{\"role\":\"researcher\"}"

:: 4. the invitee redeems it — no auth needed, the code IS the credential
curl -X POST localhost:8100/invites/redeem -H "content-type: application/json" -d "{\"code\":\"<code>\",\"email\":\"them@example.org\"}"
```

**bash / PowerShell 7+**:

```bash
curl -X POST localhost:8100/api/auth/sign-in/magic-link \
  -H 'content-type: application/json' -d '{"email":"you@example.org"}'
curl localhost:8100/me -b cookies.txt
curl -X POST localhost:8100/invites -b cookies.txt \
  -H 'content-type: application/json' -d '{"role":"researcher"}'
curl -X POST localhost:8100/invites/redeem \
  -H 'content-type: application/json' \
  -d '{"code":"<code>","email":"them@example.org","localId":"<their local_id>"}'
```

Tests use **PGlite** (Postgres compiled to WASM, in-process) — no server needed:
`npm test -w @alsiraat/remote`.

### If `npm install` ever reports ERESOLVE about `@tanstack/react-start` / `vite`

`better-auth` declares `@tanstack/react-start` as an **optional** peer (a framework
integration we don't use), and that package declares a peer on `vite`. npm normally skips
optional peers entirely, so a clean install is fine. But if that package ever ends up
physically in `node_modules` — typically from an interrupted or `--no-save` install — npm must
then satisfy *its* peers, and the vite range collides with the app's pin.

The fix is to clear the stale tree, not to loosen peer checking:

```bash
rm -rf node_modules package-lock.json && npm install
```

Reach for `--legacy-peer-deps` only as a last resort: it disables peer checking for the whole
workspace, so a genuine mismatch elsewhere would pass silently.
