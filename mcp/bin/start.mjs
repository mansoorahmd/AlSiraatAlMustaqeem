// Launcher for MCP clients.
//
// Clients start servers with an unpredictable working directory (Claude Desktop on
// Windows uses C:\WINDOWS\system32), and `node --import tsx …` resolves the loader
// relative to the CWD — so that form dies with "Cannot find package 'tsx'".
//
// This file resolves everything relative to ITSELF, so the only thing a client
// config needs is an absolute path to it:
//
//   { "command": "node", "args": ["C:\\path\\to\\mcp\\bin\\start.mjs"] }
//
// Plain .mjs so node runs it with no loader; tsx is registered programmatically
// (resolved from this file's node_modules) before the TypeScript entry is imported.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// node:sqlite emits an ExperimentalWarning on every start; it would appear in the
// client's log on every launch and mean nothing to the reader.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes("SQLite is an experimental feature")) return;
  return emitWarning(warning, ...rest);
};

try {
  // resolved from mcp/, not from the working directory
  const tsxApi = pathToFileURL(require.resolve("tsx/esm/api")).href;
  const { register } = await import(tsxApi);
  register();
} catch (err) {
  process.stderr.write(
    "[alsiraat-mcp] Could not load tsx — dependencies are probably not installed.\n" +
      "[alsiraat-mcp] Run `npm install` in the project root, then restart the client.\n" +
      `[alsiraat-mcp] (${(err && err.message) || err})\n`,
  );
  process.exit(1);
}

await import("../src/index.ts");
