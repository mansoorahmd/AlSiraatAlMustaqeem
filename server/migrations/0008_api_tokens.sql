-- 0008_api_tokens — personal API tokens, so headless clients (the MCP) can act as their user.
--
-- The MCP is launched by an AI client with no browser, so it can't sign in with a cookie. A user
-- mints a named token in the app and pastes it into their MCP config; the MCP sends it as
-- `Authorization: Bearer mqrg_…` and carries exactly that user's role and plan — no more.
--
-- Only a SHA-256 hash is stored; the token itself is shown once, at creation. `prefix` (the first
-- characters) lets a user tell their tokens apart. Revoking sets revoked_at — the row is kept so
-- "last used" history survives. Deleting the user deletes their tokens.

CREATE TABLE IF NOT EXISTS api_tokens (
  id           text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT '',
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
