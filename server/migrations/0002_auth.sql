-- 0002_auth — the tables Better Auth needs, alongside our domain `users` table.
--
-- Division of labour (SHARED_RESEARCH.md §4): Better Auth owns AUTHENTICATION — identity,
-- sessions, verification tokens. Our own code owns AUTHORIZATION (`users.role`) and the
-- domain link (`users.local_id`). So Better Auth maps onto `users` for the identity columns
-- only; it never reads or writes role/local_id.

-- identity columns Better Auth expects on the user model (mapped in src/auth.ts:
-- name → display_name, emailVerified → email_verified, …)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS session (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);

CREATE TABLE IF NOT EXISTS account (
  id                       text PRIMARY KEY,
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id               text NOT NULL,
  provider_id              text NOT NULL,
  access_token             text,
  refresh_token            text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  id_token                 text,
  password                 text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id         text PRIMARY KEY,
  identifier text NOT NULL,
  value      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);
