/**
 * Drop-in replacement for the subset of the `firebase/firestore` web SDK this
 * app uses, backed by the Node API (/api/v1/docs/*) instead of Google.
 *
 * It keeps the same function names and value types (DocumentReference,
 * Timestamp, snapshots, write transforms) so the existing data layer and
 * components work unchanged. Live updates are handled in ./vuefire.js.
 */
import Timestamp from '../../common/docstore/timestamp.js';
import {
  DOC,
  OP,
  REF,
  TS,
  autoId,
  collectionOf,
  idOf,
  isPlainObject,
  isTaggedRef,
  isTaggedTimestamp,
  normalizePath,
  pathSegments,
} from '../../common/docstore/encoding.js';
import { request } from './client';

export { Timestamp };

// --- references ---------------------------------------------------------------

class Firestore {
  constructor() {
    this.type = 'firestore';
  }
}

export const db = new Firestore();

export function getFirestore() {
  return db;
}

export function connectFirestoreEmulator() {}

export class Query {
  constructor(collectionPath, constraints = [], converter = null) {
    this.type = 'query';
    this._collectionPath = collectionPath;
    this._constraints = constraints;
    this.converter = converter;
    this.firestore = db;
  }

  withConverter(converter) {
    return new Query(this._collectionPath, this._constraints, converter);
  }
}

export class DocumentReference {
  constructor(path, converter = null) {
    this.type = 'document';
    this.path = path;
    this.id = idOf(path);
    this.converter = converter;
    this.firestore = db;
  }

  get parent() {
    return new CollectionReference(collectionOf(this.path));
  }

  withConverter(converter) {
    return new DocumentReference(this.path, converter);
  }

  isEqual(other) {
    return other instanceof DocumentReference && other.path === this.path;
  }

  toJSON() {
    return { [REF]: this.path };
  }
}

export class CollectionReference extends Query {
  constructor(path, converter = null) {
    super(path, [], converter);
    this.type = 'collection';
    this.path = path;
    this.id = idOf(path);
  }

  get parent() {
    const segments = pathSegments(this.path);
    return segments.length > 1
      ? new DocumentReference(segments.slice(0, -1).join('/'))
      : null;
  }

  withConverter(converter) {
    return new CollectionReference(this.path, converter);
  }
}

function basePath(parent) {
  if (!parent || parent instanceof Firestore) {
    return '';
  }
  if (typeof parent.path === 'string') {
    return parent.path;
  }
  throw new Error('Invalid parent for path');
}

function joinPath(parent, segments) {
  return normalizePath(
    [basePath(parent), ...segments.map(String)].filter(Boolean).join('/')
  );
}

export function collection(parent, ...segments) {
  const path = joinPath(parent, segments);
  if (pathSegments(path).length % 2 !== 1) {
    throw new Error(`Invalid collection path: ${path}`);
  }
  return new CollectionReference(path);
}

export function doc(parent, ...segments) {
  let path = joinPath(parent, segments);
  if (pathSegments(path).length % 2 === 1) {
    path = `${path}/${autoId()}`;
  }
  if (!path || pathSegments(path).length % 2 !== 0) {
    throw new Error(`Invalid document path: ${path}`);
  }
  return new DocumentReference(
    path,
    parent instanceof CollectionReference ? parent.converter : null
  );
}

// --- query constraints ----------------------------------------------------------

export const where = (field, op, value) => ({
  type: 'where',
  field: String(field),
  op,
  value,
});
export const orderBy = (field, direction = 'asc') => ({
  type: 'orderBy',
  field: String(field),
  direction,
});
export const limit = (n) => ({ type: 'limit', limit: n });

export function query(base, ...constraints) {
  return new Query(
    base._collectionPath,
    [...base._constraints, ...constraints],
    base.converter
  );
}

// --- field values ---------------------------------------------------------------

class FieldValue {
  constructor(tagged) {
    this._tagged = tagged;
    this._methodName = tagged[OP];
  }

  isEqual(other) {
    return (
      other instanceof FieldValue &&
      JSON.stringify(other._tagged) === JSON.stringify(this._tagged)
    );
  }
}

export const serverTimestamp = () => new FieldValue({ [OP]: 'serverTimestamp' });
export const deleteField = () => new FieldValue({ [OP]: 'delete' });
export const arrayUnion = (...values) =>
  new FieldValue({ [OP]: 'arrayUnion', values: values.map(encode) });
export const arrayRemove = (...values) =>
  new FieldValue({ [OP]: 'arrayRemove', values: values.map(encode) });
export const increment = (by) => new FieldValue({ [OP]: 'increment', by });

// --- encoding -------------------------------------------------------------------

/** App value -> wire encoding */
export function encode(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof FieldValue) {
    return value._tagged;
  }
  if (value instanceof DocumentReference) {
    return { [REF]: value.path };
  }
  if (value instanceof Timestamp) {
    return { [TS]: value.toDate().toISOString() };
  }
  if (value instanceof Date) {
    return { [TS]: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map(encode).filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const e = encode(v);
      if (e !== undefined) {
        out[k] = e;
      }
    }
    return out;
  }
  return value;
}

/** Wire encoding -> app value (references become DocumentReference). */
export function decode(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (isTaggedRef(value)) {
    return new DocumentReference(value[REF]);
  }
  if (isTaggedTimestamp(value)) {
    return Timestamp.fromISOString(value[TS]);
  }
  if (isPlainObject(value) && isPlainObject(value[DOC])) {
    return new DocumentReference(value[DOC].path);
  }
  if (Array.isArray(value)) {
    return value.map(decode);
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = decode(v);
    }
    return out;
  }
  return value;
}

// --- snapshots ------------------------------------------------------------------

export class DocumentSnapshot {
  /**
   * @param {DocumentReference} ref
   * @param {object|null} wireData stored data in wire encoding
   * @param {(value: any) => any} decoder
   */
  constructor(ref, wireData, decoder = decode) {
    this.ref = ref;
    this.id = ref.id;
    this._wire = wireData;
    this._decoder = decoder;
    this.metadata = { hasPendingWrites: false, fromCache: false };
  }

  exists() {
    return this._wire !== null && this._wire !== undefined;
  }

  data(options) {
    if (!this.exists()) {
      return undefined;
    }
    if (this.ref.converter) {
      return this.ref.converter.fromFirestore(
        new DocumentSnapshot(
          new DocumentReference(this.ref.path),
          this._wire,
          this._decoder
        ),
        options
      );
    }
    return this._decoder(this._wire);
  }

  get(field) {
    return String(field)
      .split('.')
      .reduce((node, key) => (node == null ? undefined : node[key]), this.data());
  }
}

export class QuerySnapshot {
  constructor(docs, q) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
    this.query = q;
  }

  forEach(callback) {
    this.docs.forEach(callback);
  }
}

// --- reads ----------------------------------------------------------------------

const wireConstraints = (constraints) =>
  constraints.map((c) => (c.type === 'where' ? { ...c, value: encode(c.value) } : c));

/** Raw fetch helpers shared with ./vuefire.js */
export async function fetchDocument(path, depth = 0) {
  return request('/docs/get', { body: { path, depth } });
}

export async function fetchQuery(q, depth = 0) {
  return request('/docs/query', {
    body: {
      collection: q._collectionPath,
      constraints: wireConstraints(q._constraints),
      depth,
    },
  });
}

export async function getDoc(ref) {
  const { doc: d } = await fetchDocument(ref.path, 0);
  return new DocumentSnapshot(ref, d.exists ? d.data : null);
}

export async function getDocs(q) {
  const { docs } = await fetchQuery(q, 0);
  const converter = q.converter || null;
  return new QuerySnapshot(
    docs.map(
      (d) => new DocumentSnapshot(new DocumentReference(d.path, converter), d.data)
    ),
    q
  );
}

export async function getCountFromServer(q) {
  const { count } = await request('/docs/query', {
    body: {
      collection: q._collectionPath,
      constraints: wireConstraints(q._constraints),
      count: true,
    },
  });
  return { data: () => ({ count }) };
}

// --- writes ---------------------------------------------------------------------

async function commitOps(ops) {
  await request('/docs/commit', { body: { ops } });
}

function toFirestoreData(ref, data, options) {
  if (ref.converter && typeof ref.converter.toFirestore === 'function') {
    return ref.converter.toFirestore(data, options);
  }
  return data;
}

export async function addDoc(collectionRef, data) {
  const ref = doc(collectionRef);
  await commitOps([
    { type: 'create', path: ref.path, data: encode(toFirestoreData(ref, data)) },
  ]);
  return ref;
}

export async function setDoc(ref, data, options = {}) {
  await commitOps([
    {
      type: 'set',
      path: ref.path,
      data: encode(toFirestoreData(ref, data, options)),
      merge: Boolean(options.merge),
    },
  ]);
}

function updatePayload(dataOrField, rest) {
  if (typeof dataOrField === 'string') {
    const data = { [dataOrField]: rest[0] };
    for (let i = 1; i < rest.length; i += 2) {
      data[rest[i]] = rest[i + 1];
    }
    return data;
  }
  return dataOrField;
}

export async function updateDoc(ref, dataOrField, ...rest) {
  await commitOps([
    { type: 'update', path: ref.path, data: encode(updatePayload(dataOrField, rest)) },
  ]);
}

export async function deleteDoc(ref) {
  await commitOps([{ type: 'delete', path: ref.path }]);
}

export function writeBatch() {
  const ops = [];
  const batch = {
    set(ref, data, options = {}) {
      ops.push({
        type: 'set',
        path: ref.path,
        data: encode(data),
        merge: Boolean(options.merge),
      });
      return batch;
    },
    update(ref, dataOrField, ...rest) {
      ops.push({
        type: 'update',
        path: ref.path,
        data: encode(updatePayload(dataOrField, rest)),
      });
      return batch;
    },
    delete(ref) {
      ops.push({ type: 'delete', path: ref.path });
      return batch;
    },
    async commit() {
      if (ops.length) {
        await commitOps(ops);
      }
    },
  };
  return batch;
}
