// Smoke of the Admin screen's endpoints through the REAL remote app — reads only, nothing
// changed: as the first maintainer (via a temporary API token) and as nobody.
// Run: npx tsx remote/scripts/admin-smoke.ts
import { createApp } from "../src/app.js";
import { pool, corpusPool, pgRunner } from "../src/db.js";
import { createToken } from "../src/api-tokens.js";

const app = createApp();
const boss = (await pgRunner.query(
  "SELECT id, email FROM users WHERE role = 'maintainer' ORDER BY created_at LIMIT 1"))[0];
if (!boss) { console.log("no maintainer in this database — nothing to smoke-test"); process.exit(0); }

const t = await createToken(pgRunner, String(boss.id), "admin smoke");
const as = { headers: { authorization: `Bearer ${t.token}` } };
try {
  const users = await app.request("/admin/users", as);
  console.log(`GET /admin/users (maintainer) → ${users.status}  ${(await users.json() as unknown[]).length} user(s)`);
  const res = await app.request("/admin/resources", as);
  const body = await res.json() as { translations: unknown[]; lexicons: unknown[] };
  console.log(`GET /admin/resources          → ${res.status}  ${body.translations.length} translations, ${body.lexicons.length} dictionaries`);
  console.log(`GET /admin/users (nobody)     → ${(await app.request("/admin/users")).status}`);
  const bad = await app.request("/admin/users/not-a-user/role", { ...as, method: "PUT", body: JSON.stringify({ role: "reader" }) });
  console.log(`PUT role on a bad id          → ${bad.status}`);
} finally {
  await pgRunner.query("DELETE FROM api_tokens WHERE id = $1", [t.id]);
  await pool.end(); await corpusPool.end();
}
