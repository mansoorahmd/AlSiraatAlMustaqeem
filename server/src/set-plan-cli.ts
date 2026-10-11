// Grant or revoke a user's plan tier directly against the database — a maintainer act, done out
// of band like `bootstrap` / `set-password`, and the manual stand-in for billing until it is wired.
//
//   npm run set-plan -w @alsiraat/server -- me@example.org pro          # grant, no expiry
//   npm run set-plan -w @alsiraat/server -- me@example.org scholar 30   # grant for 30 days
//   npm run set-plan -w @alsiraat/server -- me@example.org free         # revoke
//
// The tier must exist in the ladder (see `npm run access -- tiers`). `role` (what you may do) is
// set by invites; `plan` (what you paid for) is set here. They are independent — see plans.ts.

import { pool, pgRunner as r } from "./db.js";
import { setPlan, userIdByEmail } from "./invites.js";
import { FREE } from "./plans.js";

const [email, plan, daysArg] = process.argv.slice(2);

try {
  if (!email?.includes("@") || !plan) throw new Error("usage: set-plan <email> <tier> [days]");
  const expiresInDays = daysArg == null ? null : Number(daysArg);
  if (expiresInDays != null && (!Number.isFinite(expiresInDays) || expiresInDays <= 0)) {
    throw new Error(`days must be a positive number (got: ${daysArg})`);
  }

  const userId = await userIdByEmail(r, email);
  if (!userId) throw new Error(`no account for ${email} — invite them, or run bootstrap first`);

  await setPlan(r, { userId, plan, expiresInDays });   // validates the tier against the ladder
  const when = plan === FREE
    ? "(revoked)"
    : expiresInDays == null ? "(no expiry)" : `(expires in ${expiresInDays} days)`;
  console.log(`✔ plan for ${email.trim().toLowerCase()} → ${plan} ${when}`);
} catch (e) {
  console.error(`set-plan: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
