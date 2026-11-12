/**
 * Wire and storage encoding for document data.
 *
 * Documents are stored in Postgres as JSONB and sent over HTTP as JSON. The
 * original Firestore data model has a few value types that plain JSON cannot
 * express, so they are encoded as tagged objects:
 *
 *   { "__ref": "organizations/abc" }            document reference
 *   { "__ts": "2026-11-12T10:00:00.000Z" }       timestamp (always UTC ISO)
 *   { "__doc": { path, id, exists, data } }      resolved reference (read API only)
 *   { "__op": "serverTimestamp" }                write transform
 *   { "__op": "delete" }                         write transform (delete field)
 *   { "__op": "arrayUnion", "values": [...] }    write transform
 *   { "__op": "arrayRemove", "values": [...] }   write transform
 *   { "__op": "increment", "by": 1 }             write transform
 *
 * Timestamps are always serialised with `toISOString()`, so they sort
 * correctly as strings, and JSONB comparison of two `__ts` objects compares
 * their inner strings.
 *
 * This module has no dependencies and is shared by the browser and the server.
 */

export const REF = '__ref';
export const TS = '__ts';
export const DOC = '__doc';
export const OP = '__op';

export const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype;

export const isTaggedRef = (value) =>
  isPlainObject(value) &&
  typeof value[REF] === 'string' &&
  Object.keys(value).length === 1;

export const isTaggedTimestamp = (value) =>
  isPlainObject(value) &&
  typeof value[TS] === 'string' &&
  Object.keys(value).length === 1;

export const isTaggedDoc = (value) => isPlainObject(value) && isPlainObject(value[DOC]);

export const isTaggedOp = (value) =>
  isPlainObject(value) && typeof value[OP] === 'string';

export const tagRef = (path) => ({ [REF]: path });
export const tagTimestamp = (date) => ({ [TS]: new Date(date).toISOString() });

/**
 * Normalise a slash separated path: no leading/trailing slashes, no empty
 * segments.
 */
export function normalizePath(path) {
  return String(path)
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/');
}

export function pathSegments(path) {
  return normalizePath(path).split('/').filter(Boolean);
}

export function isDocumentPath(path) {
  const n = pathSegments(path).length;
  return n > 0 && n % 2 === 0;
}

export function isCollectionPath(path) {
  return pathSegments(path).length % 2 === 1;
}

/** `keyResults/abc/progress/xyz` -> `keyResults/abc/progress` */
export function collectionOf(documentPath) {
  const segments = pathSegments(documentPath);
  return segments.slice(0, -1).join('/');
}

/** `keyResults/abc/progress/xyz` -> `xyz` */
export function idOf(documentPath) {
  const segments = pathSegments(documentPath);
  return segments[segments.length - 1];
}

/**
 * Collection "group" pattern used for rules and hooks:
 * `keyResults/abc/progress` -> `keyResults/*\/progress`
 */
export function collectionPattern(collectionPath) {
  return pathSegments(collectionPath)
    .map((segment, i) => (i % 2 === 1 ? '*' : segment))
    .join('/');
}

/**
 * Generate a 20 character Firestore style auto ID.
 */
export function autoId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  // eslint-disable-next-line no-undef
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < bytes.length; i += 1) {
    id += chars.charAt(bytes[i] % chars.length);
  }
  return id;
}
