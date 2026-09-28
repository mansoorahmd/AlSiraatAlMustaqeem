// End-to-end smoke of API-token auth through the REAL remote app: mint a token for an existing
// account, call as it, revoke it, confirm it no longer works — then delete it.
// Run: npx tsx server/scripts/token-smoke.ts
import { createApp } from "../src/app.js";
import { pool, corpusPool, pgRunner } from "../src/db.js";
import { createToken, revokeToken } from "../src/api-tokens.js";

const app = createApp();
const who = (await pgRunner.query("SELECT id, email, role, plan FROM users ORDER BY created_at LIMIT 1"))[0];
if (!who) { console.log("no accounts in this database — nothing to smoke-test"); process.exit(0); }

const t = await createToken(pgRunner, String(who.id), "smoke test");
const as = (token?: string) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
try {
  const me = await app.request("/me", as(t.token));
  const body = await me.json() as { email: string; role: string; plan: string };
  console.log(`with the token        → ${me.status}  ${body.email} · ${body.role} · ${body.plan}`);
  console.log(`without it            → ${(await app.request("/me")).status}`);
  console.log(`with a made-up one    → ${(await app.request("/me", as("mqrg_" + "x".repeat(43)))).status}`);
  const corpus = await app.request("/corpus/chapters/1", as(t.token));
  console.log(`corpus, as this user  → ${corpus.status} (their plan vs the corpus rule)`);
  await revokeToken(pgRunner, String(who.id), t.id);
  console.log(`after revoking        → ${(await app.request("/me", as(t.token))).status}`);
} finally {
  await pgRunner.query("DELETE FROM api_tokens WHERE id = $1", [t.id]);
  await pool.end(); await corpusPool.end();
}
