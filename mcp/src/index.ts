// AlSiraatAlMustaqeem MCP server — the stdio entry (the tools themselves are in server.ts).
//
// Exposes the Quran corpus READ-ONLY and the reader's research read + limited
// write, so an AI can study the Book with them: roots, forms, morphology, the
// classical lexicons, echoes, spellings, collocations, and the reader's own
// indications and notes.
//
// Writes are proposals only — see method.ts (WRITE_POLICY) and core.ts (guard).
// Nothing here logs to stdout: on stdio, stdout is the protocol channel.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openState, corpusMode, resolveQuranDb } from "./core.js";
import { createMcpServer } from "./server.js";

// On stdio, STDOUT IS THE PROTOCOL CHANNEL: one stray line of text and the client
// fails with "... is not valid JSON". Our own code never prints to stdout, but the
// shared server modules might, so route every console channel to stderr and keep
// stdout exclusively for JSON-RPC. (This cannot fix a *launcher* that prints to
// stdout — see the note on `npm start` in INSTRUCTIONS.md.)
console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
console.info = console.log;
console.debug = console.log;
console.warn = console.log;

const state = await openState();

const server = createMcpServer(state);

// ---- go ----------------------------------------------------------------------

const remoteUrl = process.env.REMOTE_URL ?? "http://localhost:8100";
const corpusFrom = corpusMode() === "local" ? resolveQuranDb() : `${remoteUrl}/corpus`;
process.stderr.write(`[alsiraat-mcp] corpus: ${corpusFrom}\n[alsiraat-mcp] research: ${remoteUrl}/research\n`);

await server.connect(new StdioServerTransport());
