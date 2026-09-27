// Smoke of cloud research through the REAL remote app on real Postgres, with throwaway accounts
// (created and removed here; their research goes with them): a note round-trips, the other account
// can't see it (row-level security), and a token request gets the AI boundary.
// Run: npx tsx remote/scripts/research-smoke.ts
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { pool, corpusPool, researchPool, pgRunner } from "../src/db.js";
import { createToken } from "../src/api-tokens.js";

const app = createApp();
const made: string[] = [];
async function throwaway(tag: string) {
  const email = `research-smoke-${tag}-${randomBytes(3).toString("hex")}@example.test`;
  const [u] = await pgRunner.query("INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id", [email, tag]);
  made.push(String(u!.id));
  const t = await createToken(pgRunner, String(u!.id), "smoke");
  return { id: String(u!.id), auth: { authorization: `Bearer ${t.token}` } };
}
const json = (headers: Record<string, string>, method: string, body?: unknown) =>
  ({ method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

try {
  const a = await throwaway("a"), b = await throwaway("b");
  // tokens act as the AI: its note is stored as a proposal
  const put = await app.request("/research/notes/n1", json(a.auth, "PUT", { id: "n1", verseKey: "2:2", text: "hello" }));
  console.log(`first write                     → ${put.status}`);
  const stored = await pgRunner.query("SELECT user_id FROM research.notes WHERE id = 'n1' AND user_id = $1", [a.id]);
  console.log(`stored under A's user_id        → ${stored.length ? "yes" : "NO"}`);
  const mine = await (await app.request("/research/notes", { headers: a.auth })).json() as { id: string; source: string }[];
  console.log(`A reads its notes              → ${mine.map((n) => `${n.id}(${n.source})`).join(", ")}`);
  const theirs = await (await app.request("/research/notes", { headers: b.auth })).json() as unknown[];
  console.log(`B reads its notes              → ${theirs.length} (A's are not visible)`);
  console.log(`A's token deletes a note       → ${(await app.request("/research/notes/n1", { method: "DELETE", headers: a.auth })).status} (the AI may not)`);
  console.log(`signed out                      → ${(await app.request("/research/notes")).status}`);
} finally {
  for (const id of made) {
    await pgRunner.query("DELETE FROM users WHERE id = $1", [id]);
  }
  console.log(`removed ${made.length} throwaway account(s) and their research`);
  await pool.end(); await corpusPool.end(); await researchPool.end();
}
