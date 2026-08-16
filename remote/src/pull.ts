// Phase 6 — the outbound half of sync: what a client asks for.
//
// A cursor walk over append-only rows: "give me everything with seq > N". That is the whole
// protocol. It is replayable (ask again and you get the same answer), resumable (a client
// offline for months just catches up), and a full resync is `since=0` — safe precisely because
// everything it returns lands in the client's DERIVED tables, never its own work.
//
// No CRDT, no bidirectional merge: outbound is a submission queue, inbound is a log replay
// (SHARED_RESEARCH.md §9).

import type { SqlRunner } from "./migrate.js";
import { SCHEMA_VERSION } from "./submissions.js";

export interface PullPage {
  /** Feed this back as `since` next time. */
  cursor: number;
  /** True when more rows remain beyond this page. */
  more: boolean;
  schemaVersion: number;
  globalForms: unknown[];
  dissents: unknown[];
  /**
   * EVERY reading on record, not only the established one — the community's indications.
   *
   * A reader holds several indications for a word and switches between them; the group's
   * readings join that same list rather than standing over against it. So the losing claim
   * is as much a part of the pull as the winning one: it is someone's reading, argued and
   * attributed, and the design never treats "not established" as "not worth seeing".
   */
  peerIndications: unknown[];
}

/**
 * Everything established or dissented after `since`, oldest first.
 *
 * The two streams share one cursor: `seq` is a bigserial on each table, so we take the max
 * across what we returned. That can re-deliver a row on the next call if the tables interleave
 * — deliberately. Re-delivering is harmless (the client upserts by primary key) whereas
 * skipping is not, so the cursor errs toward repetition.
 */
export async function pullSince(r: SqlRunner, since: number, limit = 500): Promise<PullPage> {
  const globalForms = await r.query(
    `SELECT g.subject_kind, g.subject_value, g.claim_id, g.version, g.established_at, g.seq,
            cv.payload_json, c.author_id, cv.schema_version
       FROM global_forms g
       JOIN claim_versions cv ON cv.claim_id = g.claim_id AND cv.version = g.version
       JOIN claims c ON c.id = g.claim_id
      WHERE g.seq > $1
      ORDER BY g.seq
      LIMIT $2`, [since, limit]);

  const dissents = await r.query(
    `SELECT id, claim_id, claim_version, author_id, payload_json, created_at, seq
       FROM dissents
      WHERE seq > $1
      ORDER BY seq
      LIMIT $2`, [since, limit]);

  // Every version of every claim. `status` is derived rather than stored: established when the
  // global slot still points at this exact version, superseded once a later version exists,
  // proposed otherwise. Deriving it here means a claim that loses the slot later is corrected
  // on the next pull without needing a rewrite of history upstream.
  const peers = await r.query(
    `SELECT cv.claim_id, cv.version, cv.payload_json, cv.created_at, cv.schema_version, cv.seq,
            c.author_id, c.subject_kind, c.subject_value, c.current_version,
            (g.claim_id IS NOT NULL) AS is_global
       FROM claim_versions cv
       JOIN claims c ON c.id = cv.claim_id
       LEFT JOIN global_forms g
         ON g.claim_id = cv.claim_id AND g.version = cv.version
      WHERE cv.seq > $1
      ORDER BY cv.seq
      LIMIT $2`, [since, limit]);

  const maxSeq = (rows: Record<string, unknown>[]) =>
    rows.reduce((m, row) => Math.max(m, Number(row.seq ?? 0)), 0);

  const cursor = Math.max(since, maxSeq(globalForms), maxSeq(dissents), maxSeq(peers));

  return {
    cursor,
    more: globalForms.length === limit || dissents.length === limit || peers.length === limit,
    schemaVersion: SCHEMA_VERSION,
    globalForms: globalForms.map((g) => ({
      subjectKind: g.subject_kind, subjectValue: g.subject_value,
      claimId: g.claim_id, version: Number(g.version),
      authorId: g.author_id,
      // the reading itself, denormalised so the client can gloss without a second call
      meaning: (g.payload_json as { meaning?: string })?.meaning ?? "",
      payload: g.payload_json,
      establishedAt: new Date(g.established_at as string).toISOString(),
      schemaVersion: Number(g.schema_version ?? SCHEMA_VERSION),
      seq: Number(g.seq),
    })),
    peerIndications: peers.map((p) => {
      const payload = p.payload_json as { meaning?: string; label?: string } | null;
      return {
        claimId: p.claim_id, version: Number(p.version), authorId: p.author_id,
        subjectKind: p.subject_kind, subjectValue: p.subject_value,
        status: p.is_global
          ? "established"
          : Number(p.current_version ?? 0) > Number(p.version) ? "superseded" : "proposed",
        label: payload?.label ?? "",
        meaning: payload?.meaning ?? "",
        payload,
        createdAt: new Date(p.created_at as string).toISOString(),
        schemaVersion: Number(p.schema_version ?? SCHEMA_VERSION),
        seq: Number(p.seq),
      };
    }),
    dissents: dissents.map((d) => ({
      id: d.id, claimId: d.claim_id, claimVersion: Number(d.claim_version),
      authorId: d.author_id, payload: d.payload_json,
      createdAt: new Date(d.created_at as string).toISOString(),
      seq: Number(d.seq),
    })),
  };
}
