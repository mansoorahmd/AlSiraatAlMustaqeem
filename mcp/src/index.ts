// AlSiraatAlMustaqeem MCP server (stdio).
//
// Exposes the Quran corpus READ-ONLY and the reader's research read + limited
// write, so an AI can study the Book with them: roots, forms, morphology, the
// classical lexicons, echoes, spellings, collocations, and the reader's own
// indications and notes.
//
// Writes are proposals only — see method.ts (WRITE_POLICY) and core.ts (guard).
// Nothing here logs to stdout: on stdio, stdout is the protocol channel.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { openState, resolveDbs, WriteRefused } from "./core.js";
import { TOOLS } from "./tools.js";
import { METHOD, PROMPTS, WRITE_POLICY } from "./method.js";

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

const server = new Server(
  { name: "alsiraat-almustaqeem", version: "0.1.0" },
  { capabilities: { tools: {}, prompts: {}, resources: {} } },
);

// ---- tools -------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.writes ? `${t.description}\n\n(Writes a proposal to the reader's research.)` : t.description,
    inputSchema: zodToJsonSchema(z.object(t.schema), { $refStrategy: "none" }) as Record<string, unknown>,
    annotations: { readOnlyHint: !t.writes, destructiveHint: false, idempotentHint: !t.writes },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) {
    return { isError: true, content: [{ type: "text" as const, text: `Unknown tool: ${req.params.name}` }] };
  }
  try {
    const args = z.object(tool.schema).parse(req.params.arguments ?? {});
    const result = tool.run(state, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    // a refused write is a normal outcome the model should read and adapt to,
    // not a crash — surface the reason plainly
    const why = err instanceof WriteRefused
      ? `Refused: ${err.message}`
      : err instanceof z.ZodError
        ? `Invalid arguments: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
        : `Failed: ${(err as Error).message}`;
    return { isError: true, content: [{ type: "text" as const, text: why }] };
  }
});

// ---- resources ---------------------------------------------------------------

const RESOURCES = [
  {
    uri: "alsiraat://method",
    name: "The organic Quranic method",
    description: "How to reason here, and the rules that keep received meaning out. Read first.",
    mimeType: "text/markdown",
    read: () => METHOD,
  },
  {
    uri: "alsiraat://write-policy",
    name: "What an AI may change",
    description: "The exact boundary of AI writes: proposals only, never primary, never destructive.",
    mimeType: "text/plain",
    read: () => WRITE_POLICY,
  },
  {
    uri: "alsiraat://research/summary",
    name: "The reader's research so far",
    description: "Roots with established indications, open questions, and what is awaiting review.",
    mimeType: "text/markdown",
    read: () => {
      const gloss = state.research.glossData() as any;
      const notes = state.research.listNotes();
      const proposed = state.research.listProposed() as any;
      const questions = notes.filter((n: any) => n.kind === "question" && !n.resolved);
      const L: string[] = ["# The reader's research so far", ""];
      L.push(`## Roots with a primary indication (${gloss.roots.length})`);
      for (const r of gloss.roots) L.push(`- ${r.root} — ${r.text}`);
      if (!gloss.roots.length) L.push("(none yet)");
      L.push("", `## Per-form refinements (${gloss.refinements.length})`);
      for (const r of gloss.refinements) L.push(`- ${r.root} / ${r.lemma} — ${r.text}`);
      if (!gloss.refinements.length) L.push("(none yet)");
      L.push("", `## Open questions (${questions.length})`);
      for (const q of questions.slice(0, 40)) L.push(`- [${q.verseKey}] ${q.text}`);
      if (!questions.length) L.push("(none)");
      L.push(
        "",
        `## Awaiting the reader's review`,
        `${proposed.notes.length} note(s) and ${proposed.indications.length} indication(s) proposed by an AI.`,
      );
      return L.join("\n");
    },
  },
];

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const r = RESOURCES.find((x) => x.uri === req.params.uri);
  if (!r) throw new Error(`Unknown resource: ${req.params.uri}`);
  return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.read() }] };
});

// ---- prompts -----------------------------------------------------------------

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS.map((p) => ({
    name: p.name,
    title: p.title,
    description: p.description,
    arguments: p.args.map((a) => ({ name: a.name, description: a.description, required: !!a.required })),
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  const p = PROMPTS.find((x) => x.name === req.params.name);
  if (!p) throw new Error(`Unknown prompt: ${req.params.name}`);
  const args = (req.params.arguments ?? {}) as Record<string, string>;
  for (const a of p.args) {
    if (a.required && !args[a.name]?.trim()) throw new Error(`Missing required argument: ${a.name}`);
  }
  return {
    description: p.description,
    messages: [
      { role: "user" as const, content: { type: "text" as const, text: `${METHOD}\n\n---\n\n${p.build(args)}` } },
    ],
  };
});

// ---- go ----------------------------------------------------------------------

const { quran, research } = resolveDbs();
process.stderr.write(`[alsiraat-mcp] corpus: ${quran}\n[alsiraat-mcp] research: ${research}\n`);

await server.connect(new StdioServerTransport());
