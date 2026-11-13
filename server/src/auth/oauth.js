/**
 * OAuth 2.1 for AI assistants connecting to the MCP endpoint (/mcp), as the
 * MCP authorization spec expects:
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728
 *   GET  /.well-known/oauth-authorization-server       RFC 8414
 *   POST /oauth/register                               RFC 7591 (public clients)
 *   GET  /oauth/authorize    sign in with Microsoft (existing login), then consent
 *   POST /oauth/authorize    the consent decision
 *   POST /oauth/token        authorization_code (PKCE S256) and refresh_token
 *
 * The person signs in with the normal Microsoft 365 login (organization
 * members only) and explicitly allows the assistant. The assistant then acts
 * as that person, with exactly their rights.
 */
import crypto from 'node:crypto';
import config from '../config.js';
import pool from '../db/pool.js';
import { decodeSigned, encodeSigned } from './session.js';
import { actorFromRequest } from './users.js';
import { TTL_SECONDS, consumeToken, createToken } from './tokens.js';

export const SCOPE = 'okr';
export const mcpResourceUrl = () => `${config.publicUrl}/mcp`;
export const resourceMetadataUrl = () =>
  `${config.publicUrl}/.well-known/oauth-protected-resource`;

const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

/** https, http on localhost, or an app scheme (e.g. cursor://). */
export function isAllowedRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) {
    return false;
  }
  if (url.protocol === 'https:') {
    return true;
  }
  if (url.protocol === 'http:') {
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  }
  // App schemes (cursor://, vscode://) are fine; script-like schemes are not.
  const blocked = ['data:', 'file:', 'vbscript:', 'blob:', ['java', 'script:'].join('')];
  return !blocked.includes(url.protocol);
}

export const pkceChallenge = (verifier) =>
  crypto.createHash('sha256').update(verifier).digest('base64url');

async function getClient(clientId) {
  if (!clientId) {
    return null;
  }
  const { rows } = await pool.query('SELECT * FROM oauth_clients WHERE client_id = $1', [
    clientId,
  ]);
  return rows[0] || null;
}

function page(reply, status, title, body) {
  return reply
    .code(status)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('X-Frame-Options', 'DENY')
    .header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'"
    ).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | OKR</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f5f5f7; color: #1b1b1f; }
  main { max-width: 30rem; margin: 10vh auto; padding: 2rem; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  img { height: 28px; display: block; margin-bottom: 1.5rem; }
  h1 { font-size: 1.35rem; margin: 0 0 1rem; }
  p, li { line-height: 1.5; }
  ul { padding-left: 1.2rem; }
  .who { color: #555; }
  .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
  button { font: inherit; padding: .65rem 1.25rem; border-radius: 6px; border: 2px solid #1b1b1f; cursor: pointer; }
  .allow { background: #1b1b1f; color: #fff; }
  .deny { background: #fff; color: #1b1b1f; }
</style></head>
<body><main><img src="/logo.png" alt="Spartao">${body}</main></body></html>`);
}

function redirectWith(reply, redirectUri, params) {
  const url = new URL(redirectUri);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  return reply.redirect(url.href);
}

const oauthError = (reply, status, error, description) =>
  reply
    .code(status)
    .header('Cache-Control', 'no-store')
    .send({ error, error_description: description });

export default async function oauthRoutes(fastify) {
  // OAuth posts forms; parse them here only.
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body)))
  );

  // Assistants call discovery, registration and token endpoints from
  // anywhere; they use bearer tokens, never cookies.
  fastify.addHook('onRequest', async (request, reply) => {
    if (
      request.url.startsWith('/.well-known/oauth') ||
      request.url.startsWith('/oauth/register') ||
      request.url.startsWith('/oauth/token')
    ) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, MCP-Protocol-Version'
      );
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
  });

  // CORS preflight. Needs real routes: without one, the request goes to the
  // app's 404 handler, which these hooks do not reach.
  [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/oauth/register',
    '/oauth/token',
  ].forEach((path) =>
    fastify.options(path, async (request, reply) => reply.code(204).send())
  );

  const protectedResource = async () => ({
    resource: mcpResourceUrl(),
    authorization_servers: [config.publicUrl],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'OKR',
  });
  fastify.get('/.well-known/oauth-protected-resource', protectedResource);
  fastify.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

  fastify.get('/.well-known/oauth-authorization-server', async () => ({
    issuer: config.publicUrl,
    authorization_endpoint: `${config.publicUrl}/oauth/authorize`,
    token_endpoint: `${config.publicUrl}/oauth/token`,
    registration_endpoint: `${config.publicUrl}/oauth/register`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }));

  fastify.post('/oauth/register', async (request, reply) => {
    const body = request.body || {};
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (
      !redirectUris.length ||
      redirectUris.length > 10 ||
      !redirectUris.every(isAllowedRedirectUri)
    ) {
      return oauthError(
        reply,
        400,
        'invalid_redirect_uri',
        'Provide valid redirect_uris'
      );
    }
    const clientId = `okr_client_${crypto.randomBytes(16).toString('base64url')}`;
    const clientName = String(body.client_name || '').slice(0, 100) || null;
    await pool.query(
      'INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)',
      [clientId, clientName, JSON.stringify(redirectUris)]
    );
    return reply.code(201).send({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: SCOPE,
    });
  });

  fastify.get('/oauth/authorize', async (request, reply) => {
    const q = request.query || {};
    const client = await getClient(q.client_id);
    // Problems with the client or redirect URI are never redirected back.
    if (!client) {
      return page(
        reply,
        400,
        'Unknown assistant',
        '<h1>Unknown assistant</h1><p>This connection request is not valid. Add the connector again in your AI assistant.</p>'
      );
    }
    if (!client.redirect_uris.includes(q.redirect_uri)) {
      return page(
        reply,
        400,
        'Invalid request',
        '<h1>Invalid request</h1><p>The return address does not match this assistant.</p>'
      );
    }
    if (q.response_type !== 'code') {
      return redirectWith(reply, q.redirect_uri, {
        error: 'unsupported_response_type',
        state: q.state,
      });
    }
    if (
      q.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge || '')
    ) {
      return redirectWith(reply, q.redirect_uri, {
        error: 'invalid_request',
        error_description: 'PKCE with S256 is required',
        state: q.state,
      });
    }

    const actor = await actorFromRequest(request);
    if (!actor) {
      // Normal Microsoft 365 login, then back here.
      return reply.redirect(
        `/api/v1/auth/login?redirect=${encodeURIComponent(request.url)}`
      );
    }
    if (!actor.doc) {
      return page(
        reply,
        403,
        'No access',
        '<h1>No access</h1><p>Your account has no access to OKR yet. Ask a system administrator.</p>'
      );
    }

    const decision = encodeSigned({
      clientId: client.client_id,
      redirectUri: q.redirect_uri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      resource: q.resource ?? null,
      email: actor.email,
      exp: Date.now() + 10 * 60 * 1000,
    });
    const name = escapeHtml(client.client_name || 'An AI assistant');
    return page(
      reply,
      200,
      'Allow access',
      `<h1>Allow ${name} to use OKR as you?</h1>
<p class="who">Signed in as <strong>${escapeHtml(actor.email)}</strong></p>
<p>${name} will be able to do what you can do in OKR, and nothing more:</p>
<ul>
  <li>read organizations, departments, teams, objectives, key results and measurements</li>
  <li>create, edit, archive and assign them, and record progress, where your own rights allow it</li>
</ul>
<p>You can disconnect it at any time in your profile under “AI assistants”.</p>
<form method="post" action="/oauth/authorize">
  <input type="hidden" name="decision" value="${escapeHtml(decision)}">
  <div class="actions">
    <button class="allow" type="submit" name="allow" value="yes">Allow</button>
    <button class="deny" type="submit" name="allow" value="no">Deny</button>
  </div>
</form>`
    );
  });

  fastify.post('/oauth/authorize', async (request, reply) => {
    const pending = decodeSigned(request.body?.decision);
    const actor = await actorFromRequest(request);
    if (
      !pending ||
      pending.exp < Date.now() ||
      !actor?.doc ||
      actor.email !== pending.email
    ) {
      return page(
        reply,
        400,
        'Expired',
        '<h1>This request has expired</h1><p>Start connecting again from your AI assistant.</p>'
      );
    }
    const client = await getClient(pending.clientId);
    if (!client || !client.redirect_uris.includes(pending.redirectUri)) {
      return page(reply, 400, 'Invalid request', '<h1>Invalid request</h1>');
    }
    if (request.body?.allow !== 'yes') {
      return redirectWith(reply, pending.redirectUri, {
        error: 'access_denied',
        state: pending.state,
      });
    }
    const { secret } = await createToken({
      kind: 'code',
      email: actor.email,
      clientId: client.client_id,
      data: {
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        resource: pending.resource,
      },
    });
    return redirectWith(reply, pending.redirectUri, {
      code: secret,
      state: pending.state,
    });
  });

  fastify.post('/oauth/token', async (request, reply) => {
    const body = request.body || {};
    const client = await getClient(body.client_id);
    if (!client) {
      return oauthError(reply, 401, 'invalid_client', 'Unknown client');
    }

    let email;
    if (body.grant_type === 'authorization_code') {
      const code = await consumeToken(body.code, 'code');
      if (
        !code ||
        code.client_id !== client.client_id ||
        code.data.redirectUri !== body.redirect_uri ||
        !body.code_verifier ||
        pkceChallenge(body.code_verifier) !== code.data.codeChallenge
      ) {
        return oauthError(reply, 400, 'invalid_grant', 'Invalid authorization code');
      }
      email = code.user_email;
    } else if (body.grant_type === 'refresh_token') {
      // Refresh tokens rotate: each one works once.
      const refresh = await consumeToken(body.refresh_token, 'refresh');
      if (!refresh || refresh.client_id !== client.client_id) {
        return oauthError(reply, 400, 'invalid_grant', 'Invalid refresh token');
      }
      email = refresh.user_email;
    } else {
      return oauthError(reply, 400, 'unsupported_grant_type', 'Unsupported grant_type');
    }

    const user = await pool.query('SELECT 1 FROM documents WHERE path = $1', [
      `users/${email}`,
    ]);
    if (!user.rowCount) {
      return oauthError(reply, 400, 'invalid_grant', 'The user no longer has access');
    }

    const access = await createToken({
      kind: 'access',
      email,
      clientId: client.client_id,
    });
    const refresh = await createToken({
      kind: 'refresh',
      email,
      clientId: client.client_id,
    });
    return reply.header('Cache-Control', 'no-store').send({
      access_token: access.secret,
      token_type: 'Bearer',
      expires_in: TTL_SECONDS.access,
      refresh_token: refresh.secret,
      scope: SCOPE,
    });
  });
}
