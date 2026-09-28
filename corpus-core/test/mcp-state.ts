// The MCP's tool state for tests: the corpus from quran.db, and the reader's research in a real
// account on an in-process research server (PGlite) — reached as the MCP (a token, so the
// server's AI boundary applies) and, for seeding the reader's own work, as the reader.

import { resolve } from "node:path";
import { Db } from "../src/db.js";
import { sqliteCorpus } from "../src/corpus-db.js";
import { createCorpusServices } from "../src/corpus-services.js";
import { localReads } from "../../mcp/src/corpus-client.js";
import { remoteResearch, type McpResearch } from "../../mcp/src/research-client.js";
import type { McpState } from "../../mcp/src/core.js";
import { researchHarness, type ResearchHarness } from "../../server/test/research-harness.js";

const QURAN = process.env.QF_QURAN_DB ?? resolve(import.meta.dirname, "..", "..", "quran.db");
export const READER = { id: "44444444-4444-4444-8444-444444444444", email: "reader@example.org", name: "Reader" };

export interface McpTestState {
  /** what the tools run with — research as the MCP */
  state: McpState;
  /** the same research, as the reader in the app */
  reader: McpResearch;
  harness: ResearchHarness;
}

export async function mcpTestState(): Promise<McpTestState> {
  const harness = await researchHarness();
  await harness.addUser(READER);
  const over = (via: "session" | "token") => {
    const app = harness.as(READER, via);
    return remoteResearch("http://research.test", "mqrg_test", async (url, init) => app.request(url, init));
  };
  const corpus = localReads(createCorpusServices(sqliteCorpus(new Db(QURAN, { readOnly: true }))));
  return { state: { ...corpus, research: over("token") }, reader: over("session"), harness };
}
