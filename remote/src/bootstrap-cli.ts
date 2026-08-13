// Chicken-and-egg: issuing invites needs a maintainer, and the first maintainer can't be
// invited. This creates (or promotes) one directly against the database — a deliberate
// out-of-band admin act, not an HTTP route.
//
//   npm run bootstrap -w @alsiraat/remote -- me@example.org "My Name"

import { pool, pgRunner } from "./db.js";

const [email, displayName] = process.argv.slice(2);

try {
  if (!email?.includes("@")) throw new Error("usage: bootstrap <email> [display name]");
  const rows = await pgRunner.query(
    `INSERT INTO users (email, display_name, role) VALUES ($1, $2, 'maintainer')
     ON CONFLICT (email) DO UPDATE SET role = 'maintainer', updated_at = now()
     RETURNING id, email, role`,
    [email.trim().toLowerCase(), displayName ?? ""],
  );
  const u = rows[0] as { id: string; email: string; role: string };
  console.log(`✔ ${u.email} is now ${u.role}  (id ${u.id})`);
  console.log("  Sign in with a magic link, then issue invites via POST /invites.");
} catch (e) {
  console.error(`bootstrap: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
