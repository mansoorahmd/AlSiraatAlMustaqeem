@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM AlSiraatAlMustaqeem — dev launcher (TypeScript stack: Node API + Vite SPA).
REM Backend: Hono on :8000  ·  Frontend: Vite on :5174 (proxied to the API).

if not exist "quran.db" (
    echo ERROR: quran.db not found in the project root.
    echo Build it first with: python build_database.py --reset
    exit /b 1
)

if not exist "node_modules" (
    echo Installing dependencies for all workspaces...
    call npm install
    if errorlevel 1 exit /b 1
)

echo Starting API (:8000) and web app (:5174)...
echo Press Ctrl+C to stop both.
echo.
call npm run dev
