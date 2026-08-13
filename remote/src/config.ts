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
  /** Origins allowed to call the auth endpoints with credentials (the app's dev servers). */
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "http://localhost:5173,http://localhost:8000")
    .split(",").map((s) => s.trim()).filter(Boolean),
  /** "console" prints magic links to the server log (dev); real transports come later. */
  emailTransport: process.env.EMAIL_TRANSPORT ?? "console",
};

export const isDevSecret = config.authSecret.startsWith("dev-only");
