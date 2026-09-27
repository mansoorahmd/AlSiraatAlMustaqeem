// A throwaway maintainer for checking the Admin screen in a browser, made through the app's own
// invite flow — and removed again. Credentials are written to a file you name, never printed.
//   npx tsx remote/scripts/ui-test-account.ts create <credentials-file>
//   npx tsx remote/scripts/ui-test-account.ts remove
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { pool, corpusPool, pgRunner } from "../src/db.js";
import { createInvite } from "../src/invites.js";

const EMAIL = "ui-test-maintainer@example.test";
const [cmd, out] = process.argv.slice(2);
try {
  if (cmd === "create") {
    if (!out) throw new Error("name a credentials file");
    const app = createApp();
    const boss = (await pgRunner.query(
      "SELECT id FROM users WHERE role = 'maintainer' ORDER BY created_at LIMIT 1"))[0];
    if (!boss) throw new Error("no maintainer to issue the invite");
    const { code } = await createInvite(pgRunner, { issuedBy: String(boss.id), role: "maintainer", expiresInDays: 1 });
    const password = randomBytes(12).toString("base64url");
    const res = await app.request("/invites/redeem", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, email: EMAIL, password, displayName: "UI test" }),
    });
    if (!res.ok) throw new Error(`redeem → ${res.status} ${await res.text()}`);
    writeFileSync(out, JSON.stringify({ email: EMAIL, password }));
    console.log(`created ${EMAIL} (maintainer); credentials in ${out}`);
  } else if (cmd === "remove") {
    // what the account touched without ON DELETE CASCADE: the invite it redeemed, its cursors,
    // and any access rule it set (kept, just unattributed)
    const u = (await pgRunner.query("SELECT id FROM users WHERE email = $1", [EMAIL]))[0];
    if (u) {
      await pgRunner.query("DELETE FROM invites WHERE redeemed_by = $1 OR issued_by = $1", [u.id]);
      await pgRunner.query("DELETE FROM sync_cursors WHERE user_id = $1", [u.id]);
      await pgRunner.query("UPDATE resource_access SET updated_by = NULL WHERE updated_by = $1", [u.id]);
      await pgRunner.query("DELETE FROM users WHERE id = $1", [u.id]);   // its research goes with it (ON DELETE CASCADE)
    }
    console.log(`removed ${u ? 1 : 0} account(s)`);
  } else {
    console.log("usage: create <file> | remove");
  }
} finally {
  await pool.end(); await corpusPool.end();
}
