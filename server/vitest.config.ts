import { defineConfig } from "vitest/config";
// Most files start an in-memory Postgres (PGlite) and run every migration in beforeAll. With the
// files running in parallel that can pass vitest's 10 s default under load, so setup gets longer.
export default defineConfig({ test: { environment: "node", hookTimeout: 60_000, testTimeout: 30_000 } });
