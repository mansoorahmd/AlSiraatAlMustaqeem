// Invite-only registration is the gate on the whole remote. These run against real Postgres
// (PGlite, in-process) and cover the rules that matter: single use, expiry, no duplicate
// accounts, and that the granted role comes from the INVITE — never from the request.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations, type SqlRunner } from "../src/migrate.js";
import {
  createInvite, validateInvite, emailTaken, finishRedeem, bindLocalId, loadPrincipal, InviteError,
} from "../src/invites.js";

const MIGR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

let db: PGlite;
let r: SqlRunner;
let maintainer: string;

beforeAll(async () => {
  db = new PGlite();
  r = {
    exec: (sql) => db.exec(sql).then(() => undefined),
    query: async (sql, params = []) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[],
  };
  await runMigrations(r, MIGR);
});

beforeEach(async () => {
  // a fresh maintainer to issue invites (the real one comes from the bootstrap CLI)
  await db.exec("DELETE FROM invites; DELETE FROM users;");
  const rows = (await r.query(
    "INSERT INTO users (email, role) VALUES ('boss@example.org','maintainer') RETURNING id",
  )) as { id: string }[];
  maintainer = rows[0]!.id;
});

/**
 * Mirrors exactly what POST /invites/redeem does, with a plain INSERT standing in for
 * Better Auth's signUpEmail (which owns account creation + password hashing). The rules being
 * tested — validity, single use, expiry, duplicate email, role from the invite — are ours.
 */
async function redeem(opts: { code: string; email: string; localId?: string }) {
  const email = opts.email.trim().toLowerCase();
  if (!email.includes("@")) throw new InviteError("a valid email is required", 422);
  const invite = await validateInvite(r, opts.code);
  if (await emailTaken(r, email)) throw new InviteError("an account already exists for that email", 409);
  const [u] = await r.query("INSERT INTO users (email) VALUES ($1) RETURNING id", [email]) as { id: string }[];
  await finishRedeem(r, { code: opts.code, userId: u!.id, role: invite.role, localId: opts.localId });
  return { userId: u!.id, role: invite.role, email };
}

describe("issuing invites", () => {
  it("defaults to the researcher role and is unredeemed", async () => {
    const inv = await createInvite(r, { issuedBy: maintainer });
    expect(inv.role).toBe("researcher");
    expect(inv.redeemed_by).toBeNull();
    expect(inv.code.length).toBeGreaterThan(10);
  });

  it("can grant any valid role, and refuses an invalid one", async () => {
    expect((await createInvite(r, { issuedBy: maintainer, role: "moderator" })).role).toBe("moderator");
    await expect(createInvite(r, { issuedBy: maintainer, role: "wizard" as never })).rejects.toThrow();
  });
});

describe("redeeming invites", () => {
  it("creates the account with the role from the INVITE, not the request", async () => {
    const inv = await createInvite(r, { issuedBy: maintainer, role: "moderator" });
    const out = await redeem({ code: inv.code, email: "New@Example.org" });
    expect(out.role).toBe("moderator");
    expect(out.email).toBe("new@example.org"); // normalised
    // and it really is their role in the domain table
    expect((await loadPrincipal(r, out.userId))!.role).toBe("moderator");
  });

  it("is single-use", async () => {
    const inv = await createInvite(r, { issuedBy: maintainer });
    await redeem({ code: inv.code, email: "first@example.org" });
    await expect(redeem({ code: inv.code, email: "second@example.org" }))
      .rejects.toThrow(/already redeemed/);
  });

  it("rejects an unknown code", async () => {
    await expect(redeem({ code: "nope", email: "x@example.org" }))
      .rejects.toThrow(/not found/);
  });

  it("rejects an expired invite", async () => {
    const inv = await createInvite(r, { issuedBy: maintainer, code: "expiring" });
    await r.query("UPDATE invites SET expires_at = now() - interval '1 day' WHERE code = 'expiring'");
    await expect(redeem({ code: inv.code, email: "late@example.org" }))
      .rejects.toThrow(/expired/);
  });

  it("refuses an email that already has an account", async () => {
    const a = await createInvite(r, { issuedBy: maintainer });
    const b = await createInvite(r, { issuedBy: maintainer });
    await redeem({ code: a.code, email: "dup@example.org" });
    await expect(redeem({ code: b.code, email: "dup@example.org" }))
      .rejects.toThrow(/already exists/);
  });

  it("rejects a malformed email with 422", async () => {
    const inv = await createInvite(r, { issuedBy: maintainer });
    await expect(redeem({ code: inv.code, email: "not-an-email" }))
      .rejects.toThrow(InviteError);
  });
});

describe("local_id binding (Phase 1 attribution)", () => {
  it("binds at redemption", async () => {
    const inv = await createInvite(r, { issuedBy: maintainer });
    const local = "11111111-2222-3333-4444-555555555555";
    const out = await redeem({ code: inv.code, email: "bound@example.org", localId: local });
    expect((await loadPrincipal(r, out.userId))!.localId).toBe(local);
  });

  it("can be bound or re-bound afterwards", async () => {
    const inv = await createInvite(r, { issuedBy: maintainer });
    const out = await redeem({ code: inv.code, email: "later@example.org" });
    expect((await loadPrincipal(r, out.userId))!.localId).toBeNull();
    const local = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await bindLocalId(r, out.userId, local);
    expect((await loadPrincipal(r, out.userId))!.localId).toBe(local);
  });
});
