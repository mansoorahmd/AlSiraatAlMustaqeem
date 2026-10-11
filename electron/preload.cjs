// Minimal, sandbox-safe bridge. A sandboxed preload must be CommonJS (hence .cjs),
// and may only use `electron`'s contextBridge + ipcRenderer. The renderer stays a
// normal web page; the only thing it can't do from the page is sign in inside the app.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  // Open the remote's sign-in page in an IN-APP window, so the Better Auth session cookie
  // is stored in this app's session rather than the system browser's.
  openSignIn: (url) => ipcRenderer.invoke("auth:open-sign-in", url),
});
