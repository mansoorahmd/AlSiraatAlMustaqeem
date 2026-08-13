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
import {
  createInvite, bindLocalId, loadPrincipal, setDisplayName,
  validateInvite, emailTaken, finishRedeem, InviteError,
} from "./invites.js";
import {
  createSubmission, listMine, getSubmission, SubmissionError, type SubmissionItemInput,
} from "./submissions.js";

export function createApp(): Hono<Env> {
  const app = new Hono<Env>();

  // Credentialed CORS for the app's origins (must be an explicit list, never "*"). This has to
  // cover EVERY route the app calls — /me and /invites too, not just the auth endpoints — or the
  // browser blocks the request and the app can't tell that apart from the server being down.
  app.use("*", cors({ origin: config.trustedOrigins, credentials: true }));

  // Registration is invite-only, so the public sign-up endpoint is closed. Email+password is
  // enabled for SIGN-IN, and the only thing allowed to create an account is /invites/redeem,
  // which calls auth.api.signUpEmail internally (a server-side call, not this HTTP route).
  // This must be registered BEFORE the catch-all below.
  app.post("/api/auth/sign-up/email", (c) =>
    c.json({ detail: "registration is invite-only — redeem an invite code" }, 403));

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
    return c.json({
      id: me.id, role: me.role,
      email: p?.email ?? "", displayName: p?.displayName ?? "",
      localId: p?.localId ?? null,
    });
  });

  app.post("/me/name", requireRole("reader"), async (c) => {
    const { displayName } = (await c.req.json().catch(() => ({}))) as { displayName?: string };
    if (!displayName?.trim()) return c.json({ detail: "displayName is required" }, 422);
    await setDisplayName(pgRunner, c.get("user")!.id, displayName);
    return c.json({ ok: true });
  });

  app.post("/me/local-id", requireRole("reader"), async (c) => {
    const { localId } = (await c.req.json().catch(() => ({}))) as { localId?: string };
    if (!localId) return c.json({ detail: "localId is required" }, 422);
    await bindLocalId(pgRunner, c.get("user")!.id, localId);
    return c.json({ ok: true });
  });

  // --- submissions: local research offered upstream (Phase 4, additive kinds only) ---
  // Guarded at `researcher`: a reader may pull the group's work but not publish into it.
  app.post("/submissions", requireRole("researcher"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as
      { items?: SubmissionItemInput[]; supersedes?: string | null };
    try {
      const out = await createSubmission(pgRunner, {
        authorId: c.get("user")!.id,
        items: body.items ?? [],
        supersedes: body.supersedes ?? null,
      });
      return c.json(out, 201);
    } catch (e) {
      if (e instanceof SubmissionError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  app.get("/submissions", requireRole("researcher"), async (c) =>
    c.json(await listMine(pgRunner, c.get("user")!.id)));

  app.get("/submissions/:id", requireRole("researcher"), async (c) => {
    const found = await getSubmission(pgRunner, c.req.param("id"));
    if (!found) return c.json({ detail: "submission not found" }, 404);
    return c.json(found);
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

  // Public: the invite code is the credential. Creates the account WITH a password, so every
  // later sign-in is just email + password — no email transport, and no magic link to shuttle
  // into the desktop app. Better Auth creates the user (it owns password hashing, storing it in
  // `account`); we then apply the invite's role and burn the code.
  app.post("/invites/redeem", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as
      { code?: string; email?: string; password?: string; displayName?: string; localId?: string };
    if (!body.code || !body.email || !body.password) {
      return c.json({ detail: "code, email and password are required" }, 422);
    }
    const email = body.email.trim().toLowerCase();
    try {
      const invite = await validateInvite(pgRunner, body.code);
      if (await emailTaken(pgRunner, email)) {
        throw new InviteError("an account already exists for that email", 409);
      }
      const created = await auth.api.signUpEmail({
        body: { email, password: body.password, name: body.displayName?.trim() || "" },
      });
      const userId = String(created.user.id);
      await finishRedeem(pgRunner, { code: body.code, userId, role: invite.role, localId: body.localId });
      return c.json({ userId, email, role: invite.role }, 201);
    } catch (e) {
      if (e instanceof InviteError) return c.json({ detail: e.message }, e.status as 400);
      // Better Auth rejects e.g. too-short passwords with its own APIError
      const msg = (e as Error).message || "could not create the account";
      return c.json({ detail: msg }, 400);
    }
  });

  return app;
}
