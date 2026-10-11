-- 0006_corpus_access — plan tiers as data, and who may read the corpus (and each translation).
--
-- 1. PLAN TIERS. 0005 hard-coded the ladder (free < pro) in a CHECK. The ladder is now a table a
--    maintainer edits at runtime — e.g. free < student < pro < scholar. A tier's RANK orders it;
--    a gate asks "is your rank at least that tier's?". `free` is rank 0 and always exists.
--    users.plan becomes a foreign key, so an account can never hold a tier that doesn't exist,
--    and renaming a tier carries every account with it.
--
-- 2. CORPUS POLICY. One row: the access LEVEL for reading the Qur'an corpus from the cloud
--      public     anyone, no sign-in
--      signed_in  any signed-in account
--      plan       an active plan at or above min_plan
--    Default: plan ≥ pro. A maintainer relaxes it with `npm run corpus-access -- public`.
--
-- 3. TRANSLATION ACCESS. Optional per-translation minimum tier. No row = available to anyone who
--    may read the corpus. Keyed by corpus.translation_resources.id WITHOUT a foreign key, because
--    the corpus schema is rebuilt wholesale by `corpus:migrate` and must not drag these along.
--
-- Roles are untouched: a tier says what you've paid for, never what you may administer.

CREATE TABLE IF NOT EXISTS plan_tiers (
  name  text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{0,31}$'),
  rank  integer NOT NULL UNIQUE CHECK (rank >= 0),
  label text NOT NULL DEFAULT '',
  CONSTRAINT free_is_rank_zero CHECK (name <> 'free' OR rank = 0)
);
INSERT INTO plan_tiers (name, rank, label) VALUES ('free', 0, 'Free'), ('pro', 100, 'Pro')
  ON CONFLICT (name) DO NOTHING;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_tier_fk;
ALTER TABLE users ADD CONSTRAINT users_plan_tier_fk
  FOREIGN KEY (plan) REFERENCES plan_tiers(name) ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS corpus_policy (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),        -- exactly one row
  access     text NOT NULL CHECK (access IN ('public', 'signed_in', 'plan')),
  min_plan   text NOT NULL DEFAULT 'pro' REFERENCES plan_tiers(name) ON UPDATE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);
INSERT INTO corpus_policy (id, access, min_plan) VALUES (true, 'plan', 'pro')
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS translation_access (
  resource_id integer PRIMARY KEY,
  min_plan    text NOT NULL REFERENCES plan_tiers(name) ON UPDATE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id)
);
