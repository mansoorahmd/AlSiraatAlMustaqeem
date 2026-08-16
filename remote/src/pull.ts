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

/** The streams a client walks. Each has its OWN sequence and so its own cursor. */
export const STREAMS = ["globalForms", "dissents", "peerIndications"] as const;
export type Stream = (typeof STREAMS)[number];
export type Cursors = Record<Stream, number>;

export const ZERO_CURSORS: Cursors = { globalForms: 0, dissents: 0, peerIndications: 0 };

export interface PullPage {
  /** Feed these back as `since` next time — one position per stream. */
  cursors: Cursors;
  /** True when more rows remain beyond this page, in any stream. */
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
 * Everything new in each stream, oldest first.
 *
 * ONE CURSOR PER STREAM — this matters, and an earlier version of this file got it wrong.
 * `seq` is a `bigserial` on each table, which means each table has its own INDEPENDENT
 * sequence: global_forms 1,2,3… and dissents 1,2,3… count in parallel, not together. Taking
 * the max across them looked conservative but silently skipped rows — a dissent at seq 3
 * would never be delivered once global_forms had reached seq 5, because the shared cursor was
 * already past it. Nothing errors; the row simply never arrives.
 *
 * Within a single stream the cursor is exact, and re-delivery on a tie is harmless anyway
 * because the client upserts by primary key.
 */
export async function pullSince(
  r: SqlRunner, since: Partial<Cursors> = {}, limit = 500,
): Promise<PullPage> {
  const from: Cursors = { ...ZERO_CURSORS, ...since };

  const globalForms = await r.query(
    `SELECT g.subject_kind, g.subject_value, g.claim_id, g.version, g.established_at, g.seq,
            cv.payload_json, c.author_id, cv.schema_version
       FROM global_forms g
       JOIN claim_versions cv ON cv.claim_id = g.claim_id AND cv.version = g.version
       JOIN claims c ON c.id = g.claim_id
      WHERE g.seq > $1
      ORDER BY g.seq
      LIMIT $2`, [from.globalForms, limit]);

  const dissents = await r.query(
    `SELECT id, claim_id, claim_version, author_id, payload_json, created_at, seq
       FROM dissents
      WHERE seq > $1
      ORDER BY seq
      LIMIT $2`, [from.dissents, limit]);

  // Every version of every claim. `status` is derived rather than stored: established when the
  // global slot still points at this exact version, superseded once a later version exists,
  // proposed otherwise. Deriving it here means a claim that loses the slot later is corrected
  // on the next pull without needing a rewrite of history upstream.
  const peers = await r.query(
    `SELECT cv.claim_id, cv.version, cv.payload_json, cv.created_at, cv.schema_version, cv.seq,
            c.author_id, c.subject_kind, c.subject_value, c.current_version,
            (g.claim_id IS NOT NULL) AS is_global,
            -- who submitted it: display name if set, else the email
            COALESCE(NULLIF(au.display_name, ''), au.email) AS author_name,
            -- who approved this exact version (moderators only object or approve)
            COALESCE((
              SELECT json_agg(COALESCE(NULLIF(mu.display_name, ''), mu.email) ORDER BY rv.created_at)
                FROM reviews rv
                JOIN users mu ON mu.id = rv.moderator_id
               WHERE rv.claim_id = cv.claim_id AND rv.claim_version = cv.version
                 AND rv.decision = 'approve'
            ), '[]'::json) AS approvers
       FROM claim_versions cv
       JOIN claims c ON c.id = cv.claim_id
       JOIN users au ON au.id = c.author_id
       LEFT JOIN global_forms g
         ON g.claim_id = cv.claim_id AND g.version = cv.version
      WHERE cv.seq > $1
      ORDER BY cv.seq
      LIMIT $2`, [from.peerIndications, limit]);

  // each stream advances only past its own rows; an empty stream keeps the position it had
  const advance = (rows: Record<string, unknown>[], was: number) =>
    rows.reduce((m, row) => Math.max(m, Number(row.seq ?? 0)), was);

  return {
    cursors: {
      globalForms: advance(globalForms, from.globalForms),
      dissents: advance(dissents, from.dissents),
      peerIndications: advance(peers, from.peerIndications),
    },
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
        authorName: p.author_name ?? "",
        subjectKind: p.subject_kind, subjectValue: p.subject_value,
        status: p.is_global
          ? "established"
          : Number(p.current_version ?? 0) > Number(p.version) ? "superseded" : "proposed",
        label: payload?.label ?? "",
        meaning: payload?.meaning ?? "",
        approvers: (p.approvers as string[] | null) ?? [],
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
