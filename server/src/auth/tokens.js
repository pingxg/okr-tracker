/**
 * Secrets for AI assistants (MCP): personal access tokens and OAuth codes,
 * access tokens and refresh tokens. Only SHA-256 hashes are stored
 * (table `auth_tokens`, migration 002); a secret is shown once, when created.
 *
 * Whatever the token, the caller acts as the user it belongs to and every
 * read and write goes through the same policy as the web app.
 */
import crypto from 'node:crypto';
import pool from '../db/pool.js';
import { getDocument } from '../store/docstore.js';

export const PREFIX = {
  pat: 'okr_pat_',
  code: 'okr_code_',
  access: 'okr_at_',
  refresh: 'okr_rt_',
};

export const TTL_SECONDS = {
  code: 10 * 60,
  access: 60 * 60,
  refresh: 30 * 24 * 60 * 60,
};

export const MAX_PATS_PER_USER = 20;

export const hashSecret = (secret) =>
  crypto.createHash('sha256').update(String(secret)).digest('hex');

const randomId = () => crypto.randomBytes(12).toString('base64url');

/** Create a token; returns { id, secret, expiresAt }. */
export async function createToken({
  kind,
  email,
  clientId = null,
  name = null,
  data = {},
  ttlSeconds = TTL_SECONDS[kind] ?? null,
}) {
  const id = randomId();
  const secret = `${PREFIX[kind]}${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;
  await pool.query(
    `INSERT INTO auth_tokens (id, kind, token_hash, user_email, client_id, name, data, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, kind, hashSecret(secret), email.toLowerCase(), clientId, name, data, expiresAt]
  );
  return { id, secret, expiresAt };
}

const kindOf = (secret) =>
  Object.entries(PREFIX).find(([, prefix]) => String(secret).startsWith(prefix))?.[0];

/** A valid (not revoked, not expired) token of one of `kinds`, or null. */
export async function findToken(secret, kinds) {
  const kind = kindOf(secret);
  if (!secret || !kind || !kinds.includes(kind)) {
    return null;
  }
  const { rows } = await pool.query(
    `UPDATE auth_tokens SET last_used_at = now()
     WHERE token_hash = $1 AND kind = $2 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING *`,
    [hashSecret(secret), kind]
  );
  return rows[0] || null;
}

/**
 * Use a single-use secret (authorization code, refresh token): revoke it and
 * return it, or null when it was already used, revoked or expired.
 */
export async function consumeToken(secret, kind) {
  if (kindOf(secret) !== kind) {
    return null;
  }
  const { rows } = await pool.query(
    `UPDATE auth_tokens SET revoked_at = now(), last_used_at = now()
     WHERE token_hash = $1 AND kind = $2 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING *`,
    [hashSecret(secret), kind]
  );
  return rows[0] || null;
}

/** Revoke all OAuth tokens of a user for one assistant (client). */
export async function revokeClientGrant(email, clientId) {
  const { rowCount } = await pool.query(
    `UPDATE auth_tokens SET revoked_at = now()
     WHERE user_email = $1 AND client_id = $2 AND revoked_at IS NULL`,
    [email.toLowerCase(), clientId]
  );
  return rowCount;
}

/** Revoke one personal access token of a user. */
export async function revokePat(email, id) {
  const { rowCount } = await pool.query(
    `UPDATE auth_tokens SET revoked_at = now()
     WHERE id = $1 AND user_email = $2 AND kind = 'pat' AND revoked_at IS NULL`,
    [id, email.toLowerCase()]
  );
  return rowCount > 0;
}

/** Active personal tokens and connected assistants of a user. */
export async function listCredentials(email) {
  const normalized = email.toLowerCase();
  const pats = await pool.query(
    `SELECT id, name, created_at, last_used_at, expires_at FROM auth_tokens
     WHERE user_email = $1 AND kind = 'pat' AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC`,
    [normalized]
  );
  const grants = await pool.query(
    `SELECT t.client_id, c.client_name, min(t.created_at) AS created_at,
            max(t.last_used_at) AS last_used_at
     FROM auth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
     WHERE t.user_email = $1 AND t.kind = 'refresh' AND t.revoked_at IS NULL
       AND t.expires_at > now()
     GROUP BY t.client_id, c.client_name
     ORDER BY max(t.last_used_at) DESC NULLS LAST`,
    [normalized]
  );
  return {
    tokens: pats.rows.map((r) => ({
      id: r.id,
      name: r.name,
      created: r.created_at,
      lastUsed: r.last_used_at,
      expires: r.expires_at,
    })),
    assistants: grants.rows.map((r) => ({
      clientId: r.client_id,
      name: r.client_name || r.client_id,
      created: r.created_at,
      lastUsed: r.last_used_at,
    })),
  };
}

export async function countActivePats(email) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM auth_tokens
     WHERE user_email = $1 AND kind = 'pat' AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [email.toLowerCase()]
  );
  return rows[0].n;
}

/**
 * Resolve `Authorization: Bearer <token>` (personal or OAuth access token)
 * to an actor like the web session does: { email, session, doc }, where
 * `doc` is the current users/{email} document. Rights are read fresh on every
 * request, so a change in Admin applies to assistants immediately.
 * Returns null when the token is missing, invalid or the user is gone.
 */
export async function actorFromBearer(request) {
  const header = request.headers.authorization || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return null;
  }
  const token = await findToken(match[1], ['pat', 'access']);
  if (!token) {
    return null;
  }
  const doc = await getDocument(`users/${token.user_email}`);
  if (!doc.exists) {
    return null;
  }
  return {
    email: token.user_email,
    session: {
      email: token.user_email,
      name: doc.data.displayName || null,
      provider: token.kind === 'pat' ? 'token' : 'oauth',
      clientId: token.client_id,
    },
    doc: doc.data,
  };
}
