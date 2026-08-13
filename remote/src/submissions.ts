// Outbound submissions (Phase 4) — the first thing that carries local research upstream.
//
// Only ADDITIVE kinds for now: notes, published questions, evidence āyāt. They land as new
// attributed rows and cannot conflict with anyone else's work, so no claim/dissent machinery is
// needed yet — which is exactly why the build plan proves the pipe with them first.
//
// Two properties matter and are enforced here:
//   • A submission is an IMMUTABLE SNAPSHOT. Its payload is frozen at submit time; a later edit
//     to your local note doesn't rewrite what you submitted. Re-submitting creates a NEW
//     submission that references the old one via `supersedes`.
//   • It is content-addressed, so submitting the identical thing twice is idempotent rather
//     than creating a duplicate.

import type { SqlRunner } from "./migrate.js";
import { submissionId } from "./ids.js";

/** The current wire format. Every stored payload records the version that wrote it. */
export const SCHEMA_VERSION = 1;

/** Kinds that can't conflict — the only ones Phase 4 accepts. */
export const ADDITIVE_KINDS = ["note", "question", "evidence"] as const;
export type AdditiveKind = (typeof ADDITIVE_KINDS)[number];

/** A case board is one JSON document and can get large; cap each item (§12.5). */
export const MAX_ITEM_BYTES = 1_048_576; // 1 MB

export interface SubmissionItemInput {
  kind: AdditiveKind;
  subjectKind?: string | null;   // 'form' | 'root' | 'ayah' — free-form for additive items
  subjectValue?: string | null;
  payload: unknown;              // the frozen snapshot of the local record
}

export interface SubmissionOut {
  id: string;
  status: string;
  targetKind: string;
  createdAt: string;
  supersedes: string | null;
  items: number;
}

export class SubmissionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const isAdditive = (k: unknown): k is AdditiveKind =>
  typeof k === "string" && (ADDITIVE_KINDS as readonly string[]).includes(k);

/**
 * Freeze `items` into a submission owned by `authorId`.
 *
 * Idempotent: the id is derived from the author + payload, so submitting the identical bundle
 * again returns the existing submission untouched rather than duplicating it.
 */
export async function createSubmission(
  r: SqlRunner,
  opts: { authorId: string; items: SubmissionItemInput[]; supersedes?: string | null },
): Promise<SubmissionOut> {
  const items = opts.items ?? [];
  if (items.length === 0) throw new SubmissionError("a submission needs at least one item", 422);

  for (const it of items) {
    if (!isAdditive(it.kind)) {
      throw new SubmissionError(
        `only additive kinds can be submitted yet (${ADDITIVE_KINDS.join(", ")}) — got '${it.kind}'`, 422);
    }
    const bytes = Buffer.byteLength(JSON.stringify(it.payload ?? null), "utf8");
    if (bytes > MAX_ITEM_BYTES) {
      throw new SubmissionError(
        `item too large (${Math.round(bytes / 1024)} KB, limit ${MAX_ITEM_BYTES / 1024} KB) — split this submission`, 413);
    }
  }

  if (opts.supersedes) {
    const prev = await r.query("SELECT id, author_id FROM submissions WHERE id = $1", [opts.supersedes]);
    const row = prev[0] as { id: string; author_id: string } | undefined;
    if (!row) throw new SubmissionError(`no such submission to supersede: ${opts.supersedes}`, 404);
    if (row.author_id !== opts.authorId) throw new SubmissionError("that submission isn't yours", 403);
  }

  const id = submissionId(opts.authorId, "additive", items);

  const existing = await r.query("SELECT id FROM submissions WHERE id = $1", [id]);
  if (!existing[0]) {
    await r.query(
      `INSERT INTO submissions (id, author_id, target_kind, status, supersedes)
       VALUES ($1, $2, 'additive', 'submitted', $3)`,
      [id, opts.authorId, opts.supersedes ?? null],
    );
    for (const [i, it] of items.entries()) {
      await r.query(
        `INSERT INTO submission_items
           (id, submission_id, kind, subject_kind, subject_value, payload_json, schema_version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [`${id}_${i}`, id, it.kind, it.subjectKind ?? null, it.subjectValue ?? null,
         JSON.stringify(it.payload ?? null), SCHEMA_VERSION],
      );
    }
  }
  return (await getSubmission(r, id))!;
}

export async function getSubmission(r: SqlRunner, id: string): Promise<SubmissionOut | null> {
  const rows = await r.query(
    `SELECT s.id, s.status, s.target_kind, s.created_at, s.supersedes,
            COUNT(i.id)::int AS items
       FROM submissions s LEFT JOIN submission_items i ON i.submission_id = s.id
      WHERE s.id = $1
      GROUP BY s.id`, [id]);
  const s = rows[0] as Record<string, unknown> | undefined;
  return s ? shape(s) : null;
}

/** Everything this author has sent, newest first — the outbox. */
export async function listMine(r: SqlRunner, authorId: string): Promise<SubmissionOut[]> {
  const rows = await r.query(
    `SELECT s.id, s.status, s.target_kind, s.created_at, s.supersedes,
            COUNT(i.id)::int AS items
       FROM submissions s LEFT JOIN submission_items i ON i.submission_id = s.id
      WHERE s.author_id = $1
      GROUP BY s.id ORDER BY s.created_at DESC`, [authorId]);
  return rows.map(shape);
}

function shape(s: Record<string, unknown>): SubmissionOut {
  return {
    id: String(s.id),
    status: String(s.status),
    targetKind: String(s.target_kind),
    createdAt: new Date(s.created_at as string).toISOString(),
    supersedes: (s.supersedes as string | null) ?? null,
    items: Number(s.items ?? 0),
  };
}
