/**
 * Low-level client for the Node backend: JSON requests and live change events.
 */

const API = '/api/v1';

export class BackendError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code || (status === 403 ? 'permission-denied' : 'unknown');
  }
}

export async function request(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw new BackendError(json?.message || res.statusText, res.status, json?.code);
  }
  return json;
}

// --- live updates ---------------------------------------------------------------

const bindings = new Set();
let source = null;
let enabled = false;

function dispatch(change) {
  for (const binding of bindings) {
    if (binding.collections.has(change.c) || binding.docs.has(change.p)) {
      binding.schedule();
    }
  }
}

function open() {
  if (source || !enabled || typeof EventSource === 'undefined') {
    return;
  }
  source = new EventSource(`${API}/realtime`, { withCredentials: true });
  let opened = false;
  source.addEventListener('change', (event) => {
    try {
      dispatch(JSON.parse(event.data));
    } catch {
      /* ignore */
    }
  });
  // The server lost changes (its database listener reconnected): refresh all.
  source.addEventListener('resync', () => {
    bindings.forEach((b) => b.schedule());
  });
  source.addEventListener('open', () => {
    // After a reconnect we may have missed events: refresh everything.
    if (opened) {
      bindings.forEach((b) => b.schedule());
    }
    opened = true;
  });
}

function close() {
  if (source) {
    source.close();
    source = null;
  }
}

/** Turn live updates on (signed in) or off (signed out). */
export function setLiveUpdates(on) {
  enabled = on;
  if (on) {
    open();
  } else {
    close();
  }
}

/**
 * Register a binding that wants to be refreshed when documents change.
 * `refresh` is called (debounced) when a change touches one of the
 * collections or documents the binding currently depends on.
 */
export function subscribe(refresh) {
  let timer = null;
  const binding = {
    collections: new Set(),
    docs: new Set(),
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(refresh, 80);
    },
    setDeps({ collections = [], docs = [] }) {
      binding.collections = new Set(collections);
      binding.docs = new Set(docs);
    },
    stop() {
      clearTimeout(timer);
      bindings.delete(binding);
    },
  };
  bindings.add(binding);
  open();
  return binding;
}
