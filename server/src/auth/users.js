/**
 * Mapping between signed-in identities and tracker users (`users/{email}`).
 */
import config from '../config.js';
import { commit, getDocument, listDocumentIds } from '../store/docstore.js';
import { sessionFromCookieHeader } from './session.js';

// Same defaults as the original UsersCollection / defaultPreferences.
import defaultPreferences from '../functions/util/defaultPreferences.js';

const userPath = (email) => `users/${email.toLowerCase()}`;

/**
 * Called after a successful login. Makes sure a tracker user exists when the
 * person is allowed in automatically, and records the identity-provider id.
 *
 * People are allowed in automatically when they are listed in
 * INITIAL_ADMIN_EMAIL (become super admin), their email domain is in the
 * `domainWhitelist` collection, or `autoCreate` is set (SSO logins when
 * AUTO_CREATE_USERS is on — spec §3: first SSO login creates the account,
 * with no roles).
 * Returns the user document data, or null when the person is not registered.
 */
export async function ensureTrackerUser({ email, name, oid, autoCreate = false }) {
  const normalized = email.toLowerCase();
  const path = userPath(normalized);
  const existing = await getDocument(path);

  if (existing.exists) {
    const patch = {};
    if (oid && existing.data.oid !== oid) {
      patch.oid = oid;
    }
    if (name && !existing.data.displayName) {
      patch.displayName = name;
    }
    if (Object.keys(patch).length) {
      await commit([{ type: 'update', path, data: patch }], { runHooks: false });
    }
    return { ...existing.data, ...patch };
  }

  const isInitialAdmin = config.initialAdminEmails.includes(normalized);
  const domain = normalized.split('@')[1] || '';
  const whitelisted = (await listDocumentIds('domainWhitelist')).some(
    (d) => d.trim() === domain
  );

  if (!isInitialAdmin && !whitelisted && !autoCreate) {
    return null;
  }

  const data = {
    id: normalized,
    email: normalized,
    admin: [],
    superAdmin: isInitialAdmin,
    preferences: defaultPreferences,
    ...(name ? { displayName: name } : {}),
    ...(oid ? { oid } : {}),
  };
  await commit([{ type: 'create', path, data }], { runHooks: false });
  return data;
}

/**
 * Resolve the caller from the request: the session plus the current
 * `users/{email}` document (null if the person is not a tracker user).
 */
export async function actorFromRequest(request) {
  if (request._actor !== undefined) {
    return request._actor;
  }
  const session = sessionFromCookieHeader(request.headers.cookie);
  if (!session?.email) {
    request._actor = null;
    return null;
  }
  const doc = await getDocument(userPath(session.email));
  request._actor = { email: session.email, session, doc: doc.exists ? doc.data : null };
  return request._actor;
}
