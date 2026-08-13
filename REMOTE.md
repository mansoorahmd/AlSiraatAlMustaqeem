# Remote research channel (`remote/`)

The optional, invite-only server where research is published, reviewed, and agreed
(`SHARED_RESEARCH.md`). It is a **separate service** from the local API — they share nothing
but the concept. Local study stays offline and account-free; only this remote needs an account.

Backed by **Postgres** (where a structured, multi-writer, transactional store earns its place —
`SHARED_RESEARCH.md` §3). The corpus is *not* here; corrections ship as signed patch files
(`CORPUS.md`).

## Status — foundation (Phase 3, in progress)

Built and tested:

- **Schema** — `migrations/0001_init.sql`: the full research-channel schema from
  `SHARED_RESEARCH_SCHEMA.md` §3 (users, invites, claims, claim_versions, global_forms, dissents,
  submissions, submission_items, reviews, redactions, sync_cursors), with role/kind CHECKs, `seq`
  cursors, and referential integrity. Validated against real Postgres via PGlite.
- **Migration runner** — `src/migrate.ts` (forward-only, tracked in `_migrations`, idempotent),
  CLI `src/migrate-cli.ts`.
- **Role ladder + guard** — `src/roles.ts`: `reader < researcher < moderator < maintainer`,
  `requireRole(min)` Hono middleware (401 unauthenticated, 403 below the rung). Hand-rolled, not a
  permissions library. Tested in `test/role-boundary.test.ts`.
- **Service skeleton** — `src/app.ts` / `src/server.ts` (health for now).

Next (same phase): **Better Auth** — magic-link sign-in, the invite gate, and binding an account
to the local `local_id` (so pre-account work stays attributed). See `SHARED_RESEARCH.md` §4 (Auth
stack) and §11.

## Configuration

`DATABASE_URL` (default `postgres://postgres:researchgate@localhost:5432/researchgate`),
`REMOTE_PORT` (default 8100).

## Running it

```bash
# one-time: create the database (matches the default DATABASE_URL)
createdb researchgate            # or: psql -U postgres -c 'CREATE DATABASE researchgate'

# apply migrations
npm run remote:migrate           # → applied: 0001_init.sql

# start the service
npm run remote:dev               # http://localhost:8100/health
```

Tests use **PGlite** (Postgres compiled to WASM, in-process) — no server needed:
`npm test -w @alsiraat/remote`.
