/**
 * Resolve the signed-in person for API v1 requests from the session cookie.
 */
import { sessionFromCookieHeader } from '../../auth/session.js';
import { registerLogin } from '../../auth/users.js';
import { HttpError, unauthorized } from '../../lib/errors.js';
import * as users from '../../services/users.js';

export async function requireActor(request) {
  const session = sessionFromCookieHeader(request.headers.cookie);
  if (!session?.email) {
    throw unauthorized();
  }
  let actor = await users.loadActor(session.email);
  if (!actor) {
    // Signed in before the people table existed: register now, with the same
    // rules as a fresh login.
    const registered = await registerLogin({
      email: session.email,
      name: session.name,
      oid: session.oid,
    });
    if (!registered) {
      throw new HttpError(403, 'not_registered', 'Your account is not registered');
    }
    actor = await users.loadActor(session.email);
  }
  if (actor.status !== 'active') {
    throw new HttpError(403, 'user_inactive', 'Your account has been deactivated');
  }
  return actor;
}
