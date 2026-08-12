# MQ Research Gate — desktop (Electron)

The desktop app is a thin native shell around the **same** web app. It boots the
project's own Hono server on a private local port and opens a window at it — no code is
duplicated, and the web workflow (`npm run dev`, the tests) is untouched.

## How it fits together

```
Electron main (electron/main.mjs)
  ├─ picks a free port
  ├─ spawns the bundled server (electron/build/server.cjs) as a Node utilityProcess
  │     env: SERVE_STATIC=1, QF_SQLITE_DRIVER=better-sqlite3,
  │          QF_QURAN_DB, QF_RESEARCH_DB, QF_STATIC_ROOT, PORT
  ├─ waits for /api/v1/health
  └─ opens a BrowserWindow at http://127.0.0.1:<port>/
```

- **The server is bundled**, not shipped as source: `electron/bundle-server.mjs` runs
  esbuild over `server/src/server.ts` → `electron/build/server.cjs`, bundling everything
  except the native SQLite driver.
- **SQLite driver.** The web build uses Node's built-in `node:sqlite`. Electron ships its
  own Node, which may predate it, so the desktop build sets `QF_SQLITE_DRIVER=better-sqlite3`
  and `server/src/db.ts` opens the native driver instead. Same `Db` API; one file decides.
- **Data.** `quran.db` ships read-only in the app's `resources/`. `research.db` lives in
  the OS user-data dir (`app.getPath('userData')`) so the reader's work survives updates and
  isn't tied to a source checkout — seeded from a bundled copy on first run if one is shipped,
  else created by the server on first write.
- **The MCP server is unrelated** — it's a separate stdio process Claude Desktop launches.
  The desktop app is just the reader/investigation UI.

## Develop

```bash
npm install                 # pulls electron, electron-builder, esbuild, @electron/rebuild;
                            # better-sqlite3 is an optionalDependency (see note)
npm run electron:dev        # builds the SPA, bundles + rebuilds native, launches Electron
```

`electron:dev` = build SPA + bundle server + **rebuild native for Electron** + `electron .`.

### The native-driver ABI (important)

`better-sqlite3` is a compiled `.node` binary. `npm install` builds it for your *system*
Node (e.g. Node 22), but **Electron ships its own Node** (Electron 33 → Node 20), a
different ABI. Loading the system build inside Electron fails with:

```
NODE_MODULE_VERSION 127 … requires NODE_MODULE_VERSION 130 … ERR_DLOPEN_FAILED
```

So the module must match Electron's ABI. `npm run electron:rebuild` fetches a **prebuilt**
`better-sqlite3` binary for the installed Electron version (`electron/rebuild-native.mjs`,
via `prebuild-install`) — no compiler, and no scan of the workspace `node_modules`.
`electron:dev` runs it for you.

> Why not `electron-rebuild`? It walks the whole `node_modules` tree to find native
> modules, which (a) needs C++ build tools to compile and (b) trips over stale npm temp
> dirs in a workspace repo (`EACCES: … lstat 'node_modules\.<name>-xxxx'`). The prebuild
> download sidesteps both. If a prebuild isn't available for your Electron version, the
> script tells you to install build tools and run `npm run electron:rebuild:compile`
> (the `electron-rebuild` fallback) — and to delete that stale `.<name>-xxxx` temp folder
> first if you see the EACCES.

- Rebuilding for Electron takes ~30–60s. Once done, `npm run electron:run` launches
  without rebuilding — use it while iterating.
- Any fresh `npm install` recompiles `better-sqlite3` for system Node again, so re-run
  `npm run electron:rebuild` (or just `electron:dev`) afterwards.
- **Packaging handles this itself** — `electron-builder` rebuilds native deps for the
  target Electron during `desktop:dist`, so installers are correct without extra steps.

> **Web-only contributors:** `better-sqlite3` is an **optionalDependency**, so `npm
> install` still succeeds without build tools — it just won't be present, and the web app
> (which uses `node:sqlite`) doesn't need it. You only need it for the desktop build.

## Package installers

```bash
npm run desktop:dist        # → dist-desktop/  (nsis on Windows, dmg on macOS, AppImage on Linux)
```

Config is `electron-builder.yml`. It packs `electron/main.mjs`, `electron/preload.mjs` and
the bundled `electron/build/**`, unpacks the native driver and the server bundle from the
asar, and copies `app/dist` and `quran.db` into `resources/`.

Icons and code-signing are not set up yet — add an `electron/resources/` icon set and the
platform signing config to `electron-builder.yml` before a public release.

## Not done / notes

- No app icon or signing yet (unsigned builds warn on first launch).
- To ship a starter `research.db`, uncomment its `extraResources` entry in
  `electron-builder.yml`.
- Auto-update (electron-updater) is not wired up.
