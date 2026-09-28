-- 0001_init — the research channel schema (SHARED_RESEARCH_SCHEMA.md §3).
-- The corpus is NOT here (it ships as signed patch files). Better Auth manages its own
-- session/account/verification tables in a later step; `users` is created here as the
-- domain table Better Auth maps onto (id/email/role/local_id).
--
-- Every pull-able table carries a monotonic `seq` (bigserial) so inbound sync is a plain
-- cursor walk — no CRDT, no bidirectional merge.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  role          text NOT NULL DEFAULT 'reader'
                  CHECK (role IN ('reader','researcher','moderator','maintainer')),
  local_id      uuid,                                   -- bound on first sign-in (Phase 1 id)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  code         text PRIMARY KEY,
  issued_by    uuid NOT NULL REFERENCES users(id),
  role         text NOT NULL DEFAULT 'reader'
                 CHECK (role IN ('reader','researcher','moderator','maintainer')),
  redeemed_by  uuid REFERENCES users(id),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- a claim = one author's reading of one subject; versions are that author's revisions
CREATE TABLE IF NOT EXISTS claims (
  id             text PRIMARY KEY,                       -- clm_… (content-addressed)
  author_id      uuid NOT NULL REFERENCES users(id),
  subject_kind   text NOT NULL CHECK (subject_kind IN ('form','root')),
  subject_value  text NOT NULL,
  current_version int,
  UNIQUE (author_id, subject_kind, subject_value)
);

CREATE TABLE IF NOT EXISTS claim_versions (
  claim_id           text NOT NULL REFERENCES claims(id),
  version            int  NOT NULL,
  payload_json       jsonb NOT NULL,
  established_at     timestamptz,                        -- NULL while proposed
  supersedes_version int,                                -- self-revision chain
  schema_version     int NOT NULL,
  seq                bigserial NOT NULL,
  PRIMARY KEY (claim_id, version)
);
CREATE INDEX IF NOT EXISTS idx_claim_versions_seq ON claim_versions(seq);

-- the group's CURRENT established reading per subject (one row per subject)
CREATE TABLE IF NOT EXISTS global_forms (
  subject_kind   text NOT NULL CHECK (subject_kind IN ('form','root')),
  subject_value  text NOT NULL,
  claim_id       text NOT NULL,
  version        int  NOT NULL,
  established_at timestamptz NOT NULL DEFAULT now(),
  seq            bigserial NOT NULL,
  PRIMARY KEY (subject_kind, subject_value),
  FOREIGN KEY (claim_id, version) REFERENCES claim_versions(claim_id, version)
);
CREATE INDEX IF NOT EXISTS idx_global_forms_seq ON global_forms(seq);

CREATE TABLE IF NOT EXISTS dissents (
  id             text PRIMARY KEY,                       -- dsn_…
  claim_id       text NOT NULL,
  claim_version  int  NOT NULL,
  author_id      uuid NOT NULL REFERENCES users(id),
  payload_json   jsonb NOT NULL,                         -- carries its own evidence
  created_at     timestamptz NOT NULL DEFAULT now(),
  seq            bigserial NOT NULL,
  FOREIGN KEY (claim_id, claim_version) REFERENCES claim_versions(claim_id, version)
);
CREATE INDEX IF NOT EXISTS idx_dissents_claim ON dissents(claim_id, claim_version);
CREATE INDEX IF NOT EXISTS idx_dissents_seq ON dissents(seq);

CREATE TABLE IF NOT EXISTS submissions (
  id           text PRIMARY KEY,                         -- sub_…
  author_id    uuid NOT NULL REFERENCES users(id),
  target_kind  text NOT NULL CHECK (target_kind IN ('additive','competing','document')),
  status       text NOT NULL DEFAULT 'submitted'
                 CHECK (status IN ('submitted','approved','objected','withdrawn')),
  supersedes   text REFERENCES submissions(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submission_items (
  id            text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES submissions(id),
  kind          text NOT NULL CHECK (kind IN ('note','question','evidence','indication','verdict','case')),
  subject_kind  text,
  subject_value text,
  claim_id      text,
  payload_json  jsonb NOT NULL,
  schema_version int NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submission_items_sub ON submission_items(submission_id);

CREATE TABLE IF NOT EXISTS reviews (
  id            text PRIMARY KEY,
  submission_id text NOT NULL REFERENCES submissions(id),
  moderator_id  uuid NOT NULL REFERENCES users(id),
  decision      text NOT NULL CHECK (decision IN ('approve','object')),
  comment       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redactions (
  id            text PRIMARY KEY,
  target_kind   text NOT NULL CHECK (target_kind IN ('dissent','note','case','indication','claim_version')),
  target_id     text NOT NULL,
  target_version int,
  by_user_id    uuid NOT NULL REFERENCES users(id),
  reason        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  seq           bigserial NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redactions_seq ON redactions(seq);

CREATE TABLE IF NOT EXISTS sync_cursors (
  user_id  uuid NOT NULL REFERENCES users(id),
  stream   text NOT NULL,
  position bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, stream)
);
