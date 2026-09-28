// Electron main process for MQ Research Gate desktop.
//
// It boots the app's own Hono server (bundled to build/server.cjs) as a Node
// utility process, then opens a window pointed at it. Nothing about the web app
// changes — this is just a native shell around the same server + SPA.
//
// Data: quran.db ships read-only inside the app bundle (resources), copied nowhere. The
// reader's research is in their account on the research server — nothing of it is on disk.

import { app, BrowserWindow, Menu, ipcMain, shell, utilityProcess } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
// packaged: resources/ holds the read-only assets; dev: repo root two levels up
const RES = process.resourcesPath ?? join(here, "..");
const isDev = !app.isPackaged;

// A STABLE port, so the window's origin (localhost:PORT) — and therefore the
// per-origin IndexedDB where reading prefs (gloss, font, script) live — is the same on
// every launch. A random port would give a new origin each run and silently reset all
// settings. Try a fixed preferred port; only if it's taken do we step to the next one.
const PREFERRED_PORT = 51789;

function isFree(port) {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once("error", () => res(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => res(true)));
  });
}

async function stablePort() {
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + 20; p++) {
    if (await isFree(p)) return p;
  }
  return PREFERRED_PORT; // give up gracefully; the server will report if truly blocked
}

async function waitForHealth(port, tries = 100) {
  const url = `http://127.0.0.1:${port}/api/v1/health`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy in time");
}

let child = null;

async function startServer() {
  const port = await stablePort();

  // read-only corpus from the bundle
  const quranDb = isDev ? join(here, "..", "quran.db") : join(RES, "quran.db");

  const staticRoot = isDev ? join(here, "..", "app", "dist") : join(RES, "app", "dist");
  // the bundle is asarUnpack'd, so run it from the unpacked path, not inside the asar
  let serverEntry = join(here, "build", "server.cjs");
  if (serverEntry.includes("app.asar")) serverEntry = serverEntry.replace("app.asar", "app.asar.unpacked");

  child = utilityProcess.fork(serverEntry, [], {
    env: {
      ...process.env,
      PORT: String(port),
      SERVE_STATIC: "1",
      // use Node's built-in node:sqlite (Electron 36 bundles Node 22). It's behind a
      // flag on Node 22, hence --experimental-sqlite. No native module, no rebuild.
      // (To fall back to the native driver on older Electron: set QF_SQLITE_DRIVER
      //  to "better-sqlite3" here and drop the NODE_OPTIONS flag.)
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --experimental-sqlite`.trim(),
      QF_QURAN_DB: quranDb,
      QF_STATIC_ROOT: staticRoot,
      NODE_NO_WARNINGS: "1",
    },
    stdio: "inherit",
  });

  await waitForHealth(port);
  return port;
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#f4f1ea",
    title: "MQ Research Gate",
    autoHideMenuBar: true, // no File/Edit/View/Window/Help bar
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(here, "preload.cjs"), // exposes window.desktop (sign-in window)
    },
  });
  win.setMenuBarVisibility(false);
  // open external links in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  // Use `localhost`, NOT 127.0.0.1. The remote research service is on localhost:<port>, and a
  // browser treats localhost and 127.0.0.1 as different hosts — i.e. cross-site — so the
  // SameSite=Lax session cookie would never be sent back and the app could never appear signed
  // in. Same host (different port) is same-site, so the cookie flows. (Safe to change: reading
  // prefs live in the account now, not in per-origin browser storage.)
  win.loadURL(`http://localhost:${port}/`);
}

// Sign-in must happen INSIDE the app, or the session cookie lands in the system browser and the
// app stays signed out. The renderer passes the magic-link URL the reader received (the token
// comes by email, so the app can't construct it); we load it in a child window that shares this
// app's session, so verifying there gives US the cookie.
//
// Resolves { ok: true } only if the remote actually redirected to /signed-in — a window the user
// simply closes, or a rejected/expired token, resolves { ok: false } so the UI can say so.
ipcMain.handle("auth:open-sign-in", async (_e, url) => {
  let target;
  try { target = new URL(url); } catch { throw new Error("not a valid URL"); }
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("unsupported URL scheme");
  // only ever load a verify link, never an arbitrary page handed to us
  if (!target.pathname.startsWith("/api/auth/")) throw new Error("that is not a sign-in link");

  const win = new BrowserWindow({
    width: 520, height: 640,
    title: "Sign in — MQ Research Gate",
    autoHideMenuBar: true,
    parent: BrowserWindow.getFocusedWindow() ?? undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  // keep it on the remote's origin; anything else opens in the real browser
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (new URL(u).origin === target.origin) return { action: "allow" };
    shell.openExternal(u);
    return { action: "deny" };
  });

  return new Promise((resolve) => {
    let verified = false;
    const settle = () => { if (!win.isDestroyed()) win.close(); };
    // the callbackURL we requested is /signed-in; reaching it means the cookie is set
    win.webContents.on("did-navigate", (_ev, to) => {
      if (to.startsWith(`${target.origin}/signed-in`)) { verified = true; setTimeout(settle, 600); }
    });
    win.on("closed", () => resolve({ ok: verified }));
    win.loadURL(url).catch(() => settle());
  });
});

app.whenReady().then(async () => {
  // no native menu bar (File / Edit / View / Window / Help). On macOS a minimal app
  // menu still shows in the system bar; on Windows/Linux the bar is gone entirely.
  Menu.setApplicationMenu(null);
  try {
    const port = await startServer();
    createWindow(port);
  } catch (err) {
    console.error("[mqrg] failed to start:", err);
    app.quit();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) startServer().then(createWindow);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => { try { child?.kill(); } catch { /* already gone */ } });
