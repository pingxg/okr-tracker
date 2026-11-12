import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWrite } from '../src/store/transforms.js';
import { buildQuery } from '../src/store/query.js';

const NOW = '2026-11-12T10:00:00.000Z';

test('create resolves serverTimestamp and refuses existing documents', () => {
  const after = applyWrite(
    null,
    { type: 'create', data: { a: 1, t: { __op: 'serverTimestamp' } } },
    NOW
  );
  assert.deepEqual(after, { a: 1, t: { __ts: NOW } });
  assert.throws(
    () => applyWrite({ a: 1 }, { type: 'create', data: {} }, NOW),
    /already exists/
  );
});

test('update supports dot paths, delete, arrayUnion/arrayRemove and increment', () => {
  const before = {
    name: 'x',
    prefs: { lang: 'nb-NO', view: 'list' },
    team: [{ __ref: 'users/a' }],
    n: 1,
    gone: 1,
  };
  const after = applyWrite(
    before,
    {
      type: 'update',
      data: {
        'prefs.lang': 'en-US',
        gone: { __op: 'delete' },
        team: {
          __op: 'arrayUnion',
          values: [{ __ref: 'users/b' }, { __ref: 'users/a' }],
        },
        n: { __op: 'increment', by: 2 },
      },
    },
    NOW
  );
  assert.deepEqual(after, {
    name: 'x',
    prefs: { lang: 'en-US', view: 'list' },
    team: [{ __ref: 'users/a' }, { __ref: 'users/b' }],
    n: 3,
  });
  const removed = applyWrite(
    after,
    {
      type: 'update',
      data: { team: { __op: 'arrayRemove', values: [{ __ref: 'users/a' }] } },
    },
    NOW
  );
  assert.deepEqual(removed.team, [{ __ref: 'users/b' }]);
  // Original is not mutated
  assert.equal(before.prefs.lang, 'nb-NO');
});

test('update of a missing document fails; set merge deep-merges', () => {
  assert.throws(
    () => applyWrite(null, { type: 'update', data: { a: 1 } }, NOW),
    /No document/
  );
  const merged = applyWrite(
    { a: { b: 1, c: 2 }, d: 1 },
    { type: 'set', merge: true, data: { a: { b: 5 } } },
    NOW
  );
  assert.deepEqual(merged, { a: { b: 5, c: 2 }, d: 1 });
  const replaced = applyWrite({ a: 1 }, { type: 'set', data: { z: 1 } }, NOW);
  assert.deepEqual(replaced, { z: 1 });
});

test('field names starting with __ are rejected', () => {
  assert.throws(
    () => applyWrite(null, { type: 'create', data: { __ref: 'x' } }, NOW),
    /Invalid field name/
  );
});

test('query builder: parameters only for used field paths, orderBy filters missing fields', () => {
  const q = buildQuery('organizations', [
    { type: 'where', field: 'team', op: 'array-contains', value: { __ref: 'users/a' } },
    { type: 'where', field: 'archived', op: '==', value: false },
    { type: 'orderBy', field: 'name', direction: 'desc' },
    { type: 'limit', limit: 10 },
  ]);
  const placeholders = new Set(q.text.match(/\$\d+/g));
  assert.equal(placeholders.size, q.values.length);
  assert.match(q.text, /IS NOT NULL/);
  assert.match(q.text, /ORDER BY .* DESC, id DESC LIMIT 10$/);
  assert.throws(
    () => buildQuery('x', [{ type: 'where', field: 'a', op: 'LIKE', value: 1 }]),
    /Unsupported operator/
  );
});
