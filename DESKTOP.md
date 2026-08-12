# MQ Research Gate — desktop (Electron)

The desktop app is a thin native shell around the **same** web app. It boots the
project's own Hono server on a private local port and opens a window at it — no code is
duplicated, and the web workflow (`npm run dev`, the tests) is untouched.

## How it fits together

```
Electron main (electron/main.mjs)
  ├─ picks a free port
  ├─ spawns the bundled server (electron/build/server.cjs) as a Node utilityProcess
  │     env: SERVE_STATIC=1, NODE_OPTIONS=--experimental-sqlite,
  │          QF_QURAN_DB, QF_RESEARCH_DB, QF_STATIC_ROOT, PORT
  ├─ waits for /api/v1/health
  └─ opens a BrowserWindow at http://127.0.0.1:<port>/
```

- **The server is bundled**, not shipped as source: `electron/bundle-server.mjs` runs
  esbuild over `server/src/server.ts` → `electron/build/server.cjs`.
- **SQLite: the same driver as the web app — no native module.** Electron 36 bundles
  Node 22, which has the built-in `node:sqlite`. So the desktop build uses the exact same
  `db.ts` path as web/CI. On Node 22 that module is behind a flag, so the server process
  is launched with `NODE_OPTIONS=--experimental-sqlite`. This means **no native
  dependency, no rebuild step, no C++ build tools** — packaging is trivial and works on
  any machine.
- **Data.** `quran.db` ships read-only in the app's `resources/`. `research.db` lives in
  the OS user-data dir (`app.getPath('userData')`) so the reader's work survives updates
  and isn't tied to a source checkout — seeded from a bundled copy on first run if one is
  shipped, else created by the server on first write.
- **The MCP server is unrelated** — it's a separate stdio process Claude Desktop launches.

## Develop

```bash
npm install                 # electron, electron-builder, esbuild — no native builds
npm run electron:dev        # builds the SPA, bundles the server, launches Electron
```

`electron:dev` = `npm run build -w app` + `node electron/bundle-server.mjs` + `electron .`.

## Package installers

```bash
npm run desktop:dist        # → dist-desktop/  (nsis on Windows, dmg on macOS, AppImage on Linux)
```

Config is `electron-builder.yml`. It packs `electron/main.mjs`, `electron/preload.mjs`
and the bundled `electron/build/**` (unpacked from the asar so the utility process can
fork it), and copies `app/dist` and `quran.db` into `resources/`. No native modules to
rebuild, so no extra packaging steps.

## Notes

- **Older Electron / native fallback.** `db.ts` still supports `better-sqlite3` when
  `QF_SQLITE_DRIVER=better-sqlite3` is set. Only needed if you must run on an Electron
  whose Node predates `node:sqlite` (< Electron 35). Then you'd add `better-sqlite3` as a
  dep, set that env var in `electron/main.mjs` (instead of the `--experimental-sqlite`
  flag), and let `electron-builder` rebuild it during `desktop:dist`. The default path
  above avoids all of this.
- No app icon or code-signing yet (unsigned builds warn on first launch) — add an
  `electron/resources/` icon set and signing config to `electron-builder.yml` before a
  public release.
- To ship a starter `research.db`, uncomment its `extraResources` entry in
  `electron-builder.yml`.
- Auto-update (electron-updater) is not wired up.
