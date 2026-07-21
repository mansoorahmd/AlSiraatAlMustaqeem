#!/usr/bin/env bash
set -euo pipefail

# AlSiraatAlMustaqeem — dev launcher (TypeScript stack: Node API + Vite SPA).
# Backend: Hono on :8000  ·  Frontend: Vite on :5174 (proxied to the API).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/quran.db" ]]; then
  echo "ERROR: quran.db not found in the project root." >&2
  echo "Build it first with: python build_database.py --reset" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "Installing dependencies for all workspaces..."
  npm install
fi

echo "Starting API (:8000) and web app (:5174)..."
echo "Press Ctrl+C to stop both."
echo
npm run dev
