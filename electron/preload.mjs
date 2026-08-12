// Intentionally minimal. The app is a normal web page talking to the local server
// over HTTP; it needs no Node/Electron bridge. Kept so contextIsolation has a
// preload to load and we have a place to add a bridge later if ever needed.
