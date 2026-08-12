// Bundle the Hono server (server/src/server.ts) into one CommonJS file that the
// Electron utility process can run. Everything is bundled EXCEPT native/optional
// SQLite drivers, which stay external and are resolved from node_modules at runtime:
//   • better-sqlite3 — the native module the desktop build actually uses
//   • node:sqlite    — a Node built-in (auto-external), only touched if the flag is unset

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

await build({
  entryPoints: [join(repo, "server", "src", "server.ts")],
  outfile: join(here, "build", "server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // keep the native driver external — esbuild can't bundle a .node binary
  external: ["better-sqlite3"],
  logLevel: "info",
  banner: {
    // the server code uses import.meta.dirname / import.meta.url in a couple of
    // places; map them onto the CJS __dirname so the bundle behaves the same
    js: "const import_meta_dirname = __dirname; const import_meta_url = require('url').pathToFileURL(__filename).href;",
  },
  define: {
    "import.meta.dirname": "import_meta_dirname",
    "import.meta.url": "import_meta_url",
  },
});

console.log("[bundle-server] wrote electron/build/server.cjs");
