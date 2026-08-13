// The remote research-channel HTTP surface. Foundation only for now: health + a version
// probe. Better Auth (magic-link sign-in, invite gate, local_id binding) and the
// submission / review / pull routes land in the next steps, guarded by requireRole.

import { Hono } from "hono";
import type { Env } from "./roles.js";

export function createApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.get("/health", (c) => c.json({ status: "ok", service: "remote" }));
  return app;
}
