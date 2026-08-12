// Get a better-sqlite3 binary that matches Electron's ABI — WITHOUT compiling and
// WITHOUT scanning the whole workspace node_modules (electron-rebuild does both, and the
// tree-walk trips over stale npm temp dirs on Windows, e.g. EACCES on `.pkg-xxxx`).
//
// better-sqlite3 publishes prebuilt binaries for Electron, so `prebuild-install` just
// downloads the correct `.node` for the installed Electron version, into the module.
// If a prebuild isn't available it falls back to a source compile (needs build tools),
// and we say so clearly.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

function resolveFrom(spec) {
  try { return require.resolve(spec); } catch { return null; }
}

const electronVersion = require("electron/package.json").version;
const bsqlitePkg = resolveFrom("better-sqlite3/package.json");
if (!bsqlitePkg) {
  console.error("[rebuild-native] better-sqlite3 is not installed. Run `npm install` first.");
  process.exit(1);
}
const bsqliteDir = dirname(bsqlitePkg);

// prebuild-install ships as a dependency of better-sqlite3
const prebuildBin =
  resolveFrom("prebuild-install/bin.js") ??
  resolveFrom("better-sqlite3/node_modules/prebuild-install/bin.js");

console.log(`[rebuild-native] fetching a better-sqlite3 prebuild for Electron ${electronVersion}…`);

try {
  if (!prebuildBin) throw new Error("prebuild-install not found");
  execFileSync(
    process.execPath,
    [prebuildBin, "--runtime", "electron", "--target", electronVersion, "--tag-prefix", "v"],
    { cwd: bsqliteDir, stdio: "inherit" },
  );
  console.log("[rebuild-native] done — better-sqlite3 now matches Electron's ABI.");
} catch (err) {
  console.error(
    "\n[rebuild-native] prebuild download failed:", err.message,
    "\n\nFalling back to a source compile (needs build tools:",
    "\n  • Windows: Visual Studio Build Tools (Desktop C++) + Python 3",
    "\n  • macOS: Xcode command-line tools",
    "\n  • Linux: build-essential + python3",
    "\nThen run:  npm run electron:rebuild:compile",
    "\n(If you also see an EACCES on a node_modules/.<name>-xxxx temp dir, delete that",
    "\nstale folder first — it's a leftover from an interrupted npm install.)\n",
  );
  process.exit(1);
}
