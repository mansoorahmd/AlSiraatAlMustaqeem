// The MCP, hosted: streamable HTTP at /mcp, so an AI client connects with a URL and a token and
// installs nothing. The same server the stdio MCP runs (mcp/src/server.ts), over the same reads
// and writes — they just reach this app IN-PROCESS instead of over the network, carrying the
// caller's token, so the corpus and research routes apply exactly the rules they do for a token.
//
// Two ways to pass the token (a personal API token from the app, api-tokens.ts):
//   • POST /mcp          with `Authorization: Bearer mqrg_…`  — Claude Code, VS Code, Cursor
//   • POST /mcp/mqrg_…   the token in the path               — clients that take only a URL
//                                                               (Claude's custom connectors)
//
// Stateless: every request gets a fresh MCP server and transport, so there is nothing to share
// between users and nothing to clean up. Replies are plain JSON (no SSE stream to hold open).

import type { Context, Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../../mcp/src/server.js";
import { remoteReads } from "../../mcp/src/corpus-client.js";
import { remoteResearch } from "../../mcp/src/research-client.js";
import { pgRunner } from "./db.js";
import { config } from "./config.js";
import { userForToken, TOKEN_PREFIX } from "./api-tokens.js";
import type { Env } from "./roles.js";

/** The origin in-process calls are addressed to; they never leave this process. */
const SELF = "http://mcp.internal";

const rpcError = (c: Context, status: 401 | 405, message: string) =>
  c.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, status);

export function mountMcp(app: Hono<Env>): void {
  const inProcess = (url: string, init?: RequestInit) => Promise.resolve(app.fetch(new Request(url, init)));

  const handle = async (c: Context<Env>, token: string | undefined) => {
    if (c.req.method !== "POST") return rpcError(c, 405, "POST MCP messages to this URL (stateless server)");
    if (!token?.startsWith(TOKEN_PREFIX) || !(await userForToken(pgRunner, token))) {
      c.header("WWW-Authenticate", 'Bearer realm="mcp"');
      return rpcError(c, 401, "a valid API token is required — create one in the app (Account → Connect an AI assistant)");
    }
    const server = createMcpServer({
      ...remoteReads(SELF, token, inProcess),
      research: remoteResearch(SELF, token, inProcess),
    }, { iconUrl: `${config.baseUrl}/icon-512.png` });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  };

  app.all("/mcp", (c) => handle(c, c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]));
  app.all("/mcp/:token", (c) => handle(c, c.req.param("token")));
}
