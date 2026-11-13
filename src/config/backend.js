/**
 * Connection to the Node backend (replaces the former Firebase configuration).
 * `db` and `auth` keep the shapes the rest of the app expects.
 */
import { db } from '@/backend/firestore';
import { auth, OAuthProvider } from '@/backend/auth';

// Microsoft 365 (Entra ID) is the only sign-in method.
const loginProviderMS = new OAuthProvider('microsoft.com');

export { auth, db, loginProviderMS };
