-- 0005_entitlements — monetization. A `plan` axis on users, ORTHOGONAL to `role`.
--
-- `role`  = what you may do in the research process (reader < … < maintainer) — SHARED_RESEARCH §4.
-- `plan`  = what you have paid for (free < pro). The two are independent: a researcher on the
--           free plan may still study locally, but the server-gated features (community reads,
--           publishing, cloud MCP) require an active paid plan. This column is the single
--           enforcement point — see src/plans.ts (requirePlan).
--
-- Billing is deferred; for now a maintainer sets the plan out of band (set-plan CLI) or over
-- HTTP (POST /plan). `plan_expires_at` lets a plan lapse (NULL = no expiry / manually granted).

ALTER TABLE users ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free','pro'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
