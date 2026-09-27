// Every account's research lives in ONE schema, `research`, kept apart by row-level security
// (migrations/0010_research_rls.sql): each row carries its user_id, and every table's one policy
// shows — and lets you write — only the request's user's rows.
//
// bindResearchUser() is what makes a request that user's: inside the request's transaction it
//   • drops to mqrg_research — a role that is not a superuser and cannot bypass RLS
//     (a superuser bypasses every policy; the server's own login usually is one)
//   • sets app.user_id to the account's id, as a bound parameter — the policies compare to it
//   • sets search_path to `research`, so the shared research code's unqualified names resolve
// All three are LOCAL: they end with the transaction, so a pooled connection can't carry them into
// someone else's request. The user id comes from the authenticated principal only.

import { ownerIdFor, normalizeEmail } from "../../../server/src/identity.js";

/** One connection, inside the request's transaction. */
export interface ResearchConn {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

export const RESEARCH_ROLE = "mqrg_research";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const owners = new Set<string>();   // accounts whose owner record is known to exist, per process

/**
 * Make this transaction the given account's view of the research, creating its owner record on
 * first use (the research code reads it for the account's identity).
 */
export async function bindResearchUser(
  conn: ResearchConn, userId: string, profile: () => Promise<{ email: string; name: string }>,
): Promise<void> {
  if (!UUID.test(userId)) throw new Error("not an account id");
  await conn.query(`SET LOCAL ROLE ${RESEARCH_ROLE}`);
  await conn.query("SELECT set_config('app.user_id', $1, true)", [userId.toLowerCase()]);
  await conn.query("SET LOCAL search_path TO research");
  if (owners.has(userId)) return;
  const have = (await conn.query("SELECT 1 FROM owner WHERE id = 1")).rows.length > 0;
  if (!have) {
    const who = await profile();
    const email = normalizeEmail(who.email), t = Date.now();
    // the same uuid a research.db of this person carries, so imported work stays theirs
    await conn.query(
      `INSERT INTO owner (id, name, email, uuid, claimed_at, updated_at) VALUES (1, $1, $2, $3, $4, $4)
       ON CONFLICT (user_id, id) DO NOTHING`, [who.name ?? "", email, ownerIdFor(email), t]);
  }
}

/** Called once the transaction that checked/created the owner record has committed. */
export const markOwnerKnown = (userId: string) => { owners.add(userId); };
/** Tests start each case from scratch. */
export const forgetOwners = () => owners.clear();
