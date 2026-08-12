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
npm install                 # pulls electron, electron-builder, esbuild;
                            # better-sqlite3 is an optionalDependency (see note)
npm run electron:dev        # builds the SPA, bundles the server, launches Electron
```

`electron:dev` = `npm run build -w app` + `node electron/bundle-server.mjs` + `electron .`.

> **better-sqlite3 is a native module.** `npm install` builds it against your local Node;
> `electron-builder` rebuilds it against Electron's ABI when packaging. Because it's an
> **optionalDependency**, a web-only contributor who lacks build tools can still
> `npm install` — it just won't be present, and the web app (which uses `node:sqlite`)
> doesn't need it. For `npm run electron:dev` you do need it to build successfully.

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
