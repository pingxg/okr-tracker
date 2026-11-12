/**
 * Drop-in replacement for the parts of VueFire this app uses: `useDocument`,
 * `useCollection`, `useCurrentUser`, `getCurrentUser`, the global options and
 * the default converter.
 *
 * Bindings fetch from the Node API with server-side reference resolution
 * (`maxRefDepth`) and refresh themselves when the server reports changes to
 * the documents they depend on (see ./client.js), which replaces Firestore's
 * real-time listeners.
 */
import {
  getCurrentScope,
  isRef,
  onScopeDispose,
  ref,
  shallowRef,
  unref,
  watch,
} from 'vue';
import Timestamp from '../../common/docstore/timestamp.js';
import {
  DOC,
  REF,
  TS,
  collectionOf,
  isPlainObject,
  isTaggedRef,
  isTaggedTimestamp,
} from '../../common/docstore/encoding.js';
import { subscribe } from './client';
import {
  DocumentReference,
  DocumentSnapshot,
  Query,
  fetchDocument,
  fetchQuery,
} from './firestore';
import { authUser, waitForAuth } from './auth';

export const firestoreDefaultConverter = {
  toFirestore(data) {
    return data;
  },
  fromFirestore(snapshot, options) {
    const data = snapshot.data(options);
    if (!data) {
      return data;
    }
    Object.defineProperty(data, 'id', {
      value: snapshot.id,
      enumerable: false,
      configurable: true,
    });
    return data;
  },
};

export const globalFirestoreOptions = {
  maxRefDepth: 2,
  wait: true,
  reset: false,
  converter: firestoreDefaultConverter,
};

/**
 * Decode wire data for bound documents: resolved references become converted
 * documents (or null when missing), unresolved references become path strings
 * like VueFire does beyond `maxRefDepth`, timestamps become Timestamp.
 */
function decodeBound(value, converter) {
  if (value === null || value === undefined) {
    return value;
  }
  if (isTaggedTimestamp(value)) {
    return Timestamp.fromISOString(value[TS]);
  }
  if (isTaggedRef(value)) {
    return value[REF];
  }
  if (isPlainObject(value) && isPlainObject(value[DOC])) {
    const d = value[DOC];
    return d.exists ? toBoundObject(d.path, d.data, converter, null) : null;
  }
  if (Array.isArray(value)) {
    return value.map((v) => decodeBound(v, converter));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = decodeBound(v, converter);
    }
    return out;
  }
  return value;
}

function toBoundObject(path, wireData, converter, ownConverter) {
  const snapshot = new DocumentSnapshot(new DocumentReference(path), wireData, (w) =>
    decodeBound(w, converter)
  );
  return (ownConverter || converter).fromFirestore(snapshot);
}

function resolveSource(source) {
  const value = typeof source === 'function' ? source() : unref(source);
  return value || null;
}

function sourceKey(target) {
  if (!target) {
    return '';
  }
  if (target instanceof DocumentReference) {
    return `doc:${target.path}`;
  }
  return `query:${target._collectionPath}:${JSON.stringify(target._constraints, (k, v) =>
    v instanceof DocumentReference ? `ref:${v.path}` : v
  )}`;
}

function createBinding(source, options, kind) {
  const opts = { ...globalFirestoreOptions, ...options };
  const converter = opts.converter || firestoreDefaultConverter;
  const initial = kind === 'collection' ? [] : undefined;

  const data = isRef(opts.target) ? opts.target : ref(initial);
  const pending = ref(true);
  const error = ref(null);
  const promise = shallowRef(Promise.resolve(initial));

  let currentKey = null;
  let currentTarget = null;
  let requestId = 0;

  const live = subscribe(() => {
    if (currentTarget) {
      load(currentTarget, true);
    }
  });

  async function load(target, isRefresh = false) {
    requestId += 1;
    const id = requestId;
    const depth = Math.max(0, Number(opts.maxRefDepth) || 0);
    try {
      if (target instanceof DocumentReference) {
        await waitForAuth();
        const res = await fetchDocument(target.path, depth);
        if (id !== requestId) {
          return data.value;
        }
        data.value = res.doc.exists
          ? toBoundObject(res.doc.path, res.doc.data, converter, target.converter)
          : null;
        live.setDeps({ collections: [], docs: [target.path, ...res.deps] });
      } else if (target instanceof Query) {
        await waitForAuth();
        const res = await fetchQuery(target, depth);
        if (id !== requestId) {
          return data.value;
        }
        data.value = res.docs.map((d) =>
          toBoundObject(d.path, d.data, converter, target.converter)
        );
        live.setDeps({ collections: [target._collectionPath], docs: res.deps });
      }
      error.value = null;
    } catch (e) {
      if (id === requestId) {
        error.value = e;
        if (!isRefresh) {
          console.error('Could not load data', e);
        }
      }
    } finally {
      if (id === requestId) {
        pending.value = false;
      }
    }
    return data.value;
  }

  function bind(target) {
    const key = sourceKey(target);
    if (key === currentKey) {
      return;
    }
    currentKey = key;
    currentTarget = target;

    if (!target) {
      requestId += 1;
      live.setDeps({});
      if (opts.reset) {
        data.value = kind === 'collection' ? [] : null;
      }
      pending.value = false;
      promise.value = Promise.resolve(data.value);
      return;
    }

    if (!opts.wait) {
      data.value = initial;
    }
    pending.value = true;
    promise.value = load(target);
  }

  // Synchronous so that the returned promise is replaced as soon as the source
  // changes (the router guard awaits it right after sign-in).
  const stopWatch = watch(() => resolveSource(source), bind, {
    immediate: true,
    flush: 'sync',
  });

  function stop() {
    stopWatch();
    live.stop();
  }

  if (getCurrentScope()) {
    onScopeDispose(stop);
  }

  Object.defineProperties(data, {
    data: { get: () => data, configurable: true },
    pending: { get: () => pending, configurable: true },
    error: { get: () => error, configurable: true },
    promise: { get: () => promise, configurable: true },
    stop: { get: () => stop, configurable: true },
  });

  return data;
}

export function useDocument(source, options = {}) {
  return createBinding(source, options, 'document');
}

export function useCollection(source, options = {}) {
  return createBinding(source, options, 'collection');
}

export function useCurrentUser() {
  return authUser;
}

export async function getCurrentUser() {
  await waitForAuth();
  return authUser.value;
}

/** Plugin kept for compatibility with `app.use(VueFire, …)`. */
export const VueFire = {
  install() {},
};

export function VueFireAuthOptionsFromAuth() {
  return () => {};
}

// Re-export for code that imported collection helpers alongside VueFire.
export { collectionOf };
