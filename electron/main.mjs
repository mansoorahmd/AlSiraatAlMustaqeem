// Electron main process for MQ Research Gate desktop.
//
// It boots the app's own Hono server (bundled to build/server.cjs) as a Node
// utility process, then opens a window pointed at it. Nothing about the web app
// changes — this is just a native shell around the same server + SPA.
//
// Data:
//   • quran.db ships read-only inside the app bundle (resources), copied nowhere.
//   • research.db lives in the OS user-data dir so the reader's work survives app
//     updates and isn't tied to any source checkout. Seeded from the bundle on first
//     run if one is shipped, else created by the server on first write.

import { app, BrowserWindow, Menu, shell, utilityProcess } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
// packaged: resources/ holds the read-only assets; dev: repo root two levels up
const RES = process.resourcesPath ?? join(here, "..");
const isDev = !app.isPackaged;

// A STABLE port, so the window's origin (127.0.0.1:PORT) — and therefore the
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

  // read-only corpus from the bundle; research db in userData
  const quranDb = isDev ? join(here, "..", "quran.db") : join(RES, "quran.db");
  const dataDir = app.getPath("userData");
  mkdirSync(dataDir, { recursive: true });
  const researchDb = join(dataDir, "research.db");
  const seed = isDev ? join(here, "..", "research.db") : join(RES, "research.db");
  if (!existsSync(researchDb) && existsSync(seed)) copyFileSync(seed, researchDb);

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
      QF_RESEARCH_DB: researchDb,
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  // open external links in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
}

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
