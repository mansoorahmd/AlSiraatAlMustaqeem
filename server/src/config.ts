// Remote service configuration. The default connection string targets the local Postgres
// (user `postgres`, password `researchgate`, database `researchgate`, port 5432); override
// with DATABASE_URL in any real deployment. `assertDeployable()` refuses to start a production
// server (NODE_ENV=production) whose settings would be unsafe or broken — see DEPLOY.md.

const port = Number(process.env.REMOTE_PORT ?? 8100);
const env = process.env;

export const config = {
  production: env.NODE_ENV === "production",
  databaseUrl: env.DATABASE_URL ?? "postgres://postgres:researchgate@localhost:5432/researchgate",
  port,
  /** The server's public address, e.g. https://research.example.org — links in emails use it. */
  baseUrl: (env.REMOTE_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, ""),
  /** Signs sessions. MUST be set to a real secret in any deployment. */
  authSecret: env.AUTH_SECRET ?? "dev-only-insecure-secret-change-me",
  /**
   * Origins allowed to call with credentials. The app runs on the reader's own machine, so these
   * are local origins even in production: the Vite dev server (5174), `npm start`'s preview of the
   * built app (8000), and the desktop shell's stable port (51789 — see electron/main.mjs
   * PREFERRED_PORT). 127.0.0.1 and localhost are DIFFERENT
   * origins to a browser, so both spellings are listed.
   */
  // (empty counts as unset: compose passes `TRUSTED_ORIGINS=` when .env leaves it blank)
  trustedOrigins: (env.TRUSTED_ORIGINS?.trim() ||
    [5174, 8000, 51789].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]).join(","))
    .split(",").map((s) => s.trim()).filter(Boolean),
  /** "console" prints emails (magic links, password resets) to the log; "smtp" sends them. */
  emailTransport: env.EMAIL_TRANSPORT ?? "console",
  smtp: {
    host: env.SMTP_HOST ?? "",
    port: Number(env.SMTP_PORT ?? 587),
    /** true = TLS from the first byte (port 465); false = STARTTLS upgrade (587) */
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : Number(env.SMTP_PORT ?? 587) === 465,
    user: env.SMTP_USER ?? "",
    pass: env.SMTP_PASS ?? "",
    /** the From: line, e.g. "MQ Research Gate <no-reply@example.org>" */
    from: env.SMTP_FROM ?? "",
  },
};

export const isDevSecret = config.authSecret.startsWith("dev-only");

/**
 * Served over HTTPS, the app (always on the reader's localhost) and this server are different
 * SITES, so the session cookie must be SameSite=None; Secure or the browser won't send it.
 */
export const crossSiteCookies = config.baseUrl.startsWith("https://");

/** Why this environment can't run in production — empty when it can. */
export function deployProblems(e: Record<string, string | undefined> = process.env): string[] {
  const p: string[] = [];
  const secret = e.AUTH_SECRET ?? "";
  if (!secret || secret.startsWith("dev-only")) p.push("AUTH_SECRET is not set (generate one: openssl rand -base64 48)");
  else if (secret.length < 32) p.push("AUTH_SECRET is shorter than 32 characters");
  if (!e.DATABASE_URL) p.push("DATABASE_URL is not set");
  if (!e.REMOTE_BASE_URL?.startsWith("https://")) {
    p.push(`REMOTE_BASE_URL must be the public https:// address (got ${e.REMOTE_BASE_URL ?? "nothing"})`);
  }
  const transport = e.EMAIL_TRANSPORT ?? "console";
  if (transport === "smtp") {
    if (!e.SMTP_HOST) p.push("EMAIL_TRANSPORT=smtp but SMTP_HOST is not set");
    if (!e.SMTP_FROM) p.push("EMAIL_TRANSPORT=smtp but SMTP_FROM is not set");
  } else if (transport !== "console") {
    p.push(`EMAIL_TRANSPORT must be smtp or console (got ${transport})`);
  }
  return p;
}

/** Refuse to start a production server that would be unsafe or broken. */
export function assertDeployable(): void {
  if (!config.production) return;
  const problems = deployProblems();
  if (problems.length) {
    throw new Error(`refusing to start — fix the environment (see DEPLOY.md):\n  • ${problems.join("\n  • ")}`);
  }
  if (config.emailTransport === "console") {
    console.warn("EMAIL_TRANSPORT=console: password-reset emails are only printed to this log");
  }
}
