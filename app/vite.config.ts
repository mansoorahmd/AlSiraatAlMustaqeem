import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api/* to the TypeScript backend (Hono on :8000), which
// serves the versioned /api/v1 surface directly — no prefix rewrite.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
