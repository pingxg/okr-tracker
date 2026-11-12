/**
 * Runtime configuration, read from environment variables.
 * See `server/.env.example` for documentation of each variable.
 */
import { fileURLToPath } from 'node:url';

const env = process.env;

const bool = (value, fallback = false) =>
  value === undefined || value === ''
    ? fallback
    : ['1', 'true', 'yes'].includes(String(value).toLowerCase());

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',

  // Public base URL of the app, used for OIDC redirects, e.g. https://okr.spartao.fi
  publicUrl: (env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, ''),

  trustProxyHops: Number(env.TRUST_PROXY_HOPS || 1),

  databaseUrl: env.DATABASE_URL || 'postgres://okr:okr@localhost:5432/okr',
  databaseSsl: bool(env.DATABASE_SSL, false),

  // Secret used to sign session cookies. Must be set in production.
  sessionSecret: env.SESSION_SECRET || 'dev-insecure-session-secret-change-me',
  sessionMaxAgeHours: Number(env.SESSION_MAX_AGE_HOURS || 12),

  // OpenID Connect (Microsoft Entra ID or any other OIDC provider)
  oidc: {
    issuer: env.OIDC_ISSUER || '', // e.g. https://login.microsoftonline.com/<tenant-id>/v2.0
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    scopes: env.OIDC_SCOPES || 'openid profile email',
  },

  // Optional email + password login for local development and test
  // environments. Disabled when DEV_LOGIN_PASSWORD is empty.
  devLoginPassword: env.DEV_LOGIN_PASSWORD || '',

  // Create a tracker user automatically on first SSO login (spec §3). Only
  // safe when the OIDC app is restricted to your own tenant.
  autoCreateUsers: bool(env.AUTO_CREATE_USERS, true),

  // This email becomes super admin on first login (spec §19).
  initialAdminEmails: list(env.INITIAL_ADMIN_EMAIL).map((e) => e.toLowerCase()),

  // Directory with the built frontend (vite build output). Served as static
  // files with SPA fallback when it exists.
  // fileURLToPath, not URL.pathname: the latter gives "/C:/..." on Windows.
  staticDir: env.STATIC_DIR || fileURLToPath(new URL('../../dist', import.meta.url)),

  // Run Firestore-trigger equivalents (audit, slugs, progress) after writes.
  hooksEnabled: bool(env.HOOKS_ENABLED, true),
};

export function assertProductionConfig() {
  if (config.env !== 'production') {
    return;
  }
  if (config.sessionSecret.startsWith('dev-insecure')) {
    throw new Error('SESSION_SECRET must be set in production');
  }
}

export default config;
