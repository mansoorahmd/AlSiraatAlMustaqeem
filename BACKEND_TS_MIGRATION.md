# Backend migration: Python → TypeScript (single deployable app)

**Goal:** fold the FastAPI backend into the TypeScript codebase so the whole
project builds and deploys as **one Node process** — no separate Python
runtime, one repo, shared types between client and server — **and** expose a
clean, standalone API a future **mobile app** can consume from any origin.

**Status:** ✅ **DONE & LIVE.** All endpoints ported to `/server` (Hono +
node:sqlite), verified against Python by 28 golden-parity tests, and confirmed
working in the running app. The web client is on `/api/v1`. The project is now
an **npm workspace** with a single `npm run dev`. The old Python API is
**archived** in `legacy_python/` (nothing runs it; delete when you're ready).
See §9 to run it.

**Locked choices:** Hono + **node:sqlite** (built-in, no native build), plain
**npm**, versioned **`/api/v1`** API with CORS, **big-bang** cutover.

---

## 1. Recommended architecture

Serve the **existing Vite React SPA** and the **API** from a single
[Hono](https://hono.dev) server on Node. This achieves the "single deployable
app" goal *without rewriting the frontend*.

```
one Node process
├── Hono app
│   ├── /api/v1/*       → ported route handlers (was FastAPI)  ← the contract
│   │                     CORS-enabled, versioned, framework-agnostic
│   └── /*              → static: serves app/dist (the built SPA)
│                         (toggleable — can run API-only for mobile)
└── node:sqlite (built-in, via a small Db adapter)
    ├── quran.db        (read-only content)
    └── research.db     (read-write user research)
```

**Why Hono over Next.js / SvelteKit / Remix:** those are the usual "fullstack
framework" answers, but they'd force migrating the SPA into their router and
SSR model — a large, risky change to working UI for no benefit (this app needs
no SSR/SEO). Hono keeps the SPA exactly as-is and, crucially for the mobile
goal, leaves the API as a **plain HTTP service** rather than something welded to
a web framework. Hono runs unchanged on Node, Bun, Deno, and edge runtimes, so
hosting stays open.

### Built for a future mobile app
Because the web SPA and the API are only *co-located*, not *coupled*, the same
server serves a mobile client with no rework:

- **Versioned API** — everything lives under **`/api/v1`** so a shipped mobile
  app can pin a stable contract while the web keeps moving. New shapes go to
  `/api/v2`.
- **CORS** — Hono's `cors()` middleware is on from day one. (Native apps don't
  enforce CORS, but a PWA / Capacitor webview / separate web origin does, and
  it costs nothing now.)
- **Separable static** — serving `app/dist` is behind a `SERVE_STATIC` flag, so
  the exact same binary can run **API-only** (mobile + a CDN-hosted web build)
  or **all-in-one** (today's single deploy) without code changes.
- **Shared contract** — request/response types live in `/shared` and become the
  single source of truth for the web client *and* a future TS mobile client
  (React Native / Expo can import them directly).
- **Auth-ready seam** — a no-op auth middleware slot is left in the chain; when
  accounts arrive, per-user research (bearer token) drops in without reshaping
  routes.

**Why `node:sqlite`:** Node's built-in SQLite needs **zero native build**
(no node-gyp — which failed in CI and is a common Windows headache), works out
of the box on Node 22, and has a synchronous, near-identical API to
better-sqlite3. It's loaded via `createRequire` and hidden behind a one-file
`Db` adapter, so swapping drivers later is trivial.

### Proposed layout (monorepo, no new tooling)
```
/app          existing Vite React SPA (unchanged except api base)
/server       NEW — the TS backend
  /db         connection + query helpers (was db.py)
  /content    chapters/verses/words        (was content.py)
  /roots      roots/forms/occurrences      (was roots.py)
  /linkages   root linkage graph           (was linkages.py)
  /similarity lexical / morphology / compose
  /text       normalize + constants        (was normalize.py + constants.py)
  /research   research store + migrations  (was research.py)
  /freetext   free-text resolver           (was freetext.py)
  routes.ts   Hono routes                  (was api.py)
  server.ts   entry: static + /api, listen
  /test       Vitest suites + golden fixtures
/shared       types shared by client & server (CompositeMatch, NoteRecord, …)
```

---

## 2. File-by-file mapping

| Python | LOC | TypeScript | Notes / risk |
|---|---|---|---|
| `db.py` | 101 | `server/db/index.ts` | `better-sqlite3`; WAL + `PRAGMA foreign_keys`. Row objects are plain — drop `row_factory`. Trivial. |
| `content.py` | 288 | `server/content/*.ts` | Pure SQL. Mechanical. |
| `roots.py` | 237 | `server/roots/*.ts` | Pure SQL. Mechanical. |
| `linkages.py` | 212 | `server/linkages/*.ts` | SQL + in-memory graph. Mechanical. |
| `similarity/lexical.py` | 258 | `server/similarity/lexical.ts` | **Parity-critical.** TF-IDF, cosine, `longest_common_run(_slice)`. Port carefully; cover with golden tests. |
| `similarity/morphology.py` | 194 | `server/similarity/morphology.ts` | **Parity-critical.** n-gram IDF, POS cosine. |
| `similarity/compose.py` | 177 | `server/similarity/compose.ts` | Blends signals; already mirrored by the `CompositeMatch` TS type. |
| `normalize.py` | 123 | `server/text/normalize.ts` | **Highest risk.** Diacritics regex, Buckwalter↔Arabic, `fold_arabic`, `affix_trials`, `tokenize_arabic`. Must match byte-for-byte or search/resolve drift. |
| `constants.py` | 304 | `server/text/constants.ts` | The Buckwalter⇄Unicode map + letter classes. Port as a data module; verify with a round-trip test. |
| `freetext.py` | 167 | `server/freetext/index.ts` | Depends on `normalize` + similarity; port after both. |
| `research.py` | 368 | `server/research/store.ts` | Read-write. Port the schema, the **self-migrating connect logic** (notes `answer/lemma/root`), and idempotent IndexedDB→DB migration endpoints. |
| `api.py` | 392 | `server/routes.ts` + `server.ts` | FastAPI → Hono. Query/path params, `HTTPException` → `c.json(..., status)`. Mechanical once helpers exist. |
| `tests/test_m0…m6` | ~600 | `server/test/*.test.ts` (Vitest) | Re-express. This is where correctness is actually locked — budget accordingly. |

No custom SQLite functions or collations exist, and the API does **not** use
the FTS5 tables (search runs in the similarity engine), so nothing exotic
needs reimplementing.

---

## 3. Migration order (bottom-up, each phase independently verifiable)

1. **Scaffold** `/server` (Hono + better-sqlite3 + Vitest + tsx), open both
   DBs, `GET /api/health`. Wire Hono static to `app/dist`. One `pnpm dev`
   runs Vite and the server.
2. **`text/` (normalize + constants)** first — everything downstream depends on
   it. Land its round-trip + folding tests before anything else.
3. **`db` + `content` + `roots` + `linkages`** — the pure-SQL layer. Port the
   read routes (`/chapters`, `/verses`, `/roots`, …) and diff against Python.
4. **Similarity engine** (`lexical` → `morphology` → `compose`) with golden
   fixtures; then `/verses/{key}/similar`.
5. **`freetext`** + `/phrase-search`, `/search`.
6. **`research` store** + all `/research/*` routes (cases, form-status, trails,
   notes).
7. **Flip the client**: change `BASE` in `app/src/api/client.ts` from `/api`
   to `/api/v1`, and repoint the Vite dev proxy at the Node server. Full
   end-to-end pass.
8. **Delete Python** once parity tests are green.

**Cutover: big-bang.** All routes move at once; the Python server is retired
in step 8. The golden fixtures (captured from Python *before* deletion) are the
safety net — parity is proven in CI, not by running both servers in parallel.
Capture the fixtures as the very first task, while FastAPI is still running.

---

## 4. Test strategy — parity by golden fixtures

The safest guarantee that the TS engine behaves identically is to **capture the
current Python API's output as fixtures** and assert the TS port reproduces
them:

- A small script hits the running FastAPI for a representative set
  (`/verses/2:143/similar`, `/search?...`, `/roots/{root}`, a few free-text
  queries) and writes JSON fixtures.
- Vitest loads each fixture and asserts the TS handler matches — scores within
  a tight tolerance (e.g. 1e-6) and **identical ordering** (watch tie-breaks in
  `sort`, which differ between Python's stable sort and JS; make comparators
  total by adding `verse_key` as a final key).
- Port the existing `test_m*` assertions on top for unit-level coverage.

---

## 5. Risks & mitigations

1. **Arabic normalization drift** (highest). `fold_arabic`/`affix_trials`/
   diacritics regex must match exactly. *Mitigation:* port `constants.ts`
   verbatim, add a round-trip test (`arabic → buck → arabic`) over every root
   in the DB, and a folding fixture from Python output.
2. **Float + sort parity** in similarity. *Mitigation:* tolerance-based
   assertions + total-order comparators (append `verse_key` tiebreaker on both
   sides so ordering is deterministic and matchable).
3. **Unicode regex classes.** Python's `re` and JS `RegExp` treat Arabic ranges
   the same with explicit code points; use the same `؀`-style ranges (add
   the `u` flag) rather than named classes.
4. **SQLite concurrency.** `better-sqlite3` is synchronous — fine for this
   workload, but keep the write path (research.db) on WAL and short
   transactions (already the case).
5. **Arabic in URLs.** Root routes use `encodeURIComponent` on Arabic — verify
   Hono decodes path params identically (it does; test one root route).
6. **Research migration idempotency.** Preserve the `migrated_to_research_db`
   guard and the additive notes-column migration on connect.
7. **Static routing.** SPA deep links must fall back to `index.html`; add a
   catch-all after `/api/*` in Hono.

---

## 6. Deployment (the payoff)

```
npm run build -w app                    # Vite → app/dist
SERVE_STATIC=1 node server/server.ts    # serves dist + /api/v1 on one port
```
One process, one port, one Dockerfile (`node:22-slim` + the two `.db` files).
No Python, no uvicorn, no proxy. Same artifact runs locally and in prod.

**When mobile ships:** run the identical image with `SERVE_STATIC=0` as an
API-only service (host the web build on a CDN), or keep all-in-one and let the
mobile app hit `/api/v1` directly — no rebuild either way.

---

## 7. Effort estimate

Roughly **3–5 focused days**: ~1 day scaffold + `text/` + SQL layer, ~1–1.5
days similarity + freetext with golden tests, ~0.5 day research routes, ~1 day
parity hardening and client cutover. The routes are quick; the time is in
normalization + similarity **parity tests**, which are what make the cutover
safe.

---

## 8. Decisions (locked)

- **Server:** Hono on Node — API stays a standalone HTTP service so a mobile
  app can consume it; web SPA is co-located, not coupled.
- **API surface:** versioned **`/api/v1`**, CORS on, static serving behind a
  `SERVE_STATIC` flag (all-in-one today, API-only when mobile ships).
- **SQLite driver:** **`node:sqlite`** (Node's built-in) — *revised from
  better-sqlite3*. better-sqlite3 needs native compilation (node-gyp), which
  failed in CI and is a known pain on Windows; `node:sqlite` needs **zero
  native build**, works out of the box on Node 22, and has a near-identical
  API. It's loaded via `createRequire` (so bundlers/test runners that don't yet
  know the builtin don't choke) and isolated behind a `Db` adapter, so swapping
  drivers later is a one-file change. Trade-off: it's flagged experimental
  (a harmless startup warning, silenced via `NODE_NO_WARNINGS`).
- **Monorepo / package manager:** **npm workspaces** (matches `app/`'s
  `package-lock.json`); `/shared` holds the client↔server type contract.
- **Cutover:** **big-bang** — capture golden fixtures from Python first, port
  everything, prove parity in CI, then delete Python.

### First action when coding starts
Capture golden fixtures from the **currently running** FastAPI (similar,
search, roots, free-text, a research round-trip). This must happen before any
Python is removed, since those fixtures are the parity oracle for the whole
port.

---

## 9. How to run (npm workspace)

**One-time, from the project root:**
```
npm install        # installs app + server (workspaces) + concurrently
```

**Everything, one command** (or just run `run-dev.bat` / `run-dev.sh`):
```
npm run dev        # API on :8000 + web app on :5174 together
```

**Other root commands:**
```
npm test           # 28 parity tests (runs the server suite)
npm run build      # build the web SPA → app/dist
npm start          # build + serve SPA and API together on one port (all-in-one)
```

**When mobile ships:** run the server with `SERVE_STATIC=0` as an API-only
service; the mobile app talks to `/api/v1` directly.

**Retired Python:** the original FastAPI backend and the Python DB-build
scripts have been **removed** from this workspace (backed up separately). The
TypeScript server in `/server` is now the sole backend. The parity fixtures in
`server/test/fixtures/` are frozen snapshots the tests still run against;
regenerating them would require the Python again (kept in your backup).
