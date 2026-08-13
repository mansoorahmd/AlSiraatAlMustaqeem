# Remote research channel (`remote/`)

The optional, invite-only server where research is published, reviewed, and agreed
(`SHARED_RESEARCH.md`). It is a **separate service** from the local API — they share nothing
but the concept. Local study stays offline and account-free; only this remote needs an account.

Backed by **Postgres** (where a structured, multi-writer, transactional store earns its place —
`SHARED_RESEARCH.md` §3). The corpus is *not* here; corrections ship as signed patch files
(`CORPUS.md`).

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
- **Sign out.**

If the remote isn't running the panel says so and everything else keeps working — the remote is
optional by design.

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

**Password reset needs an email transport** (Better Auth's `sendResetPassword`), so for now a
forgotten password means a maintainer intervenes. Worth wiring up before the group grows.

## Routes

| Route | Who |
|---|---|
| `/api/auth/*` | Better Auth (magic-link sign-in, session) |
| `GET /health` | public |
| `GET /signed-in` | public — the magic-link landing page |
| `POST /invites` | maintainer |
| `POST /invites/redeem` | public — the code *is* the credential |
| `GET /me` | any signed-in user (id, role, bound localId) |
| `POST /me/local-id` | any signed-in user (bind this device) |

## Configuration

| Env | Default |
|---|---|
| `DATABASE_URL` | `postgres://postgres:researchgate@localhost:5432/researchgate` |
| `REMOTE_PORT` / `REMOTE_BASE_URL` | `8100` / `http://localhost:8100` |
| `AUTH_SECRET` | a dev placeholder — **set a real secret in any deployment** |
| `TRUSTED_ORIGINS` | `http://localhost:5173,http://localhost:8000` |
| `EMAIL_TRANSPORT` | `console` — magic links are printed to the server log (no SMTP in dev) |

## Running it

```bash
npm install                      # plain install; no flags needed

createdb researchgate            # or: psql -U postgres -c 'CREATE DATABASE researchgate'
npm run remote:migrate           # → applied: 0001_init.sql, 0002_auth.sql

# verify against YOUR server (the unit tests run on PGlite, not real Postgres):
npm run smoke -w @alsiraat/remote

# the first maintainer can't be invited — create one out of band:
npm run bootstrap -w @alsiraat/remote -- you@example.org "Your Name"

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
