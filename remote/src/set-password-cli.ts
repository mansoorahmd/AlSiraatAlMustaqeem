// Set (or reset) a user's password directly against the database — a maintainer act, done
// out of band like `bootstrap`, not over HTTP.
//
//   npm run set-password -w @alsiraat/remote -- me@example.org "a good long password"
//
// Two cases need this:
//   • an account created by `bootstrap` has no password at all, so nobody can sign in as it
//   • someone forgot theirs, and no email transport is configured to send a reset link
//
// Better Auth stores password hashes in the `account` table under providerId 'credential',
// so we hash with ITS hasher (scrypt, via auth.$context) and upsert that row — never writing
// a hash of our own devising.

import { randomUUID } from "node:crypto";
import { pool, pgRunner as r } from "./db.js";
import { auth } from "./auth.js";

const [email, password] = process.argv.slice(2);

try {
  if (!email?.includes("@")) throw new Error('usage: set-password <email> "<password>"');
  if (!password || password.length < 10) throw new Error("password must be at least 10 characters");

  const users = await r.query("SELECT id, email FROM users WHERE email = $1", [
    email.trim().toLowerCase(),
  ]);
  const user = users[0] as { id: string; email: string } | undefined;
  if (!user) throw new Error(`no account for ${email} — invite them, or run bootstrap first`);

  // hash exactly as Better Auth would, so its sign-in verification accepts it
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);

  const existing = await r.query(
    "SELECT id FROM account WHERE user_id = $1 AND provider_id = 'credential'", [user.id]);

  if (existing[0]) {
    await r.query("UPDATE account SET password = $1, updated_at = now() WHERE id = $2",
      [hash, (existing[0] as { id: string }).id]);
    console.log(`✔ password updated for ${user.email}`);
  } else {
    await r.query(
      `INSERT INTO account (id, user_id, account_id, provider_id, password)
       VALUES ($1, $2, $3, 'credential', $4)`,
      [randomUUID(), user.id, user.id, hash],
    );
    console.log(`✔ password set for ${user.email} (first credential for this account)`);
  }
  console.log("  Sign in with this email and password in the app.");
} catch (e) {
  console.error(`set-password: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
