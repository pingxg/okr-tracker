/**
 * Sign-in for the Node backend, replacing Firebase Auth.
 *
 * The server owns the session (httpOnly cookie). The browser only learns who
 * is signed in from GET /api/v1/auth/me. Microsoft (Entra ID) sign-in is a
 * full-page redirect handled by the server; email + password is only
 * available when the server enables it for development and test.
 */
import { ref } from 'vue';
import { request, setLiveUpdates } from './client';

/** Reactive current identity (null when signed out). */
export const authUser = ref(null);

/** Login methods the server has enabled: { microsoft, email } */
export const authProviders = ref({ microsoft: false, email: false });

const listeners = new Set();

function makeUser(user) {
  if (!user) {
    return null;
  }
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || null,
    // Kept for code that used Firebase ID tokens; the session cookie is used instead.
    getIdToken: async () => '',
  };
}

function setUser(user) {
  authUser.value = makeUser(user);
  auth.currentUser = authUser.value;
  setLiveUpdates(Boolean(authUser.value));
  listeners.forEach((cb) => cb(auth.currentUser));
}

export const auth = {
  currentUser: null,
  onAuthStateChanged(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  async signOut() {
    try {
      await request('/auth/logout');
    } finally {
      setUser(null);
    }
  },
};

let ready = null;

/** Load the current session once; resolves when the auth state is known. */
export function waitForAuth() {
  if (!ready) {
    ready = Promise.all([
      request('/auth/me', { method: 'GET' }).catch(() => ({ user: null })),
      request('/auth/providers', { method: 'GET' }).catch(() => null),
    ]).then(([me, providers]) => {
      if (providers) {
        authProviders.value = providers;
      }
      setUser(me?.user || null);
    });
  }
  return ready;
}

export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/** Provider identifiers used by the login page. */
export class OAuthProvider {
  constructor(providerId) {
    this.providerId = providerId;
  }

  setCustomParameters() {}
}

export class GoogleAuthProvider extends OAuthProvider {
  constructor() {
    super('google.com');
  }
}

/**
 * Same name as the Firebase function so the auth store is unchanged. A popup
 * is not needed: the browser is sent to the server, which redirects to Entra
 * ID and back to /login, where the app continues as signed in.
 */
export function signInWithPopup(_auth, provider) {
  if (provider?.providerId !== 'microsoft.com') {
    return Promise.reject(new AuthError('auth/operation-not-allowed'));
  }
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirectFrom') || '/';
  window.location.assign(`/api/v1/auth/login?redirect=${encodeURIComponent(redirect)}`);
  // Never resolves: the page is navigating away.
  return new Promise(() => {});
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  try {
    await request('/auth/dev-login', { body: { email, password } });
  } catch (error) {
    if (error.status === 401) {
      throw new AuthError('auth/wrong-password');
    }
    if (error.status === 404) {
      throw new AuthError('auth/operation-not-allowed');
    }
    throw new AuthError('auth/internal-error', error.message);
  }
  const me = await request('/auth/me', { method: 'GET' });
  setUser(me.user);
  return { user: auth.currentUser };
}
