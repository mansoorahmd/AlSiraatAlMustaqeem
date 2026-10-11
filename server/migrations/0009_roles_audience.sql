-- Roles become a ladder of DATA, like plan tiers, and every published result carries an
-- audience (a minimum role and a minimum plan).
--
-- Roles are a person's standing — what they may DO (features). Three rungs are fixed because
-- the staff powers hang on them: reader (the bottom), moderator (review), maintainer
-- (administer). Between reader and moderator a maintainer may add learner rungs — e.g. student,
-- scholar — which gate features like publishing and which published results a person can see.

CREATE TABLE IF NOT EXISTS role_levels (
  name   text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_-]{0,31}$'),
  rank   int  NOT NULL UNIQUE,
  label  text NOT NULL DEFAULT '',
  fixed  boolean NOT NULL DEFAULT false
);
INSERT INTO role_levels (name, rank, label, fixed) VALUES
  ('reader',      0,   'Reader',     true),
  ('student',     10,  'Student',    false),
  ('researcher',  20,  'Researcher', false),
  ('scholar',     30,  'Scholar',    false),
  ('moderator',   80,  'Moderator',  true),
  ('maintainer',  100, 'Maintainer', true)
ON CONFLICT (name) DO NOTHING;

-- users and invites may hold any rung on the ladder (was a fixed CHECK list)
ALTER TABLE users   DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE users   ADD CONSTRAINT users_role_fk   FOREIGN KEY (role) REFERENCES role_levels(name) ON UPDATE CASCADE;
ALTER TABLE invites ADD CONSTRAINT invites_role_fk FOREIGN KEY (role) REFERENCES role_levels(name) ON UPDATE CASCADE;

-- which role a FEATURE needs, where that is the maintainer's choice (staff powers stay fixed)
CREATE TABLE IF NOT EXISTS feature_access (
  feature   text PRIMARY KEY CHECK (feature IN ('publish')),
  min_role  text NOT NULL REFERENCES role_levels(name) ON UPDATE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO feature_access (feature, min_role) VALUES ('publish', 'researcher') ON CONFLICT DO NOTHING;

-- who may see a published result: at least this role, and at least this plan. NULL = no extra
-- requirement (the community resource rule still applies to everything). The author proposes
-- it when publishing; the reviewer confirms or changes it when approving.
ALTER TABLE claim_versions ADD COLUMN IF NOT EXISTS audience_role text REFERENCES role_levels(name) ON UPDATE CASCADE;
ALTER TABLE claim_versions ADD COLUMN IF NOT EXISTS audience_plan text REFERENCES plan_tiers(name) ON UPDATE CASCADE;
ALTER TABLE submissions    ADD COLUMN IF NOT EXISTS audience_role text REFERENCES role_levels(name) ON UPDATE CASCADE;
ALTER TABLE submissions    ADD COLUMN IF NOT EXISTS audience_plan text REFERENCES plan_tiers(name) ON UPDATE CASCADE;
