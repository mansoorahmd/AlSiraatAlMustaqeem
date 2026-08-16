// Phase 5 — the spine: claims, review, global establishment, and the dissent ledger.
//
// This is the part the whole design exists for, and its defining property is that it NEVER
// forces convergence. A claim that loses is not deleted or argued away: the objection is kept,
// attached to the version it objects to, permanently and citably. Git merges; this doesn't.
//
// A claim is ONE AUTHOR'S READING of one subject (a form or a root). Two researchers reading
// the same word hold two different claims — they contend for the global slot, they don't
// overwrite each other. Successive readings by the same author are VERSIONS of their claim, so
// `id@v` pins exactly what was cited even after they change their mind.
//
// Establishment rule (SHARED_RESEARCH.md §2, locked):
//   approvals >= requiredApprovals AND approvals > objections
// — a majority OF THE VOTES CAST, not of all moderators (waiting on people who never look
// would stall forever). A moderator may not approve their own submission. A maintainer may
// establish directly, recorded as their act.

import type { SqlRunner } from "./migrate.js";
import { claimId, dissentId } from "./ids.js";
import { SCHEMA_VERSION } from "./submissions.js";

/** How many approvals a claim needs before the majority test applies. Config, not a constant. */
export const requiredApprovals = (): number => Number(process.env.REQUIRED_APPROVALS ?? 1);

export type SubjectKind = "form" | "root";
export type Decision = "approve" | "object";

export class ClaimError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface ClaimVersion {
  claimId: string;
  version: number;
  authorId: string;
  subjectKind: SubjectKind;
  subjectValue: string;
  payload: unknown;
  establishedAt: string | null;
}

/**
 * Record an author's reading of a subject. The first is version 1; a later reading by the same
 * author is a NEW VERSION of the same claim, with the old one intact and still citable
 * (SHARED_RESEARCH.md §12.2 — revising your own established reading is a version, not a
 * dissent against yourself).
 *
 * A competing claim must carry its argument (§12.1): a bare assertion can't be reviewed.
 */
export async function proposeClaim(
  r: SqlRunner,
  opts: {
    authorId: string; subjectKind: SubjectKind; subjectValue: string;
    payload: { meaning?: string; argument?: unknown; evidence?: unknown[]; caseId?: string };
  },
): Promise<ClaimVersion> {
  const subject = opts.subjectValue?.trim();
  if (!subject) throw new ClaimError("a subject is required", 422);
  if (!opts.payload?.meaning?.trim()) throw new ClaimError("a reading (meaning) is required", 422);

  // §12.1 — the argument must come with the claim, or reviewers have nothing to weigh
  const hasArgument = !!opts.payload.caseId
    || !!opts.payload.argument
    || (Array.isArray(opts.payload.evidence) && opts.payload.evidence.length > 0);
  if (!hasArgument) {
    throw new ClaimError(
      "a competing claim must carry its argument — attach a case, evidence āyāt, or reasoning", 422);
  }

  const id = claimId(opts.authorId, opts.subjectKind, subject);
  await r.query(
    `INSERT INTO claims (id, author_id, subject_kind, subject_value)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [id, opts.authorId, opts.subjectKind, subject],
  );

  const prev = await r.query(
    "SELECT COALESCE(MAX(version), 0) AS v FROM claim_versions WHERE claim_id = $1", [id]);
  const version = Number((prev[0] as { v: number | string }).v) + 1;

  await r.query(
    `INSERT INTO claim_versions (claim_id, version, payload_json, supersedes_version, schema_version)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [id, version, JSON.stringify(opts.payload), version > 1 ? version - 1 : null, SCHEMA_VERSION],
  );
  await r.query("UPDATE claims SET current_version = $1 WHERE id = $2", [version, id]);

  return (await getVersion(r, id, version))!;
}

export async function getVersion(
  r: SqlRunner, id: string, version: number,
): Promise<ClaimVersion | null> {
  const rows = await r.query(
    `SELECT cv.claim_id, cv.version, cv.payload_json, cv.established_at,
            c.author_id, c.subject_kind, c.subject_value
       FROM claim_versions cv JOIN claims c ON c.id = cv.claim_id
      WHERE cv.claim_id = $1 AND cv.version = $2`, [id, version]);
  const v = rows[0] as Record<string, unknown> | undefined;
  return v ? {
    claimId: String(v.claim_id), version: Number(v.version), authorId: String(v.author_id),
    subjectKind: v.subject_kind as SubjectKind, subjectValue: String(v.subject_value),
    payload: v.payload_json,
    establishedAt: v.established_at ? new Date(v.established_at as string).toISOString() : null,
  } : null;
}

/** Every reading of a subject, whoever holds it — what the reader compares. */
export async function claimsFor(
  r: SqlRunner, subjectKind: SubjectKind, subjectValue: string,
): Promise<ClaimVersion[]> {
  const rows = await r.query(
    `SELECT cv.claim_id, cv.version, cv.payload_json, cv.established_at,
            c.author_id, c.subject_kind, c.subject_value
       FROM claim_versions cv JOIN claims c ON c.id = cv.claim_id
      WHERE c.subject_kind = $1 AND c.subject_value = $2
      ORDER BY cv.claim_id, cv.version`, [subjectKind, subjectValue]);
  return rows.map((v) => ({
    claimId: String(v.claim_id), version: Number(v.version), authorId: String(v.author_id),
    subjectKind: v.subject_kind as SubjectKind, subjectValue: String(v.subject_value),
    payload: v.payload_json,
    establishedAt: v.established_at ? new Date(v.established_at as string).toISOString() : null,
  }));
}

export interface Tally { approvals: number; objections: number; established: boolean }

/**
 * A moderator's verdict on a claim version.
 *
 * Approvals and objections are both recorded — an objection never blocks. Once the claim is
 * established, an objection becomes a DISSENT attached to that version: the ledger of
 * disagreement the design exists to preserve.
 */
export async function review(
  r: SqlRunner,
  opts: {
    claimId: string; version: number;
    moderatorId: string; moderatorRole: string;
    decision: Decision; comment?: string; payload?: unknown;
  },
): Promise<Tally> {
  const target = await getVersion(r, opts.claimId, opts.version);
  if (!target) throw new ClaimError("no such claim version", 404);

  // establishment must not be self-service (§2, locked)
  if (target.authorId === opts.moderatorId && opts.decision === "approve") {
    throw new ClaimError("you can't approve your own claim", 403);
  }

  // one verdict per moderator per version — changing your mind replaces it, never stacks
  await r.query(
    `INSERT INTO reviews (id, claim_id, claim_version, moderator_id, decision, comment)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (claim_id, claim_version, moderator_id)
       DO UPDATE SET decision = excluded.decision, comment = excluded.comment`,
    [`rev_${opts.claimId}_${opts.version}_${opts.moderatorId}`,
     opts.claimId, opts.version, opts.moderatorId, opts.decision, opts.comment ?? ""],
  );

  const tally = await tallyFor(r, opts.claimId, opts.version);

  // majority OF THE VOTES CAST, with a minimum
  if (!tally.established
      && tally.approvals >= requiredApprovals()
      && tally.approvals > tally.objections) {
    await establish(r, opts.claimId, opts.version);
    tally.established = true;
  }

  // an objection to something already established is preserved as dissent, not discarded
  if (opts.decision === "object" && (tally.established || target.establishedAt)) {
    await fileDissent(r, {
      claimId: opts.claimId, version: opts.version, authorId: opts.moderatorId,
      payload: opts.payload ?? { comment: opts.comment ?? "" },
    });
  }

  return tally;
}

export async function tallyFor(r: SqlRunner, id: string, version: number): Promise<Tally> {
  const rows = await r.query(
    `SELECT decision, COUNT(*)::int AS n FROM reviews
      WHERE claim_id = $1 AND claim_version = $2 GROUP BY decision`, [id, version]);
  let approvals = 0, objections = 0;
  for (const row of rows) {
    if (row.decision === "approve") approvals = Number(row.n);
    if (row.decision === "object") objections = Number(row.n);
  }
  const v = await getVersion(r, id, version);
  return { approvals, objections, established: !!v?.establishedAt };
}

/**
 * Make this version the group's reading of its subject. Exactly one row per subject in
 * global_forms — establishing a different claim repoints it, and the previous reading stays
 * in claim_versions, still citable at its own id@v.
 */
export async function establish(r: SqlRunner, id: string, version: number): Promise<void> {
  const v = await getVersion(r, id, version);
  if (!v) throw new ClaimError("no such claim version", 404);

  await r.query(
    "UPDATE claim_versions SET established_at = now() WHERE claim_id = $1 AND version = $2",
    [id, version]);
  await r.query(
    `INSERT INTO global_forms (subject_kind, subject_value, claim_id, version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (subject_kind, subject_value)
       DO UPDATE SET claim_id = excluded.claim_id, version = excluded.version,
                     established_at = now()`,
    [v.subjectKind, v.subjectValue, id, version],
  );
}

/** A maintainer establishing directly — recorded as their act, not a pretended vote. */
export async function establishAsMaintainer(
  r: SqlRunner, opts: { claimId: string; version: number; maintainerId: string; comment?: string },
): Promise<void> {
  await r.query(
    `INSERT INTO reviews (id, claim_id, claim_version, moderator_id, decision, comment)
     VALUES ($1, $2, $3, $4, 'approve', $5)
     ON CONFLICT (claim_id, claim_version, moderator_id)
       DO UPDATE SET decision = 'approve', comment = excluded.comment`,
    [`rev_${opts.claimId}_${opts.version}_${opts.maintainerId}`,
     opts.claimId, opts.version, opts.maintainerId,
     opts.comment ?? "established by the maintainer"],
  );
  await establish(r, opts.claimId, opts.version);
}

/** The group's current reading of a subject, if it has one. */
export async function globalReading(
  r: SqlRunner, subjectKind: SubjectKind, subjectValue: string,
): Promise<ClaimVersion | null> {
  const rows = await r.query(
    "SELECT claim_id, version FROM global_forms WHERE subject_kind = $1 AND subject_value = $2",
    [subjectKind, subjectValue]);
  const g = rows[0] as { claim_id: string; version: number } | undefined;
  return g ? getVersion(r, g.claim_id, Number(g.version)) : null;
}

/**
 * File a dissent against an established reading. It carries its OWN payload (§12.4) — it must
 * stand alone, because the submission it came from may later be redacted, and because a dissent
 * that shaped someone's reasoning has to remain readable.
 */
export async function fileDissent(
  r: SqlRunner,
  opts: { claimId: string; version: number; authorId: string; payload: unknown },
): Promise<string> {
  const id = dissentId(opts.authorId, opts.claimId, opts.version, opts.payload);
  await r.query(
    `INSERT INTO dissents (id, claim_id, claim_version, author_id, payload_json)
     VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (id) DO NOTHING`,
    [id, opts.claimId, opts.version, opts.authorId, JSON.stringify(opts.payload)],
  );
  return id;
}

/** The ledger of disagreement attached to a reading. */
export async function dissentsFor(
  r: SqlRunner, id: string, version?: number,
): Promise<{ id: string; authorId: string; payload: unknown; createdAt: string }[]> {
  const rows = version === undefined
    ? await r.query("SELECT id, author_id, payload_json, created_at FROM dissents WHERE claim_id = $1 ORDER BY created_at", [id])
    : await r.query("SELECT id, author_id, payload_json, created_at FROM dissents WHERE claim_id = $1 AND claim_version = $2 ORDER BY created_at", [id, version]);
  return rows.map((d) => ({
    id: String(d.id), authorId: String(d.author_id), payload: d.payload_json,
    createdAt: new Date(d.created_at as string).toISOString(),
  }));
}
