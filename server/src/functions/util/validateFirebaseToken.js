import { sessionFromCookieHeader } from '../../auth/session.js';

/**
 * Originally verified a Firebase ID token. Now checks the server's own signed
 * session cookie and exposes the signed-in user as `req.user` ({ email, … }),
 * so the routes that use it are unchanged.
 */
const validateFirebaseIdToken = async (req, res, next) => {
  const session = sessionFromCookieHeader(req.headers.cookie);

  // Only Microsoft sign-in sessions; see actorFromRequest.
  if (!session?.email || session.provider !== 'oidc') {
    return res.status(403).send(JSON.stringify({ message: 'Unauthorized' }));
  }

  req.user = session;
  return next();
};

export default validateFirebaseIdToken;
