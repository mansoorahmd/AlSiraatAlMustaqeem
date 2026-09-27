// End-to-end smoke of the forgotten-password flow through the REAL remote app, on a throwaway
// account that is deleted afterwards: request a reset (console transport — the email is captured
// from the log), follow the link, set a new password, sign in with it; the old one no longer works.
// Run: npx tsx remote/scripts/reset-smoke.ts
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool, corpusPool, pgRunner } from "../src/db.js";
import { createInvite } from "../src/invites.js";

const app = createApp();
const EMAIL = `reset-smoke-${randomBytes(4).toString("hex")}@example.test`;
const ORIGIN = config.trustedOrigins[0]!;          // where the app would call from
const json = (body: unknown, origin = ORIGIN) =>
  ({ method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

// capture the "email" the console transport prints
let mailed = "";
const log = console.log;
console.log = (...a: unknown[]) => { mailed += a.join(" ") + "\n"; };

const say = (s: string) => log(s);
let code = "";
try {
  const boss = (await pgRunner.query("SELECT id FROM users WHERE role = 'maintainer' LIMIT 1"))[0];
  if (!boss) throw new Error("no maintainer to issue the invite");
  ({ code } = await createInvite(pgRunner, { issuedBy: String(boss.id), role: "reader", expiresInDays: 1 }));
  const oldPw = randomBytes(9).toString("base64url"), newPw = randomBytes(9).toString("base64url");
  const redeem = await app.request("/invites/redeem", json({ code, email: EMAIL, password: oldPw }));
  say(`account created                 → ${redeem.status}`);

  const req = await app.request("/api/auth/request-password-reset",
    json({ email: EMAIL, redirectTo: `${config.baseUrl}/reset-password` }));
  say(`request a reset                 → ${req.status}`);
  const unknown = await app.request("/api/auth/request-password-reset",
    json({ email: "nobody-here@example.test", redirectTo: `${config.baseUrl}/reset-password` }));
  say(`…for an address with no account → ${unknown.status} (same answer — reveals nothing)`);

  const link = mailed.match(/https?:\/\/\S+\/api\/auth\/reset-password\/\S+/)?.[0];
  say(`reset email captured            → ${link ? "yes" : "NO"}`);
  if (!link) throw new Error("no reset link in the email");

  const hop = await app.request(new URL(link).pathname + new URL(link).search);
  const landing = hop.headers.get("location") ?? "";
  say(`follow the link                 → ${hop.status} → ${landing.replace(/token=[^&]+/, "token=…")}`);
  const token = new URL(landing, config.baseUrl).searchParams.get("token");
  if (!token) throw new Error("no token on the landing page");
  const page = await app.request(new URL(landing, config.baseUrl).pathname);
  say(`the reset page                  → ${page.status} (${page.headers.get("referrer-policy")})`);

  const set = await app.request("/api/auth/reset-password", json({ newPassword: newPw, token }, config.baseUrl));
  say(`set the new password            → ${set.status}`);
  const again = await app.request("/api/auth/reset-password", json({ newPassword: newPw, token }, config.baseUrl));
  say(`reuse the same link             → ${again.status} (one-time)`);

  const signNew = await app.request("/api/auth/sign-in/email", json({ email: EMAIL, password: newPw }));
  const signOld = await app.request("/api/auth/sign-in/email", json({ email: EMAIL, password: oldPw }));
  say(`sign in with the new password   → ${signNew.status}`);
  say(`sign in with the old password   → ${signOld.status}`);
} finally {
  console.log = log;
  const u = (await pgRunner.query("SELECT id FROM users WHERE email = $1", [EMAIL]))[0];
  if (u) {
    await pgRunner.query("DELETE FROM invites WHERE redeemed_by = $1", [u.id]);
    await pgRunner.query("DELETE FROM users WHERE id = $1", [u.id]);
  }
  if (code) await pgRunner.query("DELETE FROM invites WHERE code = $1", [code]);   // only our own
  await pool.end(); await corpusPool.end();
  log("throwaway account removed");
}
