/**
 * Document store on Postgres. Phase-1 replacement for Firestore: documents
 * keep their Firestore paths and data shape (see db/migrations/001).
 *
 * All writes — from the browser, the external API, MCP later on, and
 * triggers — go through `commit()`, which:
 *   1. applies the batch in one transaction, row-locking the touched documents,
 *   2. asks the policy module whether the actor may perform each change,
 *   3. notifies listeners (Postgres NOTIFY → server-sent events),
 *   4. runs triggers (audit log, slugs, progress roll-up …) after commit.
 */
import {
  collectionOf,
  idOf,
  isCollectionPath,
  isDocumentPath,
  normalizePath,
  pathSegments,
} from '../../../common/docstore/encoding.js';
import pool from '../db/pool.js';
import config from '../config.js';
import { buildQuery } from './query.js';
import { applyWrite, deepEqual, WriteError } from './transforms.js';
import { dispatch } from './hooks.js';

export const CHANNEL = 'okr_changes';
const MAX_BATCH = 500;

let snapshotFactory = null;

/** Set by the admin compat layer so triggers receive document snapshots. */
export function setSnapshotFactory(factory) {
  snapshotFactory = factory;
}

export function rowToDoc(row) {
  return {
    path: row.path,
    id: row.id,
    exists: true,
    data: row.data,
    createTime: row.created_at?.toISOString?.() ?? row.created_at,
    updateTime: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

const missing = (path) => ({ path, id: idOf(path), exists: false, data: null });

export function assertDocumentPath(path) {
  const p = normalizePath(path || '');
  if (!isDocumentPath(p)) {
    throw new WriteError(`Not a document path: ${path}`);
  }
  return p;
}

export function assertCollectionPath(path) {
  const p = normalizePath(path || '');
  if (!p || !isCollectionPath(p)) {
    throw new WriteError(`Not a collection path: ${path}`);
  }
  return p;
}

export async function getDocument(path, client = pool) {
  const p = assertDocumentPath(path);
  const { rows } = await client.query(
    'SELECT path, id, data, created_at, updated_at FROM documents WHERE path = $1',
    [p]
  );
  return rows.length ? rowToDoc(rows[0]) : missing(p);
}

export async function getDocuments(paths, client = pool) {
  const unique = [...new Set(paths.map((p) => normalizePath(p)))];
  if (!unique.length) {
    return new Map();
  }
  const { rows } = await client.query(
    'SELECT path, id, data, created_at, updated_at FROM documents WHERE path = ANY($1)',
    [unique]
  );
  const found = new Map(rows.map((r) => [r.path, rowToDoc(r)]));
  return new Map(unique.map((p) => [p, found.get(p) || missing(p)]));
}

export async function queryDocuments(collectionPath, constraints = [], client = pool) {
  const c = assertCollectionPath(collectionPath);
  const { text, values } = buildQuery(c, constraints);
  const { rows } = await client.query(text, values);
  return rows.map(rowToDoc);
}

export async function countDocuments(collectionPath, constraints = [], client = pool) {
  const c = assertCollectionPath(collectionPath);
  const { text, values } = buildQuery(c, constraints, { count: true });
  const { rows } = await client.query(text, values);
  return rows[0].count;
}

export async function listDocumentIds(collectionPath, client = pool) {
  const c = assertCollectionPath(collectionPath);
  const { rows } = await client.query(
    'SELECT id FROM documents WHERE collection = $1 ORDER BY id',
    [c]
  );
  return rows.map((r) => r.id);
}

/**
 * Commit a batch of writes atomically.
 *
 * @param {Array<{type: 'create'|'set'|'update'|'delete', path: string, data?: object, merge?: boolean}>} ops
 * @param {object} [options]
 * @param {Function} [options.authorize] async (change, ctx) => void; throws to deny
 * @param {boolean} [options.runHooks=true]
 * @returns {Promise<Array<{path: string, id: string}>>}
 */
export async function commit(ops, { authorize = null, runHooks = true } = {}) {
  if (!Array.isArray(ops) || !ops.length) {
    return [];
  }
  if (ops.length > MAX_BATCH) {
    throw new WriteError(`A batch can contain at most ${MAX_BATCH} writes`);
  }

  const now = new Date().toISOString();
  const client = await pool.connect();
  const changes = new Map(); // path -> { path, before, after }

  try {
    await client.query('BEGIN');

    // Lock rows in a stable order to avoid deadlocks between concurrent batches.
    const paths = [...new Set(ops.map((op) => assertDocumentPath(op.path)))].sort();
    const { rows } = await client.query(
      'SELECT path, data FROM documents WHERE path = ANY($1) ORDER BY path FOR UPDATE',
      [paths]
    );
    const original = new Map(paths.map((p) => [p, null]));
    rows.forEach((r) => original.set(r.path, r.data));
    const state = new Map(original);

    for (const op of ops) {
      const path = assertDocumentPath(op.path);
      const before = state.get(path);
      if (op.type === 'delete' && !before) {
        continue;
      }
      const after = applyWrite(before, op, now);
      state.set(path, after);
      if (!changes.has(path)) {
        changes.set(path, { path, before: original.get(path), after });
      } else {
        changes.get(path).after = after;
      }
    }

    const effective = [...changes.values()].filter((c) => !deepEqual(c.before, c.after));

    if (authorize) {
      const ctx = {
        // Value before the batch (Firestore rules `get()`)
        getBefore: async (p) => {
          const n = normalizePath(p);
          if (original.has(n)) {
            return original.get(n);
          }
          return (await getDocument(n, client)).data;
        },
        // Value after the batch (Firestore rules `getAfter()`)
        getAfter: async (p) => {
          const n = normalizePath(p);
          if (state.has(n)) {
            return state.get(n);
          }
          return (await getDocument(n, client)).data;
        },
      };
      for (const change of effective) {
        await authorize(change, ctx);
      }
    }

    for (const { path, after } of effective) {
      if (after === null) {
        await client.query('DELETE FROM documents WHERE path = $1', [path]);
      } else {
        const segments = pathSegments(path);
        const collection = collectionOf(path);
        await client.query(
          `INSERT INTO documents (path, collection, collection_group, parent, id, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
           ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
          [
            path,
            collection,
            segments[segments.length - 2],
            segments.slice(0, -2).join('/'),
            segments[segments.length - 1],
            JSON.stringify(after),
            now,
          ]
        );
      }
      await client.query('SELECT pg_notify($1, $2)', [
        CHANNEL,
        JSON.stringify({ c: collectionOf(path), p: path }),
      ]);
    }

    await client.query('COMMIT');

    if (runHooks && config.hooksEnabled && snapshotFactory) {
      for (const change of effective) {
        await dispatch(change, snapshotFactory);
      }
    }

    return ops.map((op) => {
      const p = normalizePath(op.path);
      return { path: p, id: idOf(p) };
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
