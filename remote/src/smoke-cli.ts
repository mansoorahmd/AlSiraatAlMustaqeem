// Functional smoke test against a REAL Postgres, through the real node-postgres driver.
// The unit tests run on PGlite (WASM Postgres) via a shim, so this closes the gap: server
// version, gen_random_uuid(), CHECK + FK enforcement, the invite flow, and the Better Auth
// tables. Writes only to a temporary email/code and cleans up after itself.
//
//   npm run smoke -w @alsiraat/remote

import { pool, pgRunner as r } from "./db.js";
import { createInvite, validateInvite, finishRedeem, bindLocalId, loadPrincipal } from "./invites.js";

let pass = 0;
const fails: string[] = [];
const ok = (name: string, extra = "") => { pass++; console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ""}`); };
const bad = (name: string, e: unknown) => {
  fails.push(name);
  console.log(`  ✖ ${name} — ${(e as Error).message}`);
};
async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try { ok(name, (await fn()) || ""); } catch (e) { bad(name, e); }
}
/** Expect fn to be REJECTED (the constraint is doing its job). */
async function rejects(name: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); bad(name, new Error("expected this to be rejected, but it succeeded")); }
  catch { ok(name); }
}

const TAG = `smoke-${Date.now()}`;
const EMAIL = `${TAG}@smoke.invalid`;

console.log("\nMQRG remote — smoke test against the configured Postgres\n");

try {
  await check("connects, and the server version supports what we use", async () => {
    const [v] = await r.query("SELECT version() AS v, current_database() AS db");
    const version = String((v as { v: string }).v).split(" ").slice(0, 2).join(" ");
    const major = Number(version.replace(/[^0-9.]/g, "").split(".")[0] ?? 0);
    if (major && major < 13) {
      throw new Error(`${version}: gen_random_uuid() needs Postgres 13+, or CREATE EXTENSION pgcrypto`);
    }
    return `${version}, db=${(v as { db: string }).db}`;
  });

  await check("all migrations are applied", async () => {
    const rows = await r.query("SELECT name FROM _migrations ORDER BY name");
    const names = rows.map((x) => x.name as string);
    for (const need of ["0001_init.sql", "0002_auth.sql"]) {
      if (!names.includes(need)) throw new Error(`${need} is missing — run: npm run remote:migrate`);
    }
    return names.join(", ");
  });

  await check("Better Auth tables exist (0002)", async () => {
    const rows = await r.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name IN ('session','account','verification')`,
    );
    if (rows.length !== 3) throw new Error(`expected 3, found ${rows.length}`);
    return "session, account, verification";
  });

  // gen_random_uuid() is a DEFAULT — only exercised by an actual INSERT
  await check("gen_random_uuid() mints the users id", async () => {
    const [u] = await r.query("INSERT INTO users (email) VALUES ($1) RETURNING id, role", [`probe-${EMAIL}`]);
    const { id, role } = u as { id: string; role: string };
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`not a uuid: ${id}`);
    if (role !== "reader") throw new Error(`role default should be reader, got ${role}`);
    return `${id} (role defaults to ${role})`;
  });

  await rejects("role CHECK rejects an invalid role", () =>
    r.query("INSERT INTO users (email, role) VALUES ($1,'wizard')", [`bad-${EMAIL}`]));

  await rejects("FK rejects a dissent on a non-existent claim version", () =>
    r.query(
      `INSERT INTO dissents (id, claim_id, claim_version, author_id, payload_json)
       VALUES ($1,'clm_nope',1,gen_random_uuid(),'{}'::jsonb)`, [`dsn-${TAG}`],
    ));

  // the real flow, through node-postgres: issue → redeem → bind → read back
  let userId = "";
  await check("invite flow: issue → redeem → role comes from the invite", async () => {
    const [boss] = await r.query(
      "INSERT INTO users (email, role) VALUES ($1,'maintainer') RETURNING id", [`boss-${EMAIL}`]);
    const invite = await createInvite(r, {
      issuedBy: (boss as { id: string }).id, role: "moderator", expiresInDays: 7,
    });
    // the HTTP route has Better Auth create the account (it owns password hashing); here we
    // insert directly, so this exercises the DB rules and the pg driver rather than auth
    const inv = await validateInvite(r, invite.code);
    const [u] = await r.query("INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id",
      [EMAIL, "Smoke"]) as { id: string }[];
    userId = u!.id;
    await finishRedeem(r, { code: invite.code, userId, role: inv.role });
    const role = (await loadPrincipal(r, userId))!.role;
    if (role !== "moderator") throw new Error(`expected moderator, got ${role}`);
    return `code ${invite.code.slice(0, 8)}… → ${EMAIL} as ${role}`;
  });

  await check("local_id binds and reads back", async () => {
    const local = "11111111-2222-3333-4444-555555555555";
    await bindLocalId(r, userId, local);
    const p = await loadPrincipal(r, userId);
    if (p?.localId !== local) throw new Error(`got ${p?.localId}`);
    return local;
  });

  await check("cleans up after itself", async () => {
    await r.query("DELETE FROM invites WHERE issued_by IN (SELECT id FROM users WHERE email LIKE $1)", [`%${TAG}%`]);
    const gone = await r.query("DELETE FROM users WHERE email LIKE $1 RETURNING id", [`%${TAG}%`]);
    return `${gone.length} temporary rows removed`;
  });
} finally {
  await pool.end();
}

console.log(`\n${fails.length ? "✖" : "✔"} ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log(`  failed: ${fails.join(", ")}`); process.exitCode = 1; }
