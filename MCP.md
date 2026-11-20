# The MCP server (`mcp/`)

Lets an AI assistant (Claude Desktop, Claude Code, any MCP client) study the Book *with* the
reader: it can read the corpus and the reader's research, and propose notes and indications for
them to review. It acts **as its user**, with a personal API token, so it sees exactly what that
account's plan allows.

```bash
npm run mcp                       # run it directly (stdio; for a client to launch)
npm run typecheck                 # includes the mcp workspace
REMOTE_TOKEN=mqrg_… npm run smoke -w @alsiraat/mcp   # end-to-end smoke (writes into that account)
```

The same server runs two ways: over **stdio** (`mcp/src/index.ts`, launched by a client) and
**hosted** on the research server at `/mcp` (`server/src/mcp-http.ts`, streamable HTTP, stateless,
reaching the corpus and research routes in-process with the caller's token). `mcp/src/server.ts`
builds the server for both.

## Client configuration

In the app: **Account → Connect an AI assistant → Create token**. The app shows the token once,
ready to paste. Using the AI assistant is a plan feature (`ai`); the hosted MCP checks it and
passes the lock's reason to the model.

**Hosted (nothing to install).**

- Claude app (desktop or claude.ai): Settings → Connectors → Add custom connector →
  `https://<server>/mcp/mqrg_…` (the token in the path, for clients that take only a URL)
- Claude Code, Cursor, other clients — the token as a header:

```json
{
  "mcpServers": {
    "Organic-Quranic-Methodology": {
      "type": "http",
      "url": "https://<server>/mcp",
      "headers": { "Authorization": "Bearer mqrg_…" }
    }
  }
}
```

**Local (stdio).** Needed only for `MQ_CORPUS=local` (offline, reading `quran.db`) or to work on
the MCP itself. Run `npm install` in the project root once, then point `args` at the launcher by
absolute path (no `cwd` needed):

```json
{
  "mcpServers": {
    "Organic-Quranic-Methodology": {
      "command": "node",
      "args": ["<absolute path to the repo>\\mcp\\bin\\start.mjs"],
      "env": { "REMOTE_URL": "http://localhost:8100", "REMOTE_TOKEN": "mqrg_…" }
    }
  }
}
```

| Env | Meaning |
|---|---|
| `REMOTE_URL` | the research server (default `http://localhost:8100`) |
| `REMOTE_TOKEN` | a personal API token (revoke it in the app to cut the AI off) |
| `MQ_CORPUS=local` | read `quran.db` instead of the research server — offline work; no token needed |
| `QF_QURAN_DB` | where `quran.db` is, for `MQ_CORPUS=local` |

When it can't read the corpus it tells the AI why, in words it can pass on: no or revoked token →
create one in the app; below the plan a feature needs → which plan; server unreachable → set
`REMOTE_URL`, or `MQ_CORPUS=local`. (`mcp/src/corpus-client.ts`;
`corpus-core/test/mcp-remote-corpus.test.ts` runs every corpus tool both ways and requires
identical answers.)

The reader's **research** is in their account: the MCP reads it, and writes proposals into it,
through the research server with the same token (`mcp/src/research-client.ts`). There is no
offline research: without the research server the tools that read or write research say so.
`corpus-core/test/mcp-remote-research.test.ts` runs the real tools against the research server.

## Why the stdio launcher exists

`mcp/bin/start.mjs` exists because launching this server is deceptively fragile. Two failures,
both hit in practice:

- **`npm start` breaks the protocol.** npm prints its banner to **stdout**, and on stdio
  transport stdout *is* the JSON-RPC channel, so the client dies with
  `Unexpected token '>', "> @alsiraa"... is not valid JSON`. (`npm start --silent` avoids it,
  but see the next point.)
- **`node --import tsx src/index.ts` breaks too.** Clients launch servers with an arbitrary
  working directory — Claude Desktop on Windows uses `C:\WINDOWS\system32` and ignores `cwd` —
  and `--import tsx` resolves the loader **relative to the working directory**, so it fails with
  `Cannot find package 'tsx' imported from C:\WINDOWS\system32\`.

The launcher sidesteps both: it is plain `.mjs` (no loader needed to start), registers tsx
programmatically resolved **from its own location**, prints only to stderr, and says plainly
what to do if dependencies are missing. `quran.db` (for `MQ_CORPUS=local`) is likewise resolved
from the file's location, not the working directory. `mcp/src/index.ts` also routes every
`console` channel to stderr, so no shared module can corrupt stdout.

## What it exposes

**Tools — composed** (one call answers a study question): `study_root`, `read_ayah`,
`find_where_roots_meet`, `trace_word`, `search_quran`, `compare_forms`, `my_research_on`.
**Tools — thin** (single endpoints): `get_root`, `list_roots`, `get_verses`, `get_linkages`,
`get_echoes`, `get_wazn`, `get_spelling_variants`, `get_similar_ayat`.
**Tools — notes, indications, motifs**: `add_note`, `propose_indication`, `list_motifs`,
`propose_motif`, `add_root_to_motif`, `remove_root_from_motif`.
**Tools — the Investigate board**: `list_cases`, `read_case` (read); `open_case`,
`add_evidence`, `add_slip`, `link_evidence`, `group_evidence`, `revise_own_item`,
`propose_conclusion` (write).

**Prompts:** `test_indication` (test a proposed meaning against every form of a root),
`study_ayah`, `review_my_root`.

**Resources:** `alsiraat://method` (the organic method and its hard rules — clients read this
first), `alsiraat://write-policy`, `alsiraat://research/summary`.

The method text itself is `mcp/src/method.ts`; the matching skill is
`skills/organic-quran-study/SKILL.md`.

## The boundary on writes — enforced in code, not trusted to the model

| | |
|---|---|
| Corpus (research server, or `quran.db`) | **read-only**, always — and only what the plan allows |
| Translations | **not exposed at all** — the method builds meaning from Arabic, morphology and the lexicons |
| May add | notes/questions; indications with per-form refinements; motifs; cases and their board items |
| May change | only what it added itself |
| May never | edit or delete the **reader's** notes, indications, motifs or board items |
| May never | set an indication **primary** (the reader's default gloss) |
| May never | write a case's **verdict** or **status**, or mark a form **established** — proposals only |
| May never | accept its own proposals, or change settings, comparisons or trails |
| May never | publish, review or establish in the community, administer, or manage tokens |
| Every write | tagged as AI-authored and reviewable in the app (**✦ Proposed**, and ✦ on board items) |

The server enforces this for every token request (`server/src/research/boundary.ts`, and
`requireSession` / `requireRole` on the community routes); `mcp/src/core.ts` holds the MCP's own
guard. The guard forces `primary: false` explicitly — omitting it would let the *first*
indication for a root be auto-promoted, which is precisely what must not happen.

**The Investigate board.** An AI may open cases and add evidence āyāt, comment and reference
slips, labelled threads and clusters — and may reword or remove *only the items it added
itself*. Its conclusions go into a `proposals` list on the case, shown under **✦ Proposed
conclusions** on the desk; accepting one there is the only way it can become the reader's
verdict or an established form meaning.

Two mechanics worth knowing:

- **Card placement is automatic.** The AI never supplies board coordinates; the server places
  new cards/slips on a free grid slot so nothing lands on top of the reader's layout.
- **Board writes are version-checked.** A case is stored as one JSON document and rewritten
  whole on save, so a concurrent AI write could otherwise clobber an edit made in the app. Every
  write carries the `updated_at` the AI last read and is **refused** if the case moved on — it
  must re-read and retry.
