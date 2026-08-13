// Bridges Better Auth's session to our Principal: authentication says *who*, our users row
// says *what they may do*. Populates c.var.user, which requireRole() then gates on.

import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { pgRunner } from "./db.js";
import { loadPrincipal } from "./invites.js";
import type { Env } from "./roles.js";

export const sessionMiddleware = createMiddleware<Env>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user?.id) {
    // role is ours, read from the domain table — never taken from the auth payload
    const principal = await loadPrincipal(pgRunner, String(session.user.id));
    if (principal) c.set("user", { id: principal.id, role: principal.role });
  }
  await next();
});
