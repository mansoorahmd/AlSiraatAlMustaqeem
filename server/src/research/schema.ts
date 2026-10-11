// Every account's research lives in ONE schema, `research`, kept apart by row-level security
// (migrations/0010_research_rls.sql): each row carries its user_id, and every table's one policy
// shows — and lets you write — only the request's user's rows.
//
// bindResearchUser() is what makes a request that user's: inside the request's transaction it
//   • drops to mqrg_research — a role that is not a superuser and cannot bypass RLS
//     (a superuser bypasses every policy; the server's own login usually is one)
//   • sets app.user_id to the account's id, as a bound parameter — the policies compare to it
//   • sets search_path to `research`, so the store's unqualified table names resolve
// All three are LOCAL: they end with the transaction, so a pooled connection can't carry them into
// someone else's request. The user id comes from the authenticated principal only.

/** One connection, inside the request's transaction. */
export interface ResearchConn {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

export const RESEARCH_ROLE = "mqrg_research";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Make this transaction the given account's view of the research. */
export async function bindResearchUser(conn: ResearchConn, userId: string): Promise<void> {
  if (!UUID.test(userId)) throw new Error("not an account id");
  await conn.query(`SET LOCAL ROLE ${RESEARCH_ROLE}`);
  await conn.query("SELECT set_config('app.user_id', $1, true)", [userId.toLowerCase()]);
  await conn.query("SET LOCAL search_path TO research");
}
