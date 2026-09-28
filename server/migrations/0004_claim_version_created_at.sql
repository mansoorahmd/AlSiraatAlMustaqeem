-- Peer indications are pulled with a date, and that date must be STABLE: a client that
-- re-pulls the same row (which the cursor deliberately allows) has to receive the same value,
-- or an idempotent upsert would keep rewriting it.
--
-- claim_versions only had `established_at`, which is NULL while a reading is merely proposed —
-- and proposed readings are exactly the ones the community indication list exists to show. So
-- record when the version was written, independently of whether it ever won the global slot.
--
-- Backfill: existing rows take established_at where they have it, else now(). That is a
-- one-time approximation for rows that predate the column and cannot be recovered otherwise.

ALTER TABLE claim_versions
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE claim_versions
   SET created_at = established_at
 WHERE established_at IS NOT NULL
   AND created_at > established_at;
