import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Everything the app reads and writes is on the research server (VITE_REMOTE_URL, default
// http://localhost:8100) — nothing to proxy. `npm start` previews the built app on :8000, an origin
// the research server trusts by default (server/src/config.ts).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 8000, strictPort: true },
});
