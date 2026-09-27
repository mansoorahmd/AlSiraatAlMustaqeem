# docs/ — the Research Gate Atlas

Living documentation of **MQ Research Gate**, kept in the repo so it's versioned with the code
and easy to pick up in a new session.

| File | For | Read when |
|---|---|---|
| **`atlas.json`** | **AI / new chats** | **Start here.** A compact, structured knowledge base: components, databases, the monetization model, role×plan matrix, remote endpoints, phase status, decisions, a file map, and a glossary. One file, fast to ingest. |
| `atlas.html` | Humans | Open for the narrative view — the same content with hand-drawn architecture diagrams and per-section feedback threads. Self-contained; open it in a browser, or use the published Artifact link for live feedback. |
| `feedback.json` | Both | The feedback / communication history as structured entries. New chats can read past decisions and open threads; Claude appends here as we exchange notes. |

## Conventions

- **`atlas.json` is the source of truth for facts.** When the architecture changes, update it (and `atlas.html` to match). Keep entries terse and include file/line pointers.
- **Feedback** is captured live in `atlas.html`'s threads (backed by the artifact `db` capability) and mirrored into `feedback.json` for repo-side extraction. Each entry is tagged with the atlas section it's about.
- The deeper design docs still live at the repo root (`INSTRUCTIONS.md`, `DESIGN.md`, `CORPUS.md`, `REMOTE.md`, `SHARED_RESEARCH*.md`). The atlas summarizes and points into them; it does not replace them.

## The one line to remember

> Features are role-based; resources are plan-based. Everything lives on the research server — the
> corpus, the community, and your research, which is private to your account until you publish it,
> and then seen only by the audience it names, once a reviewer approves it.
