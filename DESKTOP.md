# MQ Research Gate — desktop (Electron)

The desktop app is a thin native shell around the **same** web app. There is no back end in it:
everything the app reads and writes — the corpus, your research, the community — is on the research
server, exactly as in the browser.

## How it fits together

```
Electron main (electron/main.mjs)
  ├─ picks a stable local port (51789, or the next free one)
  ├─ serves the built app (app/dist) from a tiny built-in file server on 127.0.0.1
  └─ opens a BrowserWindow at http://localhost:<port>/
```

- **Why a local port at all.** The window needs an `http://localhost` origin: the research server
  trusts `http://localhost:51789` by default (`remote/src/config.ts` `trustedOrigins`), and the sign-in
  cookie must be same-site with it in development. The port is stable so the origin stays trusted.
- **The file server** is ~20 lines in `main.mjs`: files from `app/dist`, `index.html` for anything
  else, and nothing outside `app/dist` (a path that escapes it gets 403).
- **Sign-in** opens in an in-app window (`auth:open-sign-in`), so the session cookie lands in the
  app's own session, not the system browser's. That's the only thing the preload exposes.
- **The research server's address** is baked into the web build: `VITE_REMOTE_URL=https://… npm run
  desktop:dist` (default `http://localhost:8100`).
- **The MCP server is unrelated** — it's a separate stdio process Claude Desktop launches.

## Develop

```bash
npm install                 # electron, electron-builder — no native builds
npm run electron:dev        # builds the app, launches Electron
```

The research server must be running (`npm run dev`, or just `npm run remote:dev`).

## Package installers

```bash
npm run desktop:dist        # → dist-desktop/  (nsis on Windows, dmg on macOS, AppImage on Linux)
```

Config is `electron-builder.yml`: it packs `electron/main.mjs` and `electron/preload.cjs`, and copies
`app/dist` into `resources/`. No native modules, no data files.

## Notes

- No app icon or code-signing yet (unsigned builds warn on first launch) — add an
  `electron/resources/` icon set and signing config to `electron-builder.yml` before a
  public release.
- Auto-update (electron-updater) is not wired up.
