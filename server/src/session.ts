// Bridges authentication to our Principal: authentication says *who*, our users row says *what
// they may do*. Populates c.var.user, which requireRole / requireResource then gate on.
//
// Two ways to say who you are:
//   • the browser app — Better Auth's session cookie
//   • a headless client (the MCP) — `Authorization: Bearer mqrg_…`, a personal API token
//     (api-tokens.ts). A token carries exactly its owner's role and plan.
// An unknown or revoked token leaves the request anonymous, so the guards answer 401.

import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { pgRunner } from "./db.js";
import { loadPrincipal } from "./invites.js";
import { userForToken, TOKEN_PREFIX } from "./api-tokens.js";
import type { Env } from "./roles.js";

export const sessionMiddleware = createMiddleware<Env>(async (c, next) => {
  let userId: string | null = null;
  let via: "session" | "token" = "session";

  const bearer = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer?.startsWith(TOKEN_PREFIX)) {
    userId = await userForToken(pgRunner, bearer);
    via = "token";
  } else {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user?.id) userId = String(session.user.id);
  }

  if (userId) {
    // role AND plan are ours, read from the domain table — never taken from the auth payload
    const principal = await loadPrincipal(pgRunner, userId);
    if (principal) {
      c.set("user", {
        id: principal.id, role: principal.role, roleRank: principal.roleRank,
        plan: principal.plan, planExpiresAt: principal.planExpiresAt, via,
      });
    }
  }
  await next();
});
