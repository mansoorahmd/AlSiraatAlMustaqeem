// Personal API tokens — how a headless client (the MCP) acts as its user. See 0008_api_tokens.sql.
//
// A token is `mqrg_` + 32 random bytes (base64url). It is returned ONCE, at creation; only its
// SHA-256 is stored, so a leaked database doesn't leak working tokens. A request bearing it gets
// exactly its owner's role and plan (session.ts). Revoked tokens stop working at once.

import { createHash, randomBytes } from "node:crypto";
import type { SqlRunner } from "./migrate.js";

export const TOKEN_PREFIX = "mqrg_";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface TokenInfo {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const info = (r: Record<string, unknown>): TokenInfo => ({
  id: String(r.id), label: String(r.label ?? ""), prefix: String(r.prefix),
  createdAt: iso(r.created_at)!, lastUsedAt: iso(r.last_used_at), revokedAt: iso(r.revoked_at),
});

/** Mint a token for a user. The plaintext is in the result and nowhere else — show it once. */
export async function createToken(
  r: SqlRunner, userId: string, label: string,
): Promise<{ token: string } & TokenInfo> {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const id = `tok_${randomBytes(9).toString("base64url")}`;
  const row = (await r.query(
    `INSERT INTO api_tokens (id, user_id, label, token_hash, prefix)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, label, prefix, created_at, last_used_at, revoked_at`,
    [id, userId, label.trim().slice(0, 80), hash(token), token.slice(0, TOKEN_PREFIX.length + 6)],
  ))[0]!;
  return { token, ...info(row) };
}

/** A user's own tokens, newest first — never the secret. */
export async function listTokens(r: SqlRunner, userId: string): Promise<TokenInfo[]> {
  return (await r.query(
    `SELECT id, label, prefix, created_at, last_used_at, revoked_at
       FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`, [userId])).map(info);
}

/** Revoke one of a user's OWN tokens. False when it isn't theirs (or doesn't exist). */
export async function revokeToken(r: SqlRunner, userId: string, id: string): Promise<boolean> {
  const done = await r.query(
    `UPDATE api_tokens SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`, [id, userId]);
  return done.length > 0;
}

/** Whose token is this? null for anything unknown, malformed or revoked. Notes the use,
 *  at most once a minute per token, so a chatty client doesn't turn reads into writes. */
export async function userForToken(r: SqlRunner, token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < TOKEN_PREFIX.length + 20) return null;
  const row = (await r.query(
    `SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hash(token)]))[0];
  if (!row) return null;
  const last = row.last_used_at ? new Date(row.last_used_at as string).getTime() : 0;
  if (Date.now() - last > 60_000) {
    await r.query("UPDATE api_tokens SET last_used_at = now() WHERE id = $1", [row.id]);
  }
  return String(row.user_id);
}
