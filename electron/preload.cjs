// Minimal, sandbox-safe bridge. A sandboxed preload must be CommonJS (hence .cjs),
// and may only use `electron`'s contextBridge + ipcRenderer. The renderer stays a
// normal web page talking to the local server over HTTP; the only thing it can't do
// from the page is open a native save dialog, so that's all we expose here.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  // → { path, bytes, at } on success, or { canceled: true } if the dialog was dismissed
  backupResearch: () => ipcRenderer.invoke("research:backup"),
});
