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
import { requireRole, requireSession, isStaff, type Env } from "./roles.js";
import {
  requireFeature, validAudience, makeAudienceCheck, listRoles, setRoleLevel, removeRoleLevel,
  listFeatures, setFeatureMinRole, roleRank, featureMinRole,
} from "./role-ladder.js";
import { loadTiers, rankOf, setTier, removeTier, TierError, FREE } from "./plans.js";
import {
  requireResource, wholeMin, canRead, listRules, setRule, removeRule, isResourceKind,
} from "./resource-access.js";
import { createToken, listTokens, revokeToken } from "./api-tokens.js";
import { RESET_PAGE, RESET_PAGE_HEADERS } from "./reset-page.js";
import { listUsers, setRole, listResources, isUserId, AdminError } from "./admin.js";
import { corpusApp } from "./corpus/serve.js";
import { pgCorpus } from "./corpus/pg-corpus.js";
import { createCorpusServices, type CorpusServices } from "../../server/src/corpus-services.js";
import { corpusRunner, researchConnections } from "./db.js";
import { researchApp } from "./research/serve.js";

/** The corpus services over Postgres — one set per process, so their in-memory indexes are built
 *  once. server.ts warms them at startup. */
export const cloudCorpus: CorpusServices = createCorpusServices(pgCorpus(corpusRunner));
import {
  createInvite, bindLocalId, loadPrincipal, setDisplayName,
  validateInvite, emailTaken, finishRedeem, InviteError,
  setPlan, userIdByEmail,
} from "./invites.js";
import {
  createSubmission, listMine, getSubmission, SubmissionError, type SubmissionItemInput,
} from "./submissions.js";
import {
  proposeClaim, review, claimsFor, globalReading, dissentsFor, establishAsMaintainer,
  setAudience,
  divergencesAgainstGlobal, communityReadingsFor, ClaimError, type SubjectKind, type Decision,
} from "./claims.js";
import { pullSince, STREAMS, type Cursors } from "./pull.js";

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

  // where a password-reset email lands (reset-page.ts); the reset itself is Better Auth's
  app.get("/reset-password", (c) => c.body(RESET_PAGE, 200, RESET_PAGE_HEADERS));

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
    const tiers = await loadTiers(pgRunner);
    const plan = me.plan ?? FREE;
    return c.json({
      id: me.id, role: me.role,
      email: p?.email ?? "", displayName: p?.displayName ?? "",
      localId: p?.localId ?? null,
      // The billing axis. `planActive` = this account may read the community resource right now
      // (its tier, not lapsed) — the flag the app's community UI reads. Never infer from the name.
      plan,
      planLabel: tiers.get(plan)?.label ?? plan,
      planRank: rankOf(tiers, plan),
      planExpiresAt: me.planExpiresAt ?? null,
      planActive: canRead(me, await wholeMin(pgRunner, "community"), tiers),
      // the role axis: its place on the ladder, and whether publishing is open to it
      roleRank: p?.roleRank ?? null,
      roleLabel: (await listRoles(pgRunner)).find((x) => x.name === me.role)?.label || me.role,
      canPublish: (p?.roleRank ?? -1) >= (await roleRank(pgRunner, await featureMinRole(pgRunner, "publish"))),
      publishRole: await featureMinRole(pgRunner, "publish"),
    });
  });

  // Grant or revoke a plan tier. Maintainer-only — the manual stand-in for billing until it is
  // wired. `expiresInDays` omitted = a grant that never lapses; plan 'free' revokes.
  app.post("/plan", requireRole("maintainer"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as
      { email?: string; plan?: string; expiresInDays?: number | null };
    if (!body.email || !body.plan) return c.json({ detail: "email and plan are required" }, 422);
    const userId = await userIdByEmail(pgRunner, body.email);
    if (!userId) return c.json({ detail: `no account for ${body.email}` }, 404);
    try {
      await setPlan(pgRunner, { userId, plan: body.plan, expiresInDays: body.expiresInDays ?? null });
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
    return c.json({ ok: true, email: body.email.trim().toLowerCase(), plan: body.plan });
  });

  // --- the plan ladder: data, edited at runtime (plans.ts) ---
  // Public read so the app can show what each tier is; edits are a maintainer act.
  app.get("/plan-tiers", async (c) => c.json([...(await loadTiers(pgRunner)).values()]));

  app.put("/plan-tiers/:name", requireRole("maintainer"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { rank?: number; label?: string };
    try {
      return c.json(await setTier(pgRunner, { name: c.req.param("name"), rank: Number(body.rank), label: body.label }));
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  app.delete("/plan-tiers/:name", requireRole("maintainer"), async (c) => {
    try {
      await removeTier(pgRunner, c.req.param("name"));
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  // --- resources are plan-based (resource-access.ts); features below are role-based ---
  // Public read, so the app can say what a resource needs BEFORE the reader hits a 401/402.
  app.get("/resource-access", async (c) => c.json(await listRules(pgRunner)));

  /** Set a resource's minimum tier: {minPlan: "<tier>" | "free" | null (= public)}. */
  app.put("/resource-access/:kind/:key", requireRole("maintainer"), async (c) => {
    const kind = c.req.param("kind"), key = c.req.param("key");
    const body = (await c.req.json().catch(() => ({}))) as { minPlan?: string | null };
    if (!isResourceKind(kind)) return c.json({ detail: `unknown resource kind: ${kind}` }, 422);
    if (body.minPlan === undefined) return c.json({ detail: "minPlan is required (a tier, or null for public)" }, 422);
    try {
      return c.json(await setRule(pgRunner, kind, key, body.minPlan, c.get("user")!.id));
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  /** Drop a per-item rule (a translation or lexicon then needs only what the corpus needs). */
  app.delete("/resource-access/:kind/:key", requireRole("maintainer"), async (c) => {
    const kind = c.req.param("kind");
    if (!isResourceKind(kind)) return c.json({ detail: `unknown resource kind: ${kind}` }, 422);
    try {
      await removeRule(pgRunner, kind, c.req.param("key"));
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  // --- the role ladder (role-ladder.ts): data, like the plan tiers ---
  app.get("/roles", async (c) => c.json(await listRoles(pgRunner)));
  app.put("/roles/:name", requireRole("maintainer"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { rank?: number; label?: string };
    try {
      return c.json(await setRoleLevel(pgRunner, { name: c.req.param("name"), rank: body.rank, label: body.label }));
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });
  app.delete("/roles/:name", requireRole("maintainer"), async (c) => {
    try {
      await removeRoleLevel(pgRunner, c.req.param("name"));
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });
  /** Which role each configurable feature needs (today: publishing). */
  app.get("/feature-access", async (c) => c.json(await listFeatures(pgRunner)));
  app.put("/feature-access/:feature", requireRole("maintainer"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { minRole?: string };
    try {
      await setFeatureMinRole(pgRunner, c.req.param("feature"), String(body.minRole ?? ""));
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  // --- the in-app Admin screen (admin.ts) — maintainer-only ---
  const adminErr = (e: unknown) => {
    if (e instanceof AdminError || e instanceof TierError) return { detail: e.message, status: e.status };
    throw e;
  };

  app.get("/admin/users", requireRole("maintainer"), async (c) => c.json(await listUsers(pgRunner)));

  app.put("/admin/users/:id/role", requireRole("maintainer"), async (c) => {
    const { role } = (await c.req.json().catch(() => ({}))) as { role?: string };
    try {
      await setRole(pgRunner, c.req.param("id"), String(role ?? ""));
      return c.json({ ok: true });
    } catch (e) { const x = adminErr(e); return c.json({ detail: x.detail }, x.status as 400); }
  });

  /** The same grant as POST /plan, by user id (the Admin screen lists users, not emails). */
  app.put("/admin/users/:id/plan", requireRole("maintainer"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { plan?: string; expiresInDays?: number | null };
    if (!body.plan) return c.json({ detail: "plan is required" }, 422);
    const id = c.req.param("id");
    if (!isUserId(id) || !(await pgRunner.query("SELECT 1 FROM users WHERE id = $1", [id])).length) {
      return c.json({ detail: "no such user" }, 404);
    }
    try {
      await setPlan(pgRunner, { userId: id, plan: body.plan, expiresInDays: body.expiresInDays ?? null });
      return c.json({ ok: true });
    } catch (e) { const x = adminErr(e); return c.json({ detail: x.detail }, x.status as 400); }
  });

  /** Every translation and dictionary with its rule — unfiltered, unlike the public lists. */
  app.get("/admin/resources", requireRole("maintainer"), async (c) =>
    c.json(await listResources(corpusRunner, pgRunner)));

  // The Qur'an corpus itself, from Postgres — a RESOURCE, so its gate is the corpus plan rule.
  app.use("/corpus/*", requireResource("corpus", pgRunner));
  app.route("/corpus", corpusApp(cloudCorpus, pgRunner));

  // --- each account's own research (research/serve.ts): private, by row-level security ---
  app.route("/", researchApp(researchConnections) as never);

  app.post("/me/name", requireRole("reader"), async (c) => {
    const { displayName } = (await c.req.json().catch(() => ({}))) as { displayName?: string };
    if (!displayName?.trim()) return c.json({ detail: "displayName is required" }, 422);
    await setDisplayName(pgRunner, c.get("user")!.id, displayName);
    return c.json({ ok: true });
  });

  // --- personal API tokens: how a headless client (the MCP) acts as you (api-tokens.ts) ---
  // A feature, so role-based: any signed-in account. You only ever see or revoke your own —
  // and only from a signed-in session, never with a token (requireSession says why).
  app.get("/me/tokens", requireRole("reader"), requireSession, async (c) =>
    c.json(await listTokens(pgRunner, c.get("user")!.id)));

  /** Mint a token. Its secret is in this response and nowhere else — show it once. */
  app.post("/me/tokens", requireRole("reader"), requireSession, async (c) => {
    const { label } = (await c.req.json().catch(() => ({}))) as { label?: unknown };
    const name = typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : "MCP";
    return c.json(await createToken(pgRunner, c.get("user")!.id, name), 201);
  });

  app.delete("/me/tokens/:id", requireRole("reader"), requireSession, async (c) => {
    const ok = await revokeToken(pgRunner, c.get("user")!.id, c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ detail: "no such token of yours" }, 404);
  });

  app.post("/me/local-id", requireRole("reader"), async (c) => {
    const { localId } = (await c.req.json().catch(() => ({}))) as { localId?: string };
    if (!localId) return c.json({ detail: "localId is required" }, 422);
    await bindLocalId(pgRunner, c.get("user")!.id, localId);
    return c.json({ ok: true });
  });

  // --- submissions: local research offered upstream (Phase 4, additive kinds only) ---
  // Publishing is a FEATURE, so it is role-based: at least the role the maintainer set for it
  // (feature_access; researcher by default). The publisher proposes who may see it (audience).
  const publish = requireFeature("publish", pgRunner);
  app.post("/submissions", requireRole("reader"), publish, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as
      { items?: SubmissionItemInput[]; supersedes?: string | null; audience?: unknown };
    try {
      const out = await createSubmission(pgRunner, {
        authorId: c.get("user")!.id,
        items: body.items ?? [],
        supersedes: body.supersedes ?? null,
        audience: await validAudience(pgRunner, body.audience),
      });
      return c.json(out, 201);
    } catch (e) {
      if (e instanceof SubmissionError || e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  // your own outbox — anyone who has published can see what they sent
  app.get("/submissions", requireRole("reader"), async (c) =>
    c.json(await listMine(pgRunner, c.get("user")!.id)));

  app.get("/submissions/:id", requireRole("reader"), async (c) => {
    const found = await getSubmission(pgRunner, c.req.param("id"));
    const me = c.get("user")!;
    // yours, or staff reviewing it — a submission isn't anyone else's to read before approval
    if (!found || (found.authorId !== me.id && !isStaff(me))) return c.json({ detail: "submission not found" }, 404);
    return c.json(found);
  });

  // --- claims: contending readings, review, establishment, dissent (Phase 5) ---

  /** Offer your reading of a form or root. Must carry its argument (§12.1). A feature → role. */
  app.post("/claims", requireRole("reader"), publish, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as
      { subjectKind?: SubjectKind; subjectValue?: string; payload?: never; audience?: unknown };
    try {
      return c.json(await proposeClaim(pgRunner, {
        authorId: c.get("user")!.id,
        subjectKind: body.subjectKind ?? "form",
        subjectValue: body.subjectValue ?? "",
        payload: body.payload ?? {},
        audience: await validAudience(pgRunner, body.audience),
      }), 201);
    } catch (e) {
      if (e instanceof ClaimError || e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  // Everything below that READS the community's work is the community RESOURCE — plan-based,
  // one rule. (These were role-only before, which let a free account read paid readings.)
  const community = requireResource("community", pgRunner);

  /** Every reading of a subject, and the group's current one — what a reader compares. */
  // Each published result has an audience (a minimum role and plan); every read below shows the
  // viewer only what they may see. Staff see everything — they review it; authors see their own.
  const canSee = async (c: { get(k: "user"): Env["Variables"]["user"] }) => makeAudienceCheck(pgRunner, c.get("user"));

  app.get("/claims", community, async (c) => {
    const kind = (c.req.query("subjectKind") ?? "form") as SubjectKind;
    const value = c.req.query("subjectValue") ?? "";
    const see = await canSee(c);
    return c.json({
      claims: await claimsFor(pgRunner, kind, value, see),
      global: await globalReading(pgRunner, kind, value, see),
    });
  });

  app.get("/claims/:id/dissents", community, async (c) => {
    // a dissent belongs to its reading: hidden with it
    const see = await canSee(c);
    const versions = await pgRunner.query(
      `SELECT cv.audience_role, cv.audience_plan, c.author_id FROM claim_versions cv JOIN claims c ON c.id = cv.claim_id
        WHERE cv.claim_id = $1`, [c.req.param("id")]);
    if (!versions.length || !versions.some(see)) return c.json([]);
    return c.json(await dissentsFor(pgRunner, c.req.param("id")));
  });

  /**
   * ⚖ Where I stand apart — computed LIVE, the remote-only replacement for the old local
   * mirror. The client sends the forms it has established; we diff against the group's current
   * readings and return the differences. The community resource — the group's readings never
   * land on the client's disk, so the gate is real.
   */
  app.post("/divergences", community, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { forms?: unknown };
    const forms = body.forms ?? [];
    // shape-checked and capped: each form costs queries, so an unbounded list could tie up the pool
    const ok = (f: unknown): f is { subjectKind?: SubjectKind; subjectValue: string; meaning: string } =>
      !!f && typeof f === "object" && typeof (f as { subjectValue?: unknown }).subjectValue === "string" &&
      typeof (f as { meaning?: unknown }).meaning === "string" &&
      [undefined, "form", "root"].includes((f as { subjectKind?: string }).subjectKind);
    if (!Array.isArray(forms) || !forms.every(ok)) {
      return c.json({ detail: "forms must be a list of {subjectValue, meaning, subjectKind?: form|root}" }, 422);
    }
    if (forms.length > 5000) return c.json({ detail: "at most 5000 forms per request" }, 413);
    return c.json(await divergencesAgainstGlobal(pgRunner, forms, await canSee(c)));
  });

  /**
   * The community's readings of a word (its root + its exact form), for the reader's indication
   * chips — the live, gated replacement for the old local derived_peer_indications mirror. PAID.
   */
  app.get("/community/readings", community, async (c) =>
    c.json(await communityReadingsFor(pgRunner, {
      root: c.req.query("root") || null,
      lemma: c.req.query("lemma") || null,
    }, await canSee(c))));

  /**
   * The pull (Phase 6). A cursor walk over append-only streams: give me everything with
   * `seq` greater than what I already have. Replayable, so a client offline for months just
   * asks again, and a full resync is `since=0` — which is safe precisely because everything
   * here lands in the client's DERIVED tables.
   */
  app.get("/pull", community, async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 500), 2000);
    // One position per stream — each table's `seq` is its own sequence, so a single shared
    // cursor would run one stream's counter ahead of another's and skip rows. An omitted
    // stream starts at 0, which is a full resync of that stream and always safe.
    const since = Object.fromEntries(
      STREAMS.map((s) => [s, Number(c.req.query(s) ?? 0) || 0]),
    ) as Cursors;
    return c.json(await pullSince(pgRunner, since, limit, await canSee(c)));
  });

  /**
   * Approve or object. Establishment is decided here: approvals ≥ requiredApprovals AND
   * approvals > objections — a majority of the votes cast. An objection never blocks; against
   * an established reading it becomes a dissent.
   */
  app.post("/claims/:id/versions/:version/review", requireRole("moderator"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as
      { decision?: Decision; comment?: string; payload?: unknown; audience?: unknown };
    if (body.decision !== "approve" && body.decision !== "object") {
      return c.json({ detail: "decision must be approve or object" }, 422);
    }
    const me = c.get("user")!;
    try {
      // approving may confirm or change who can see it (the publisher only proposed it)
      if (body.decision === "approve" && body.audience !== undefined) {
        await setAudience(pgRunner, c.req.param("id"), Number(c.req.param("version")), await validAudience(pgRunner, body.audience));
      }
      return c.json(await review(pgRunner, {
        claimId: c.req.param("id"), version: Number(c.req.param("version")),
        moderatorId: me.id, moderatorRole: me.role,
        decision: body.decision, comment: body.comment, payload: body.payload,
      }));
    } catch (e) {
      if (e instanceof ClaimError || e instanceof TierError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
  });

  /** A maintainer establishing directly — §4 grants the authority; it's recorded as their act. */
  app.post("/claims/:id/versions/:version/establish", requireRole("maintainer"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { comment?: string; audience?: unknown };
    try {
      if (body.audience !== undefined) {
        await setAudience(pgRunner, c.req.param("id"), Number(c.req.param("version")), await validAudience(pgRunner, body.audience));
      }
      await establishAsMaintainer(pgRunner, {
        claimId: c.req.param("id"), version: Number(c.req.param("version")),
        maintainerId: c.get("user")!.id, comment: body.comment,
      });
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof ClaimError) return c.json({ detail: e.message }, e.status as 400);
      throw e;
    }
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
      return c.json({ detail: (e as Error).message }, (e instanceof InviteError ? e.status : 400) as 400);
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
