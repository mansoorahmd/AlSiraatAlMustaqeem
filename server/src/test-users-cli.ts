// Create (or reset) the test logins listed in a CSV — one account per role, for trying the app
// as each kind of user. Out of band like `bootstrap`: straight against the database, no invites.
//
//   npm run test-users -w @alsiraat/server -- ../test-users.csv
//   docker compose run --rm -T server test-users < ../test-users.csv     # on the VPS
//
// Columns: username,email,password,role,plan. Re-running is safe — each account's role, plan,
// display name and password are brought back to what the file says. The file holds passwords,
// so it is gitignored; keep it out of the repo.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool, pgRunner as r } from "./db.js";
import { auth } from "./auth.js";
import { setPlan } from "./invites.js";
import { roleExists } from "./role-ladder.js";

const COLUMNS = ["username", "email", "password", "role", "plan"] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

function parse(text: string): Row[] {
  const [header, ...lines] = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cols = header?.split(",").map((c) => c.trim());
  if (cols?.join(",") !== COLUMNS.join(",")) throw new Error(`the first line must be: ${COLUMNS.join(",")}`);
  return lines.map((line, i) => {
    const v = line.split(",").map((c) => c.trim());
    const row = Object.fromEntries(COLUMNS.map((c, j) => [c, v[j] ?? ""])) as Row;
    if (!row.email.includes("@")) throw new Error(`line ${i + 2}: bad email ${row.email}`);
    if (row.password.length < 10) throw new Error(`line ${i + 2}: password must be at least 10 characters`);
    return { ...row, email: row.email.toLowerCase(), plan: row.plan || "free" };
  });
}

const file = process.argv[2];

try {
  if (!file && process.stdin.isTTY) throw new Error("usage: test-users <file.csv>   (or pipe the CSV in)");
  const rows = parse(readFileSync(file ?? 0, "utf8"));
  for (const u of rows) {
    if (!(await roleExists(r, u.role))) throw new Error(`${u.email}: unknown role ${u.role}`);
  }

  const ctx = await auth.$context;
  for (const u of rows) {
    const [user] = (await r.query(
      `INSERT INTO users (email, display_name, role, email_verified) VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, updated_at = now()
       RETURNING id`,
      [u.email, u.username, u.role],
    )) as [{ id: string }];
    // hash with Better Auth's own hasher so its sign-in accepts it (as set-password does)
    const hash = await ctx.password.hash(u.password);
    const updated = await r.query(
      `UPDATE account SET password = $1, updated_at = now()
        WHERE user_id = $2 AND provider_id = 'credential' RETURNING id`, [hash, user.id]);
    if (!updated.length) {
      await r.query(
        `INSERT INTO account (id, user_id, account_id, provider_id, password)
         VALUES ($1, $2, $3, 'credential', $4)`, [randomUUID(), user.id, user.id, hash]);
    }
    await setPlan(r, { userId: user.id, plan: u.plan });
    console.log(`✔ ${u.email.padEnd(28)} ${u.role.padEnd(11)} ${u.plan}`);
  }
  console.log(`${rows.length} test logins ready — sign in with the email and password from the file.`);
} catch (e) {
  console.error(`test-users: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
