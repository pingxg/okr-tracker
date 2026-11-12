/**
 * Stateless signed session cookies (HMAC-SHA256). The browser only ever holds
 * this httpOnly cookie; identity-provider tokens never leave the server.
 */
import crypto from 'node:crypto';
import config from '../config.js';

export const SESSION_COOKIE = 'okr_session';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(value) {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(value)
    .digest('base64url');
}

export function encodeSigned(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function decodeSigned(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return null;
  }
  const [body, signature] = token.split('.');
  const expected = sign(body);
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createSession({ email, name, oid, provider }) {
  const now = Date.now();
  return encodeSigned({
    email: email.toLowerCase(),
    name: name || null,
    oid: oid || null,
    provider,
    iat: now,
    exp: now + config.sessionMaxAgeHours * 3600 * 1000,
  });
}

export function cookieOptions(maxAgeSeconds) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https://'),
    maxAge: maxAgeSeconds,
  };
}

/** Parse the session from a raw Cookie header (usable from Express too). */
export function sessionFromCookieHeader(header) {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      return decodeSigned(decodeURIComponent(rest.join('=')));
    }
  }
  return null;
}
