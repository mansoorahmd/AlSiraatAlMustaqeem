// The role ladder is the authorization gate. This proves the middleware: unauthenticated
// is 401, a role at or above the rung passes, a role below it is 403. Same spirit as the
// local case/provenance boundary tests — the guard is mechanical and tested.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireRole, atLeast, ROLES, type Env } from "../src/roles.js";

// a tiny app: a test-only middleware injects the principal from an x-test-role header,
// then routes are guarded at different rungs.
function makeApp() {
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    const role = c.req.header("x-test-role");
    if (role) c.set("user", { id: "u1", role: role as never });
    await next();
  });
  app.get("/reader", requireRole("reader"), (c) => c.text("ok"));
  app.get("/moderator", requireRole("moderator"), (c) => c.text("ok"));
  app.get("/maintainer", requireRole("maintainer"), (c) => c.text("ok"));
  return app;
}

describe("role ladder", () => {
  it("orders the four roles low → high", () => {
    expect([...ROLES]).toEqual(["reader", "researcher", "moderator", "maintainer"]);
  });
  it("atLeast compares rungs", () => {
    expect(atLeast("moderator", "reader")).toBe(true);
    expect(atLeast("moderator", "moderator")).toBe(true);
    expect(atLeast("researcher", "moderator")).toBe(false);
  });
});

describe("requireRole middleware", () => {
  const app = makeApp();
  const get = (path: string, role?: string) =>
    app.request(path, role ? { headers: { "x-test-role": role } } : {});

  it("401 when unauthenticated", async () => {
    expect((await get("/reader")).status).toBe(401);
  });
  it("passes at the exact rung", async () => {
    expect((await get("/moderator", "moderator")).status).toBe(200);
  });
  it("a higher rung clears a lower gate", async () => {
    expect((await get("/reader", "maintainer")).status).toBe(200);
  });
  it("403 when below the gate", async () => {
    expect((await get("/maintainer", "researcher")).status).toBe(403);
  });
  it("403 for an unknown role string", async () => {
    expect((await get("/reader", "wizard")).status).toBe(403);
  });
});
