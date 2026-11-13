-- Confidential OAuth clients: assistants that register with
-- client_secret_post / client_secret_basic get a secret (stored hashed).
-- Public clients ('none') keep relying on PKCE alone.
ALTER TABLE oauth_clients
  ADD COLUMN IF NOT EXISTS token_endpoint_auth_method text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS client_secret_hash text;
