-- Credentials for AI assistants using the MCP endpoint (/mcp).
--
-- Kept out of the `documents` table on purpose: the document API cannot read
-- or write these tables, and only hashes of the secrets are stored.

-- OAuth clients that registered themselves (RFC 7591 dynamic registration),
-- e.g. Claude or ChatGPT adding the OKR connector.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text,
  redirect_uris jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Every secret handed out:
--   pat      personal access token, created by a user in their profile
--   code     OAuth authorization code (single use, minutes)
--   access   OAuth access token (an hour)
--   refresh  OAuth refresh token (rotated on every use)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id           text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('pat', 'code', 'access', 'refresh')),
  token_hash   text NOT NULL UNIQUE,
  user_email   text NOT NULL,
  client_id    text REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
  name         text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_email, kind);
CREATE INDEX IF NOT EXISTS auth_tokens_client_idx ON auth_tokens (client_id, user_email);
