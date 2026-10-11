// Smoke of roles + audiences through the REAL remote app on real Postgres, with throwaway
// accounts (created and removed here): a researcher publishes a reading for "scholars on Pro",
// it is established, and two readers on Pro — a scholar and a plain reader — ask for it.
// Run: npx tsx server/scripts/audience-smoke.ts
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { pool, corpusPool, researchPool, pgRunner } from "../src/db.js";
import { createToken } from "../src/api-tokens.js";
import { establish } from "../src/claims.js";

const app = createApp();
const made: string[] = [];
const tag = randomBytes(3).toString("hex");
async function account(name: string, role: string, plan: string) {
  const [u] = await pgRunner.query(
    "INSERT INTO users (email, display_name, role, plan) VALUES ($1, $2, $3, $4) RETURNING id",
    [`audience-smoke-${name}-${tag}@example.test`, name, role, plan]);
  made.push(String(u!.id));
  const t = await createToken(pgRunner, String(u!.id), "smoke");
  return { id: String(u!.id), headers: { authorization: `Bearer ${t.token}`, "content-type": "application/json" } };
}
const subject = `smoke-${tag}`;

try {
  const author = await account("author", "researcher", "pro");
  const student = await account("student", "student", "pro");
  const scholar = await account("scholar", "scholar", "pro");
  const reader = await account("reader", "reader", "pro");

  const me = await (await app.request("/me", { headers: student.headers })).json() as Record<string, unknown>;
  console.log(`student /me                     → canPublish ${me.canPublish} (publishing needs ${me.publishRole})`);
  const denied = await app.request("/claims", { method: "POST", headers: student.headers,
    body: JSON.stringify({ subjectKind: "root", subjectValue: subject, payload: { meaning: "x", argument: "y" } }) });
  console.log(`student proposes                → ${denied.status} ${((await denied.json()) as { detail: string }).detail}`);

  const res = await app.request("/claims", { method: "POST", headers: author.headers, body: JSON.stringify({
    subjectKind: "root", subjectValue: subject, audience: { minRole: "scholar", minPlan: "pro" },
    payload: { meaning: "a reading for scholars", argument: "the usage in 2:2" } }) });
  const claim = await res.json() as { claimId: string; version: number; audience: unknown };
  console.log(`researcher proposes for scholars→ ${res.status} audience ${JSON.stringify(claim.audience)}`);
  await establish(pgRunner, claim.claimId, claim.version);

  const readings = async (who: { headers: Record<string, string> }) =>
    ((await (await app.request(`/community/readings?root=${subject}`, { headers: who.headers })).json()) as { communityRoot: unknown[] }).communityRoot.length;
  console.log(`scholar on pro reads it         → ${await readings(scholar)} reading(s)`);
  console.log(`reader on pro reads it          → ${await readings(reader)} reading(s) (below the audience)`);
  console.log(`the author reads it             → ${await readings(author)} reading(s)`);
} finally {
  for (const id of made) {
    await pgRunner.query("DELETE FROM reviews WHERE moderator_id = $1", [id]);
    await pgRunner.query(`DELETE FROM global_forms WHERE claim_id IN (SELECT id FROM claims WHERE author_id = $1)`, [id]);
    await pgRunner.query(`DELETE FROM claim_versions WHERE claim_id IN (SELECT id FROM claims WHERE author_id = $1)`, [id]);
    await pgRunner.query("DELETE FROM claims WHERE author_id = $1", [id]);
    await pgRunner.query("DELETE FROM users WHERE id = $1", [id]);
  }
  console.log(`removed ${made.length} throwaway account(s) and what they published`);
  await pool.end(); await corpusPool.end(); await researchPool.end();
}
