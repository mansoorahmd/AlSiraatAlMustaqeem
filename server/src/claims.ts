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
  /** who may see it once published: at least this role and this plan (null = no extra need) */
  audience: { minRole: string | null; minPlan: string | null };
}

/** Decides whether the viewer may see a published result (role-ladder.ts makeAudienceCheck). */
export type CanSee = (row: { audience_role?: unknown; audience_plan?: unknown; author_id?: unknown }) => boolean;
const everyone: CanSee = () => true;

const toVersion = (v: Record<string, unknown>): ClaimVersion => ({
  claimId: String(v.claim_id), version: Number(v.version), authorId: String(v.author_id),
  subjectKind: v.subject_kind as SubjectKind, subjectValue: String(v.subject_value),
  payload: v.payload_json,
  establishedAt: v.established_at ? new Date(v.established_at as string).toISOString() : null,
  audience: {
    minRole: v.audience_role == null ? null : String(v.audience_role),
    minPlan: v.audience_plan == null ? null : String(v.audience_plan),
  },
});
const VERSION_COLS = `cv.claim_id, cv.version, cv.payload_json, cv.established_at, cv.audience_role, cv.audience_plan,
            c.author_id, c.subject_kind, c.subject_value`;

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
    /** the publisher's proposed audience (validated by the caller); the reviewer confirms it */
    audience?: { minRole: string | null; minPlan: string | null };
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
    `INSERT INTO claim_versions (claim_id, version, payload_json, supersedes_version, schema_version, audience_role, audience_plan)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
    [id, version, JSON.stringify(opts.payload), version > 1 ? version - 1 : null, SCHEMA_VERSION,
     opts.audience?.minRole ?? null, opts.audience?.minPlan ?? null],
  );
  await r.query("UPDATE claims SET current_version = $1 WHERE id = $2", [version, id]);

  return (await getVersion(r, id, version))!;
}

export async function getVersion(
  r: SqlRunner, id: string, version: number,
): Promise<ClaimVersion | null> {
  const rows = await r.query(
    `SELECT ${VERSION_COLS}
       FROM claim_versions cv JOIN claims c ON c.id = cv.claim_id
      WHERE cv.claim_id = $1 AND cv.version = $2`, [id, version]);
  const v = rows[0] as Record<string, unknown> | undefined;
  return v ? toVersion(v) : null;
}

/** Confirm or change who may see a version — the reviewer's call when approving. */
export async function setAudience(
  r: SqlRunner, id: string, version: number, audience: { minRole: string | null; minPlan: string | null },
): Promise<void> {
  const done = await r.query(
    "UPDATE claim_versions SET audience_role = $1, audience_plan = $2 WHERE claim_id = $3 AND version = $4 RETURNING claim_id",
    [audience.minRole, audience.minPlan, id, version]);
  if (!done.length) throw new ClaimError("no such claim version", 404);
}

/** Every reading of a subject the viewer may see, whoever holds it — what the reader compares. */
export async function claimsFor(
  r: SqlRunner, subjectKind: SubjectKind, subjectValue: string, canSee: CanSee = everyone,
): Promise<ClaimVersion[]> {
  const rows = await r.query(
    `SELECT ${VERSION_COLS}
       FROM claim_versions cv JOIN claims c ON c.id = cv.claim_id
      WHERE c.subject_kind = $1 AND c.subject_value = $2
      ORDER BY cv.claim_id, cv.version`, [subjectKind, subjectValue]);
  return rows.filter(canSee).map(toVersion);
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
  r: SqlRunner, subjectKind: SubjectKind, subjectValue: string, canSee: CanSee = everyone,
): Promise<ClaimVersion | null> {
  const rows = await r.query(
    "SELECT claim_id, version FROM global_forms WHERE subject_kind = $1 AND subject_value = $2",
    [subjectKind, subjectValue]);
  const g = rows[0] as { claim_id: string; version: number } | undefined;
  const v = g ? await getVersion(r, g.claim_id, Number(g.version)) : null;
  // a reading outside the viewer's audience is, for them, not there
  return v && canSee({ audience_role: v.audience.minRole, audience_plan: v.audience.minPlan, author_id: v.authorId }) ? v : null;
}

export interface PeerReading {
  id: string;                  // peer:<claimId>@<version>
  claimId: string;
  version: number;
  authorId: string;
  authorName: string;
  scope: "root" | "lemma";
  root: string | null;
  lemma: string | null;
  status: "proposed" | "established" | "superseded";
  label: string;
  meaning: string;
  refinements: { lemma: string; label: string; meaning: string }[];
  approvers: string[];
  dissents: number;
  /** who may see it (the author proposed it; a reviewer may change it) */
  audience: { minRole: string | null; minPlan: string | null };
}

const STATUS_ORDER = { established: 0, proposed: 1, superseded: 2 } as const;

/**
 * Every reading on record for ONE subject, shaped for the reader — the live, remote-only source
 * for the community chips that used to be mirrored into `derived_peer_indications`. `status` is
 * derived exactly as pull.ts derives it (established = the global slot points here; superseded =
 * a later version exists; proposed otherwise), so a claim that later loses the slot corrects
 * itself with no history rewrite. Ordered established → proposed → superseded, newest first.
 */
async function readingsForSubject(
  r: SqlRunner, subjectKind: SubjectKind, subjectValue: string, canSee: CanSee,
): Promise<PeerReading[]> {
  const subject = subjectValue?.trim();
  if (!subject) return [];
  const rows = await r.query(
    `SELECT cv.claim_id, cv.version, cv.payload_json, cv.created_at, cv.audience_role, cv.audience_plan,
            c.author_id, c.subject_kind, c.subject_value, c.current_version,
            (g.claim_id IS NOT NULL) AS is_global,
            COALESCE(NULLIF(au.display_name, ''), 'a researcher') AS author_name,
            COALESCE((
              SELECT json_agg(COALESCE(NULLIF(mu.display_name, ''), 'a moderator') ORDER BY rv.created_at)
                FROM reviews rv JOIN users mu ON mu.id = rv.moderator_id
               WHERE rv.claim_id = cv.claim_id AND rv.claim_version = cv.version
                 AND rv.decision = 'approve'
            ), '[]'::json) AS approvers,
            (SELECT COUNT(*)::int FROM dissents d
              WHERE d.claim_id = cv.claim_id AND d.claim_version = cv.version) AS dissents
       FROM claim_versions cv
       JOIN claims c ON c.id = cv.claim_id
       JOIN users au ON au.id = c.author_id
       LEFT JOIN global_forms g ON g.claim_id = cv.claim_id AND g.version = cv.version
      WHERE c.subject_kind = $1 AND c.subject_value = $2
      ORDER BY cv.created_at DESC`, [subjectKind, subject]);

  const mapped: PeerReading[] = rows.filter(canSee).map((p) => {
    const payload = p.payload_json as
      { meaning?: string; label?: string; refinements?: PeerReading["refinements"] } | null;
    const status: PeerReading["status"] = p.is_global
      ? "established"
      : Number(p.current_version ?? 0) > Number(p.version) ? "superseded" : "proposed";
    return {
      id: `peer:${p.claim_id}@${Number(p.version)}`,
      claimId: String(p.claim_id), version: Number(p.version), authorId: String(p.author_id),
      authorName: String(p.author_name ?? ""),
      scope: subjectKind === "root" ? "root" : "lemma",
      root: subjectKind === "root" ? String(p.subject_value) : null,
      lemma: subjectKind === "form" ? String(p.subject_value) : null,
      status,
      label: payload?.label ?? "", meaning: payload?.meaning ?? "",
      refinements: Array.isArray(payload?.refinements) ? payload!.refinements : [],
      approvers: (p.approvers as string[] | null) ?? [],
      dissents: Number(p.dissents ?? 0),
      audience: {
        minRole: p.audience_role == null ? null : String(p.audience_role),
        minPlan: p.audience_plan == null ? null : String(p.audience_plan),
      },
    };
  });
  // stable sort (created_at DESC already applied within each status group)
  return mapped.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

/**
 * The community's readings of a word — its root and its exact form — for the reader's indication
 * chips. Live and gated; the group's readings never touch the client's disk.
 */
export async function communityReadingsFor(
  r: SqlRunner, opts: { root?: string | null; lemma?: string | null }, canSee: CanSee = everyone,
): Promise<{ communityRoot: PeerReading[]; communityLemma: PeerReading[] }> {
  return {
    communityRoot: opts.root ? await readingsForSubject(r, "root", opts.root, canSee) : [],
    communityLemma: opts.lemma ? await readingsForSubject(r, "form", opts.lemma, canSee) : [],
  };
}

export interface DivergenceRow {
  subjectKind: SubjectKind;
  subjectValue: string;
  mine: string;
  theirs: string;
  claimId: string;
  version: number;
  authorId: string;
  dissents: number;
}

/**
 * ⚖ Where a reader stands apart from the group — computed LIVE against the remote, never from a
 * local mirror. The client sends the forms IT has established (subject + its own meaning); we
 * diff each against the group's current reading and return only the ones that differ. This is
 * the remote-only replacement for the old local `divergences()` that read `derived_global_forms`
 * — the group's readings never touch the client's disk, which is what makes the feature gateable.
 *
 * Both readings are returned; NEITHER is changed. Divergence is a state to know, not resolve.
 */
export async function divergencesAgainstGlobal(
  r: SqlRunner,
  mine: { subjectKind?: SubjectKind; subjectValue: string; meaning: string }[],
  canSee: CanSee = everyone,
): Promise<{ divergences: DivergenceRow[]; overlap: number; globalTotal: number }> {
  const out: DivergenceRow[] = [];
  let overlap = 0;
  for (const m of mine) {
    const kind = m.subjectKind ?? "form";
    const subject = m.subjectValue?.trim();
    if (!subject) continue;
    const g = await globalReading(r, kind, subject, canSee);
    if (!g) continue; // the group hasn't settled this form — nothing to diverge from
    overlap++;
    const theirs = String((g.payload as { meaning?: string } | null)?.meaning ?? "").trim();
    const mineMeaning = (m.meaning ?? "").trim();
    if (theirs && mineMeaning && theirs !== mineMeaning) {
      const dissents = (await dissentsFor(r, g.claimId, g.version)).length;
      out.push({
        subjectKind: kind, subjectValue: subject, mine: mineMeaning, theirs,
        claimId: g.claimId, version: g.version, authorId: g.authorId, dissents,
      });
    }
  }
  // how many readings the group holds — that this viewer may see
  const gt = await r.query(
    `SELECT cv.audience_role, cv.audience_plan, c.author_id FROM global_forms g
       JOIN claim_versions cv ON cv.claim_id = g.claim_id AND cv.version = g.version
       JOIN claims c ON c.id = g.claim_id`);
  const globalTotal = gt.filter(canSee).length;
  return { divergences: out, overlap, globalTotal };
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
