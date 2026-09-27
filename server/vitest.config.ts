import { defineConfig } from "vitest/config";
// setup.ts gives every test file its own throwaway research.db (see there for why).
export default defineConfig({ test: { environment: "node", setupFiles: ["./test/setup.ts"] } });
