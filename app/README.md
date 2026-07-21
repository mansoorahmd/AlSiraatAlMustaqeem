# The Investigation — app

Fresh UI (UI_ACTION_PLAN.md v2). Dual home — Read / Investigate / Vault —
over the existing `quran_api` FastAPI service.

## Run

```bash
# 1. backend (project root)
uvicorn quran_api.main:app --port 8000

# 2. frontend
cd app
npm install
npm run dev        # http://localhost:5174
```

`npm run typecheck` / `npm run build` for CI-style verification.

## Structure

```
src/
├── api/            # typed client for quran_api (ported from ui/)
├── components/     # TopBar (tabs + API status)
├── screens/        # ReadingRoom · Investigate · Vault
├── state/          # session state (tab, reading prefs, active case)
├── persistence/    # IndexedDB local-first archive: cases, vault, trails, prefs
├── theme/          # illuminated-archive design tokens
└── styles.css      # base + shell styles
```

V0 status: shell, theme, persistence, API wiring done. Reader arrives in V1.
The old focus+panels prototype remains in `ui/` for reference.
