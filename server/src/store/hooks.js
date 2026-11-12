/**
 * Registry for document triggers — the Postgres-backed equivalent of
 * Firestore Cloud Function triggers (onCreate / onUpdate / onDelete / onWrite).
 *
 * Handlers are registered with a document path pattern such as
 * `keyResults/{keyResultId}/progress/{documentId}` and are called after a
 * write has been committed, with the same arguments Cloud Functions v1 used:
 *   onCreate(snapshot, context)   onDelete(snapshot, context)
 *   onUpdate(change, context)     onWrite(change, context)
 * where `change = { before, after }` are document snapshots.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { pathSegments } from '../../../common/docstore/encoding.js';

const MAX_DEPTH = 8;
const depthStorage = new AsyncLocalStorage();

const registry = [];

function compile(pattern) {
  const segments = pathSegments(pattern);
  return (path) => {
    const parts = pathSegments(path);
    if (parts.length !== segments.length) {
      return null;
    }
    const params = {};
    for (let i = 0; i < segments.length; i += 1) {
      const s = segments[i];
      const m = /^\{(\w+)\}$/.exec(s);
      if (m) {
        params[m[1]] = parts[i];
      } else if (s !== parts[i]) {
        return null;
      }
    }
    return params;
  };
}

export function registerTrigger(pattern, event, handler, name = '') {
  registry.push({ pattern, match: compile(pattern), event, handler, name });
}

export function listTriggers() {
  return registry.map(({ pattern, event, name }) => ({ pattern, event, name }));
}

/**
 * Dispatch a committed change to matching triggers.
 *
 * @param {{path: string, before: object|null, after: object|null}} change tagged data
 * @param {(path: string, data: object|null) => any} makeSnapshot builds a document snapshot
 */
export async function dispatch(change, makeSnapshot) {
  const depth = depthStorage.getStore() || 0;
  if (depth >= MAX_DEPTH) {
    console.warn(
      `Trigger depth limit reached at ${change.path}; not dispatching further`
    );
    return;
  }

  let kind = 'update';
  if (!change.before) {
    kind = 'create';
  } else if (!change.after) {
    kind = 'delete';
  }

  for (const t of registry) {
    const params = t.match(change.path);
    if (!params) {
      continue;
    }
    if (!(t.event === 'write' || t.event === kind)) {
      continue;
    }

    const before = makeSnapshot(change.path, change.before);
    const after = makeSnapshot(change.path, change.after);
    const context = { params, eventType: kind, timestamp: new Date().toISOString() };

    let arg;
    if (t.event === 'create') {
      arg = after;
    } else if (t.event === 'delete') {
      arg = before;
    } else {
      arg = { before, after };
    }

    try {
      await depthStorage.run(depth + 1, () => t.handler(arg, context));
    } catch (error) {
      console.error(
        `Trigger ${t.name || t.pattern} (${t.event}) failed for ${change.path}:`,
        error
      );
    }
  }
}
