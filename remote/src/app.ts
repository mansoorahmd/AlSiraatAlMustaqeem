// The remote research-channel HTTP surface.
//
//   /api/auth/*            Better Auth (magic-link sign-in, session) — mounted raw
//   POST /invites          issue an invite            [maintainer]
//   POST /invites/redeem   redeem one (creates the account)   [public — the code IS the auth]
//   GET  /me               who am I, and what may I do        [any signed-in user]
//   POST /me/local-id      bind this device's local_id        [any signed-in user]
//
// Submission / review / pull routes land in Phases 4–7, guarded by requireRole.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { pgRunner } from "./db.js";
import { sessionMiddleware } from "./session.js";
import { requireRole, type Env } from "./roles.js";
import { createInvite, redeemInvite, bindLocalId, loadPrincipal, InviteError } from "./invites.js";

export function createApp(): Hono<Env> {
  const app = new Hono<Env>();

  // Credentialed CORS for the app's origins (must be an explicit list, never "*"). This has to
  // cover EVERY route the app calls — /me and /invites too, not just the auth endpoints — or the
  // browser blocks the request and the app can't tell that apart from the server being down.
  app.use("*", cors({ origin: config.trustedOrigins, credentials: true }));

  // Better Auth speaks Web-standard Request/Response — hand it the raw request
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

  app.get("/health", (c) => c.json({ status: "ok", service: "remote" }));

  // Where a verified magic link lands. Two jobs: tell a human it worked, and give the desktop
  // sign-in window a URL it can recognise so it knows the cookie is set and can close itself.
  app.get("/signed-in", (c) =>
    c.html(
      `<!doctype html><meta charset="utf-8"><title>Signed in</title>
       <style>body{font-family:Georgia,serif;background:#f4f1ea;color:#3b3226;
         display:grid;place-items:center;height:100vh;margin:0;text-align:center}
         p{max-width:22rem;line-height:1.5}</style>
       <div><h1>Signed in</h1>
       <p>You can close this window and return to MQ Research Gate.</p></div>`,
    ));

  // everything below may know who the caller is
  app.use("*", sessionMiddleware);

  app.get("/me", requireRole("reader"), async (c) => {
    const me = c.get("user")!;
    const p = await loadPrincipal(pgRunner, me.id);
    return c.json({ id: me.id, role: me.role, localId: p?.localId ?? null });
  });

  app.post("/me/local-id", requireRole("reader"), async (c) => {
    const { localId } = (await c.req.json().catch(() => ({}))) as { localId?: string };
    if (!localId) return c.json({ detail: "localId is required" }, 422);
    await bindLocalId(pgRunner, c.get("user")!.id, localId);
    return c.json({ ok: true });
  });

  app.post("/invites", requireRole("maintainer"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { role?: string; expiresInDays?: number };
    try {
      const invite = await createInvite(pgRunner, {
        issuedBy: c.get("user")!.id,
        role: body.role as never,
        expiresInDays: body.expiresInDays,
      });
      return c.json(invite, 201);
    } catch (e) {
      return c.json({ detail: (e as Error).message }, 400);
    }
  });

  // public: the invite code is the credential. Creates the account so the invitee can
  // then sign in by magic link (Better Auth itself never creates users).
  app.post("/invites/redeem", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as
      { code?: string; email?: string; displayName?: string; localId?: string };
    if (!body.code || !body.email) return c.json({ detail: "code and email are required" }, 422);
    try {
      return c.json(await redeemInvite(pgRunner, {
        code: body.code, email: body.email,
        displayName: body.displayName, localId: body.localId,
      }), 201);
    } catch (e) {
      if (e instanceof InviteError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  return app;
}
