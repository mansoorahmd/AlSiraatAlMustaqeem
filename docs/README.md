# docs/ — the Research Gate Atlas

A structured snapshot of **MQ Research Gate**, kept in the repo so it's versioned with the code.

| File | For | What it is |
|---|---|---|
| `atlas.json` | AI / new chats | A compact knowledge base: components, databases, the access model, endpoints, phase status, the decision log (with the why), a file map, and a glossary. |
| `atlas.html` | Humans | The same content as a narrative page with hand-drawn architecture diagrams and per-section feedback threads. Self-contained; open it in a browser. |
| `feedback.json` | Both | The feedback history as structured entries, each tagged with the atlas section it's about. |

The atlas carries its own date (`updated` in `atlas.json`; last brought up to date 2026-11-20).
Where it disagrees with the root docs or the code, they are right.

## Conventions

- The entry point for working on the project is `CLAUDE.md` at the repo root; the references are
  `DESIGN.md`, `SERVER.md`, `CORPUS.md`, `MCP.md`, `DEPLOY.md` and `DESKTOP.md`. The atlas
  summarizes and points into them; it does not replace them.
- When the atlas is updated, update `atlas.json` and `atlas.html` together and change its
  `updated` date.

## The one line to remember

> Roles say what you may do; plans say what you may use and read. Everything lives on the research
> server — the corpus, the community, and your research, which is private to your account until
> you publish it, and then seen only by the audience it names, once a reviewer approves it.
