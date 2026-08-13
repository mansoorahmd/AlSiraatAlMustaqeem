// Invite-only registration. Deliberately NOT a Better Auth hook: redemption is our own
// explicit step, so the rule is plain, testable SQL and Better Auth stays a hard gate
// (`disableSignUp: true` — it will never create a user we didn't invite).
//
// Flow:
//   1. a maintainer issues an invite (a code carrying the role to grant)
//   2. the invitee redeems it with their email → we create the `users` row with that role,
//      optionally binding their local_id, and mark the invite redeemed (single use)
//   3. they then sign in by magic link — the user already exists, so no signup is needed
//
// Roles and local_id are ours, never Better Auth's (SHARED_RESEARCH.md §4).

import { randomBytes } from "node:crypto";
import type { SqlRunner } from "./migrate.js";
import { isRole, type Role } from "./roles.js";

export interface Invite {
  code: string;
  role: Role;
  expires_at: string | null;
  redeemed_by: string | null;
}

export const newInviteCode = (): string => randomBytes(16).toString("base64url");

/** Issue an invite. Caller must already be authorized as a maintainer (route guard). */
export async function createInvite(
  r: SqlRunner,
  opts: { issuedBy: string; role?: Role; expiresInDays?: number; code?: string },
): Promise<Invite> {
  const role: Role = opts.role ?? "researcher";
  if (!isRole(role)) throw new Error(`unknown role: ${role}`);
  const code = opts.code ?? newInviteCode();
  const expires = opts.expiresInDays
    ? `now() + interval '${Number(opts.expiresInDays)} days'`
    : "NULL";
  const rows = await r.query(
    `INSERT INTO invites (code, issued_by, role, expires_at)
     VALUES ($1, $2, $3, ${expires})
     RETURNING code, role, expires_at, redeemed_by`,
    [code, opts.issuedBy, role],
  );
  return rows[0] as unknown as Invite;
}

export class InviteError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Check a code is real, unused and unexpired. Throws InviteError otherwise. */
export async function validateInvite(r: SqlRunner, code: string): Promise<Invite> {
  const found = (await r.query(
    "SELECT code, role, expires_at, redeemed_by FROM invites WHERE code = $1", [code],
  )) as unknown as Invite[];
  const invite = found[0];
  if (!invite) throw new InviteError("invite not found", 404);
  if (invite.redeemed_by) throw new InviteError("invite already redeemed", 409);
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw new InviteError("invite expired", 410);
  }
  return invite;
}

export async function emailTaken(r: SqlRunner, email: string): Promise<boolean> {
  const rows = await r.query("SELECT 1 FROM users WHERE email = $1", [email.trim().toLowerCase()]);
  return rows.length > 0;
}

/**
 * Finish a redemption for a user Better Auth has just created: grant the invite's role, bind
 * the device, and burn the code. The WHERE guard makes a concurrent double-redeem impossible.
 */
export async function finishRedeem(
  r: SqlRunner,
  opts: { code: string; userId: string; role: Role; localId?: string },
): Promise<void> {
  const burned = await r.query(
    "UPDATE invites SET redeemed_by = $1 WHERE code = $2 AND redeemed_by IS NULL RETURNING code",
    [opts.userId, opts.code],
  );
  if (!burned[0]) throw new InviteError("invite already redeemed", 409);
  await r.query(
    "UPDATE users SET role = $1, local_id = COALESCE($2, local_id), updated_at = now() WHERE id = $3",
    [opts.role, opts.localId ?? null, opts.userId],
  );
}

/** Bind (or re-bind) a signed-in account to a device's local_id — Phase 1 attribution. */
export async function bindLocalId(r: SqlRunner, userId: string, localId: string): Promise<void> {
  await r.query("UPDATE users SET local_id = $1, updated_at = now() WHERE id = $2", [localId, userId]);
}

/** The authorization facts for a user, plus who they are (for the account panel). */
export async function loadPrincipal(
  r: SqlRunner,
  userId: string,
): Promise<{ id: string; role: Role; localId: string | null; email: string; displayName: string } | null> {
  const rows = await r.query(
    "SELECT id, role, local_id, email, display_name FROM users WHERE id = $1", [userId]);
  const u = rows[0] as
    { id: string; role: string; local_id: string | null; email: string; display_name: string | null } | undefined;
  if (!u || !isRole(u.role)) return null;
  return {
    id: u.id, role: u.role, localId: u.local_id,
    email: u.email, displayName: u.display_name ?? "",
  };
}

/** Let a signed-in reader set their own display name. */
export async function setDisplayName(r: SqlRunner, userId: string, name: string): Promise<void> {
  await r.query("UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2",
    [name.trim().slice(0, 120), userId]);
}
