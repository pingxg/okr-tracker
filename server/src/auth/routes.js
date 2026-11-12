/**
 * Login routes.
 *
 *   GET  /api/v1/auth/providers   which login methods are enabled
 *   GET  /api/v1/auth/login       start OpenID Connect login (Entra ID)
 *   GET  /api/v1/auth/callback    OIDC redirect target
 *   POST /api/v1/auth/dev-login   email + shared password (dev/test only)
 *   POST /api/v1/auth/logout
 *   GET  /api/v1/auth/me          current identity
 */
import * as oidc from 'openid-client';
import config from '../config.js';
import {
  SESSION_COOKIE,
  cookieOptions,
  createSession,
  decodeSigned,
  encodeSigned,
} from './session.js';
import { actorFromRequest, registerLogin } from './users.js';

const OIDC_COOKIE = 'okr_oidc';
let oidcConfigPromise = null;

const oidcEnabled = () => Boolean(config.oidc.issuer && config.oidc.clientId);

function getOidcConfig() {
  if (!oidcConfigPromise) {
    oidcConfigPromise = oidc
      .discovery(
        new URL(config.oidc.issuer),
        config.oidc.clientId,
        config.oidc.clientSecret || undefined
      )
      .catch((error) => {
        oidcConfigPromise = null;
        throw error;
      });
  }
  return oidcConfigPromise;
}

const callbackUrl = () => `${config.publicUrl}/api/v1/auth/callback`;

/** Only allow redirects back into this app. */
function safeRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
}

export default async function authRoutes(fastify) {
  fastify.get('/api/v1/auth/providers', async () => ({
    microsoft: oidcEnabled(),
    email: Boolean(config.devLoginPassword),
  }));

  fastify.get('/api/v1/auth/login', async (request, reply) => {
    if (!oidcEnabled()) {
      return reply.code(503).send({
        message: 'Single sign-on is not configured (OIDC_ISSUER, OIDC_CLIENT_ID).',
      });
    }
    const conf = await getOidcConfig();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const redirect = safeRedirect(request.query.redirect);

    reply.setCookie(
      OIDC_COOKIE,
      encodeSigned({
        codeVerifier,
        state,
        nonce,
        redirect,
        exp: Date.now() + 10 * 60 * 1000,
      }),
      cookieOptions(600)
    );

    const url = oidc.buildAuthorizationUrl(conf, {
      redirect_uri: callbackUrl(),
      scope: config.oidc.scopes,
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      prompt: 'select_account',
    });
    return reply.redirect(url.href);
  });

  fastify.get('/api/v1/auth/callback', async (request, reply) => {
    const pending = decodeSigned(request.cookies[OIDC_COOKIE]);
    reply.clearCookie(OIDC_COOKIE, { path: '/' });
    if (!pending) {
      return reply.redirect('/login?error=expired');
    }

    const conf = await getOidcConfig();
    const current = new URL(request.url, config.publicUrl);
    let claims;
    try {
      const tokens = await oidc.authorizationCodeGrant(conf, current, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (error) {
      request.log.warn({ err: error }, 'OIDC callback failed');
      return reply.redirect('/login?error=provider');
    }

    const email = String(
      claims.email || claims.preferred_username || claims.upn || ''
    ).toLowerCase();
    if (!email.includes('@')) {
      return reply.redirect('/login?error=provider');
    }

    const name = claims.name || null;
    const oid = claims.oid || claims.sub || null;
    await registerLogin({ email, name, oid, autoCreate: config.autoCreateUsers });

    reply.setCookie(
      SESSION_COOKIE,
      createSession({ email, name, oid, provider: 'oidc' }),
      cookieOptions(config.sessionMaxAgeHours * 3600)
    );
    // The SPA decides what happens next (it shows "not registered" when the
    // person has no tracker user, exactly as before).
    return reply.redirect(`/login?redirectFrom=${encodeURIComponent(pending.redirect)}`);
  });

  fastify.post('/api/v1/auth/dev-login', async (request, reply) => {
    if (!config.devLoginPassword) {
      return reply
        .code(404)
        .send({ message: 'Email login is disabled', code: 'auth/operation-not-allowed' });
    }
    const { email, password } = request.body || {};
    if (typeof email !== 'string' || !email.includes('@')) {
      return reply
        .code(400)
        .send({ message: 'Invalid email', code: 'auth/invalid-email' });
    }
    if (password !== config.devLoginPassword) {
      return reply
        .code(401)
        .send({ message: 'Wrong password', code: 'auth/wrong-password' });
    }
    const normalized = email.toLowerCase();
    await registerLogin({ email: normalized });
    reply.setCookie(
      SESSION_COOKIE,
      createSession({ email: normalized, provider: 'password' }),
      cookieOptions(config.sessionMaxAgeHours * 3600)
    );
    return { email: normalized };
  });

  fastify.post('/api/v1/auth/logout', async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  fastify.get('/api/v1/auth/me', async (request) => {
    const actor = await actorFromRequest(request);
    if (!actor) {
      return { user: null };
    }
    return {
      user: {
        uid: actor.session.oid || actor.email,
        email: actor.email,
        displayName: actor.session.name || actor.doc?.displayName || null,
        registered: Boolean(actor.doc),
        provider: actor.session.provider,
      },
    };
  });
}
