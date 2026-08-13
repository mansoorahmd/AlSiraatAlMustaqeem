// Regression: CORS must cover EVERY route the app calls, not just /api/auth/*.
//
// A browser turns a missing Access-Control-Allow-Origin into a thrown fetch — indistinguishable
// from the server being down — so a gap here surfaces in the app as the misleading "research
// server isn't reachable". That happened; this stops it happening again.

import { describe, it, expect } from "vitest";
import type { Hono } from "hono";
import type { Env } from "../src/roles.js";

const ORIGIN = "http://localhost:5174";        // the Vite dev server
const DESKTOP = "http://127.0.0.1:51789";      // the Electron shell's stable port
const EVIL = "http://evil.example.com";

// Resolved at module load (before collection) so the skip decision is accurate: createApp
// imports the Better Auth instance, which only exists where better-auth is installed.
process.env.DATABASE_URL ??= "postgres://postgres:researchgate@localhost:5432/researchgate";
let app: Hono<Env> | null = null;
try {
  const { createApp } = await import("../src/app.js");
  app = createApp();
} catch {
  app = null;
}
const ready = app !== null;

const allow = async (path: string, origin = ORIGIN) =>
  (await app!.request(path, { headers: { origin } })).headers.get("access-control-allow-origin");

describe.skipIf(!ready)("CORS covers the app-facing routes", () => {
  it("allows the app origin on /me, /invites and the auth endpoints", async () => {
    for (const path of [
      "/me", "/invites", "/invites/redeem", "/submissions", "/api/auth/session", "/health",
    ]) {
      expect(await allow(path), `missing CORS on ${path}`).toBe(ORIGIN);
    }
  });

  it("allows the desktop shell origin", async () => {
    expect(await allow("/me", DESKTOP)).toBe(DESKTOP);
  });

  it("does not allow an untrusted origin", async () => {
    expect(await allow("/me", EVIL)).not.toBe(EVIL);
  });

  it("sends credentials:true so the session cookie is usable", async () => {
    const res = await app!.request("/me", { headers: { origin: ORIGIN } });
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
