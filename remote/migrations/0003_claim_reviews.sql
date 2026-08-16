-- 0003_claim_reviews — reviews attach to a CLAIM VERSION, not only to a submission.
--
-- Phase 4 reviewed submissions. Phase 5 reviews the thing that actually contends for the global
-- slot: one author's reading at one version. A review is therefore (claim_id, version,
-- moderator) — one verdict per moderator per version, changeable.
--
-- Additive: submission_id becomes optional and the new columns are nullable, so the rows
-- Phase 4 wrote stay valid.

ALTER TABLE reviews ALTER COLUMN submission_id DROP NOT NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS claim_id text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS claim_version int;

-- One verdict per moderator per claim version (they may change it, not stack it).
-- Not a PARTIAL index: Postgres won't infer one in ON CONFLICT unless the predicate is
-- repeated there, and it isn't needed — NULLs are distinct in a unique index, so the
-- submission-level reviews from Phase 4 (claim_id IS NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_claim_moderator
  ON reviews (claim_id, claim_version, moderator_id);

CREATE INDEX IF NOT EXISTS idx_reviews_claim ON reviews (claim_id, claim_version);
