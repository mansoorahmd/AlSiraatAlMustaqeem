// Remove EVERY demo person and their work.
//
//   npm run remote:demo:clean
//
// Each `remote:demo:keep` run seeds fresh fake people (Amina, Bilal, moderators) tagged with a
// timestamp, all under @demo.invalid. Run the demo a few times and the community list fills with
// duplicate readings from different fake authors — which is correct behaviour (different authors
// are different claims) but is noise. This wipes all of them in one go. It touches nothing whose
// email isn't @demo.invalid, so real accounts and real research are never at risk.

import { pool, pgRunner as r } from "./db.js";

const LIKE = "%@demo.invalid";

try {
  const rows = await r.query(
    "SELECT COUNT(*)::int AS n FROM users WHERE email LIKE $1", [LIKE]) as { n: number }[];
  const n = rows[0]?.n ?? 0;
  if (!n) {
    console.log("\nNo demo accounts found — nothing to clean.\n");
  } else {
    // children first, then the people — FKs point at users(id)
    await r.query("DELETE FROM dissents WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1)", [LIKE]);
    await r.query("DELETE FROM reviews WHERE moderator_id IN (SELECT id FROM users WHERE email LIKE $1)", [LIKE]);
    await r.query(`DELETE FROM global_forms WHERE claim_id IN
      (SELECT id FROM claims WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1))`, [LIKE]);
    await r.query(`DELETE FROM claim_versions WHERE claim_id IN
      (SELECT id FROM claims WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1))`, [LIKE]);
    await r.query("DELETE FROM claims WHERE author_id IN (SELECT id FROM users WHERE email LIKE $1)", [LIKE]);
    await r.query("DELETE FROM users WHERE email LIKE $1", [LIKE]);
    console.log(`\nRemoved ${n} demo account${n === 1 ? "" : "s"} and everything they authored.`);
    console.log("In the app, open ⚖ Where I stand apart → Sync, or Reset, to drop what you pulled.\n");
  }
} catch (e) {
  console.error(`\ndemo:clean: ${(e as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
