/**
 * Apply create / set / update payloads (wire encoded, possibly containing
 * `__op` transforms) to stored document data.
 */
import { isPlainObject, isTaggedOp, OP, TS } from '../../../common/docstore/encoding.js';

export class WriteError extends Error {
  constructor(message, statusCode = 400, code = 'invalid-argument') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Stable stringify used for deep equality of JSON values. */
export function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const deepEqual = (a, b) => canonical(a) === canonical(b);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * Resolve an `__op` against the current value. Returns `undefined` to signal
 * "delete this field".
 */
function applyOp(op, current, now) {
  switch (op[OP]) {
    case 'serverTimestamp':
      return { [TS]: now };
    case 'delete':
      return undefined;
    case 'arrayUnion': {
      const base = Array.isArray(current) ? [...current] : [];
      for (const v of op.values || []) {
        const resolved = resolveValue(v, now);
        if (!base.some((x) => deepEqual(x, resolved))) {
          base.push(resolved);
        }
      }
      return base;
    }
    case 'arrayRemove': {
      const base = Array.isArray(current) ? current : [];
      const remove = (op.values || []).map((v) => resolveValue(v, now));
      return base.filter((x) => !remove.some((r) => deepEqual(x, r)));
    }
    case 'increment': {
      const by = Number(op.by);
      if (!Number.isFinite(by)) {
        throw new WriteError('Invalid increment');
      }
      return (typeof current === 'number' ? current : 0) + by;
    }
    default:
      throw new WriteError(`Unknown transform ${op[OP]}`);
  }
}

/** Resolve transforms inside a value that is written as a whole. */
function resolveValue(value, now) {
  if (isTaggedOp(value)) {
    return applyOp(value, undefined, now);
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, now));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = resolveValue(v, now);
      if (r !== undefined) {
        out[k] = r;
      }
    }
    return out;
  }
  return value;
}

function validateKeys(data) {
  if (!isPlainObject(data)) {
    throw new WriteError('Document data must be an object');
  }
  for (const key of Object.keys(data)) {
    if (!key.length || key.length > 1500 || key.startsWith('__')) {
      throw new WriteError(`Invalid field name: ${key}`);
    }
  }
}

/** Deep merge for `set(..., { merge: true })`. */
function mergeInto(target, patch, now) {
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (isTaggedOp(value)) {
      const r = applyOp(value, out[key], now);
      if (r === undefined) {
        delete out[key];
      } else {
        out[key] = r;
      }
    } else if (isPlainObject(value) && !('__ref' in value) && !('__ts' in value)) {
      out[key] = mergeInto(out[key], value, now);
    } else {
      out[key] = resolveValue(value, now);
    }
  }
  return out;
}

/** Set a dot-separated field path for `update()`. */
function setPath(target, fieldPath, value, now) {
  const segments = fieldPath.split('.');
  let node = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const s = segments[i];
    if (!isPlainObject(node[s])) {
      node[s] = {};
    }
    node = node[s];
  }
  const last = segments[segments.length - 1];
  const resolved = isTaggedOp(value)
    ? applyOp(value, node[last], now)
    : resolveValue(value, now);
  if (resolved === undefined) {
    delete node[last];
  } else {
    node[last] = resolved;
  }
}

/**
 * @param {object|null} before  current stored data (null if missing)
 * @param {{type: string, data?: object, merge?: boolean}} op
 * @param {string} now ISO timestamp used for serverTimestamp()
 * @returns {object|null} data after the write (null for delete)
 */
export function applyWrite(before, op, now = new Date().toISOString()) {
  switch (op.type) {
    case 'create':
      if (before) {
        throw new WriteError('Document already exists', 409, 'already-exists');
      }
      validateKeys(op.data);
      return resolveValue(op.data, now);
    case 'set':
      validateKeys(op.data);
      return op.merge
        ? mergeInto(clone(before) || {}, op.data, now)
        : resolveValue(op.data, now);
    case 'update': {
      if (!before) {
        throw new WriteError('No document to update', 404, 'not-found');
      }
      validateKeys(op.data);
      const after = clone(before);
      for (const [fieldPath, value] of Object.entries(op.data)) {
        setPath(after, fieldPath, value, now);
      }
      return after;
    }
    case 'delete':
      return null;
    default:
      throw new WriteError(`Unknown write type ${op.type}`);
  }
}
