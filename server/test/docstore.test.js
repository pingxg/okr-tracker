/**
 * Integration tests against a real Postgres database. Skipped unless
 * TEST_DATABASE_URL is set (CI provides one), because they write data.
 *
 *   TEST_DATABASE_URL=postgres://okr:okr@localhost:5432/okr_test npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
}

const skip = !url && 'TEST_DATABASE_URL not set';

let pool;
let store;
let admin;

before(async () => {
  if (skip) {
    return;
  }
  ({ default: pool } = await import('../src/db/pool.js'));
  const { migrate } = await import('../src/db/migrate.js');
  await migrate({ log: () => {} });
  await pool.query('TRUNCATE documents');
  store = await import('../src/store/docstore.js');
  admin = await import('../src/compat/firestore-admin.js');
  await import('../src/functions/index.js'); // registers triggers
});

after(async () => {
  if (pool) {
    await pool.end();
  }
});

test('queries follow Firestore semantics', { skip }, async () => {
  await store.commit([
    {
      type: 'set',
      path: 'things/a',
      data: { n: 1, tags: ['x'], t: { __ts: '2026-01-01T00:00:00.000Z' } },
    },
    {
      type: 'set',
      path: 'things/b',
      data: { n: 2, tags: ['x', 'y'], t: { __ts: '2026-02-01T00:00:00.000Z' } },
    },
    { type: 'set', path: 'things/c', data: { n: 'two', tags: [] } },
  ]);
  const ids = async (constraints) =>
    (await store.queryDocuments('things', constraints)).map((d) => d.id);

  assert.deepEqual(await ids([{ type: 'where', field: 'n', op: '>=', value: 2 }]), ['b']); // string 'two' excluded
  assert.deepEqual(
    await ids([{ type: 'where', field: 'tags', op: 'array-contains', value: 'y' }]),
    ['b']
  );
  assert.deepEqual(await ids([{ type: 'orderBy', field: 't', direction: 'desc' }]), [
    'b',
    'a',
  ]); // c has no t
  assert.deepEqual(
    await ids([{ type: 'where', field: 'n', op: 'in', value: [1, 'two'] }]),
    ['a', 'c']
  );
  assert.equal(await store.countDocuments('things', []), 3);
});

test(
  'progress triggers roll up to key result and objective; audit is written',
  { skip },
  async () => {
    const db = admin.getFirestore();
    const org = db.doc('organizations/o1');
    await org.set({ name: 'Org One', archived: false, team: [] });
    const objective = await db
      .collection('objectives')
      .add({ name: 'Obj', parent: org, archived: false, weight: 1 });
    const kr = await db.collection('keyResults').add({
      name: 'KR',
      objective,
      parent: org,
      archived: false,
      weight: 1,
      startValue: 0,
      targetValue: 10,
    });
    await kr
      .collection('progress')
      .add({ value: 5, timestamp: new Date(), archived: false });

    const krData = (await kr.get()).data();
    assert.equal(krData.currentValue, 5);
    assert.equal(krData.progression, 0.5);
    assert.equal((await objective.get()).data().progression, 0.5);

    const slug = (await db.collection('slugs').doc('org-one').get()).data();
    assert.equal(slug.reference.path, 'organizations/o1');

    const audit = await db
      .collection('audit')
      .where('event', '==', 'KeyResultCreated')
      .get();
    assert.equal(audit.size, 1);
  }
);

test('policy denial rolls back the whole batch', { skip }, async () => {
  const deny = async (change) => {
    if (change.path === 'things/denied') {
      throw Object.assign(new Error('nope'), { statusCode: 403 });
    }
  };
  await assert.rejects(
    store.commit(
      [
        { type: 'set', path: 'things/ok', data: { a: 1 } },
        { type: 'set', path: 'things/denied', data: { a: 1 } },
      ],
      { authorize: deny }
    ),
    /nope/
  );
  assert.equal((await store.getDocument('things/ok')).exists, false);
});
