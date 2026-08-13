// Remote service configuration. The default connection string targets the local Postgres
// (user `postgres`, password `researchgate`, database `researchgate`, port 5432); override
// with DATABASE_URL in any real deployment.

const port = Number(process.env.REMOTE_PORT ?? 8100);

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:researchgate@localhost:5432/researchgate",
  port,
  baseUrl: process.env.REMOTE_BASE_URL ?? `http://localhost:${port}`,
  /** Signs sessions. MUST be set to a real secret in any deployment. */
  authSecret: process.env.AUTH_SECRET ?? "dev-only-insecure-secret-change-me",
  /**
   * Origins allowed to call the auth endpoints with credentials. Covers the Vite dev server
   * (5174), the local API serving the built SPA (8000), and the desktop shell's stable port
   * (51789 — see electron/main.mjs PREFERRED_PORT). 127.0.0.1 and localhost are DIFFERENT
   * origins to a browser, so both spellings are listed.
   */
  trustedOrigins: (process.env.TRUSTED_ORIGINS ??
    [5174, 8000, 51789].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]).join(","))
    .split(",").map((s) => s.trim()).filter(Boolean),
  /** "console" prints magic links to the server log (dev); real transports come later. */
  emailTransport: process.env.EMAIL_TRANSPORT ?? "console",
};

export const isDevSecret = config.authSecret.startsWith("dev-only");
