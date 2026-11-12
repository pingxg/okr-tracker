/**
 * Connection to the Node backend (replaces the former Firebase configuration).
 * `db` and `auth` keep the shapes the rest of the app expects.
 */
import { db } from '@/backend/firestore';
import { auth, GoogleAuthProvider, OAuthProvider } from '@/backend/auth';

const loginProviderMS = new OAuthProvider('microsoft.com');
const loginProviderGoogle = new GoogleAuthProvider();

export { auth, db, loginProviderGoogle, loginProviderMS };
