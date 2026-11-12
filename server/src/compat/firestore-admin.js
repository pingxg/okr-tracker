/**
 * A small, Postgres-backed stand-in for the parts of `firebase-admin/firestore`
 * that the original Cloud Functions used. It lets the ported trigger and API
 * code (server/src/functions) run with its logic unchanged.
 *
 * Supported: collection()/doc() references, get/set/update/delete/add,
 * where/orderBy/limit queries, batches, listDocuments(), FieldValue
 * transforms and Timestamp. Writes made through this module bypass the access
 * policy (they run as the system, like the Admin SDK did) but still fire
 * triggers.
 */
import Timestamp from '../../../common/docstore/timestamp.js';
import {
  REF,
  TS,
  OP,
  autoId,
  collectionOf,
  idOf,
  isPlainObject,
  isTaggedRef,
  isTaggedTimestamp,
  normalizePath,
  pathSegments,
} from '../../../common/docstore/encoding.js';
import {
  commit,
  getDocument,
  listDocumentIds,
  queryDocuments,
  setSnapshotFactory,
} from '../store/docstore.js';

export { Timestamp };

class FieldValueSentinel {
  constructor(tagged) {
    this.tagged = tagged;
  }

  isEqual(other) {
    return (
      other instanceof FieldValueSentinel &&
      JSON.stringify(other.tagged) === JSON.stringify(this.tagged)
    );
  }
}

export const FieldValue = {
  serverTimestamp: () => new FieldValueSentinel({ [OP]: 'serverTimestamp' }),
  delete: () => new FieldValueSentinel({ [OP]: 'delete' }),
  arrayUnion: (...values) =>
    new FieldValueSentinel({ [OP]: 'arrayUnion', values: values.map(encode) }),
  arrayRemove: (...values) =>
    new FieldValueSentinel({ [OP]: 'arrayRemove', values: values.map(encode) }),
  increment: (by) => new FieldValueSentinel({ [OP]: 'increment', by }),
};

/** Rich value -> wire encoding */
export function encode(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof FieldValueSentinel) {
    return value.tagged;
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
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

/** Wire encoding -> rich value */
export function decode(value, db) {
  if (value === null || value === undefined) {
    return value;
  }
  if (isTaggedRef(value)) {
    return db.doc(value[REF]);
  }
  if (isTaggedTimestamp(value)) {
    return Timestamp.fromISOString(value[TS]);
  }
  if (Array.isArray(value)) {
    return value.map((v) => decode(v, db));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = decode(v, db);
    }
    return out;
  }
  return value;
}

export class DocumentSnapshot {
  constructor(db, path, doc) {
    this._db = db;
    this.ref = db.doc(path);
    this.id = this.ref.id;
    this.exists = Boolean(doc && doc.exists !== false && doc.data);
    this._data = this.exists ? doc.data : undefined;
    this.createTime = doc?.createTime
      ? Timestamp.fromISOString(doc.createTime)
      : undefined;
    this.updateTime = doc?.updateTime
      ? Timestamp.fromISOString(doc.updateTime)
      : undefined;
  }

  data() {
    return this._data === undefined ? undefined : decode(this._data, this._db);
  }

  get(field) {
    const data = this.data();
    if (!data) {
      return undefined;
    }
    return String(field)
      .split('.')
      .reduce((node, key) => (node == null ? undefined : node[key]), data);
  }
}

export class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }

  forEach(callback) {
    this.docs.forEach(callback);
  }
}

class Query {
  constructor(db, collectionPath, constraints = []) {
    this._db = db;
    this._collectionPath = collectionPath;
    this._constraints = constraints;
  }

  where(field, op, value) {
    return new Query(this._db, this._collectionPath, [
      ...this._constraints,
      { type: 'where', field: String(field), op, value: encode(value) },
    ]);
  }

  orderBy(field, direction = 'asc') {
    return new Query(this._db, this._collectionPath, [
      ...this._constraints,
      { type: 'orderBy', field: String(field), direction },
    ]);
  }

  limit(n) {
    return new Query(this._db, this._collectionPath, [
      ...this._constraints,
      { type: 'limit', limit: n },
    ]);
  }

  async get() {
    const docs = await queryDocuments(this._collectionPath, this._constraints);
    return new QuerySnapshot(docs.map((d) => new DocumentSnapshot(this._db, d.path, d)));
  }
}

export class CollectionReference extends Query {
  constructor(db, path) {
    super(db, path, []);
    this.path = path;
    this.id = idOf(path);
    const segments = pathSegments(path);
    this.parent = segments.length > 1 ? db.doc(segments.slice(0, -1).join('/')) : null;
  }

  doc(id) {
    return this._db.doc(`${this.path}/${id || autoId()}`);
  }

  async add(data) {
    const ref = this.doc();
    await ref.create(data);
    return ref;
  }

  async listDocuments() {
    const ids = await listDocumentIds(this.path);
    return ids.map((id) => this.doc(id));
  }
}

export class DocumentReference {
  constructor(db, path) {
    this._db = db;
    this.path = path;
    this.id = idOf(path);
    this.firestore = db;
  }

  get parent() {
    return this._db.collection(collectionOf(this.path));
  }

  collection(name) {
    return this._db.collection(`${this.path}/${name}`);
  }

  isEqual(other) {
    return other instanceof DocumentReference && other.path === this.path;
  }

  async get() {
    return new DocumentSnapshot(this._db, this.path, await getDocument(this.path));
  }

  async create(data) {
    await commit([{ type: 'create', path: this.path, data: encode(data) }]);
    return { writeTime: Timestamp.now() };
  }

  async set(data, options = {}) {
    await commit([
      { type: 'set', path: this.path, data: encode(data), merge: Boolean(options.merge) },
    ]);
    return { writeTime: Timestamp.now() };
  }

  async update(data) {
    await commit([{ type: 'update', path: this.path, data: encode(data) }]);
    return { writeTime: Timestamp.now() };
  }

  async delete() {
    await commit([{ type: 'delete', path: this.path }]);
    return { writeTime: Timestamp.now() };
  }
}

class WriteBatch {
  constructor() {
    this._ops = [];
  }

  create(ref, data) {
    this._ops.push({ type: 'create', path: ref.path, data: encode(data) });
    return this;
  }

  set(ref, data, options = {}) {
    this._ops.push({
      type: 'set',
      path: ref.path,
      data: encode(data),
      merge: Boolean(options.merge),
    });
    return this;
  }

  update(ref, data) {
    this._ops.push({ type: 'update', path: ref.path, data: encode(data) });
    return this;
  }

  delete(ref) {
    this._ops.push({ type: 'delete', path: ref.path });
    return this;
  }

  async commit() {
    await commit(this._ops);
    return [];
  }
}

class Firestore {
  collection(path) {
    return new CollectionReference(this, normalizePath(path));
  }

  doc(path) {
    return new DocumentReference(this, normalizePath(path));
  }

  batch() {
    return new WriteBatch();
  }
}

const db = new Firestore();

export function getFirestore() {
  return db;
}

// Triggers receive Admin-SDK-style snapshots.
setSnapshotFactory(
  (path, data) => new DocumentSnapshot(db, path, data ? { data } : null)
);

export default { getFirestore, FieldValue, Timestamp };
