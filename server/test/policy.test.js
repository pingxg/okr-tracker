/**
 * Access policy tests — the port of firestore.rules (spec §9: the permission
 * module must have automated tests). Pure functions, no database needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRead, canWrite } from '../src/policy/rules.js';

const ref = (path) => ({ __ref: path });

const users = {
  super: { email: 'super@x.fi', doc: { superAdmin: true, admin: [] } },
  orgAdmin: { email: 'orgadmin@x.fi', doc: { superAdmin: false, admin: ['org1'] } },
  member: { email: 'member@x.fi', doc: { superAdmin: false, admin: [] } },
  outsider: { email: 'outsider@x.fi', doc: { superAdmin: false, admin: [] } },
  unregistered: { email: 'nobody@x.fi', doc: null },
};

// A small world: org1 > dep1 > prod1, member is on prod1's team.
const world = {
  'organizations/org1': { name: 'Org', team: [] },
  'departments/dep1': { name: 'Dep', organization: ref('organizations/org1'), team: [] },
  'products/prod1': {
    name: 'Prod',
    organization: ref('organizations/org1'),
    department: ref('departments/dep1'),
    team: [ref('users/member@x.fi')],
  },
  'objectives/o1': { name: 'O', parent: ref('products/prod1') },
  'objectives/oDep': { name: 'O dep', parent: ref('departments/dep1') },
  'keyResults/k1': {
    name: 'K',
    parent: ref('products/prod1'),
    objective: ref('objectives/o1'),
  },
  'kpis/kpi1': { name: 'KPI', parent: ref('products/prod1') },
};

const ctx = (overrides = {}) => {
  const state = { ...world, ...overrides };
  const get = async (p) => state[p] ?? world[p] ?? null;
  return { getBefore: async (p) => world[p] ?? null, getAfter: get };
};

const write = (actor, path, before, after, overrides) =>
  canWrite(actor, { path, before, after }, ctx({ [path]: after, ...overrides }));

test('reads: signed-in tracker users read everything except access requests and secrets', () => {
  assert.equal(canRead(users.member, 'objectives'), true);
  assert.equal(canRead(users.member, 'keyResults/k1/progress'), true);
  assert.equal(canRead(users.member, 'requestAccess'), false);
  assert.equal(canRead(users.super, 'requestAccess'), true);
  assert.equal(canRead(users.super, 'apiClients/a/secrets'), false);
  assert.equal(canRead(users.unregistered, 'objectives'), false);
  assert.equal(canRead(null, 'objectives'), false);
  assert.equal(canRead(users.member, 'unknownCollection'), false);
});

test('organizations: only super admins create and delete', async () => {
  const org = { name: 'New', team: [] };
  assert.equal(await write(users.super, 'organizations/new', null, org), true);
  assert.equal(await write(users.orgAdmin, 'organizations/new', null, org), false);
  assert.equal(
    await write(users.orgAdmin, 'organizations/org1', world['organizations/org1'], null),
    false
  );
});

test('organizations: team members and the org admin can update', async () => {
  const before = world['organizations/org1'];
  assert.equal(
    await write(users.orgAdmin, 'organizations/org1', before, { ...before, name: 'X' }),
    true
  );
  assert.equal(
    await write(users.member, 'organizations/org1', before, { ...before, name: 'X' }),
    false
  );
  const withMember = { ...before, team: [ref('users/member@x.fi')] };
  assert.equal(
    await write(users.member, 'organizations/org1', withMember, {
      ...withMember,
      name: 'Y',
    }),
    true
  );
});

test('products: admin of the parent organization can create', async () => {
  const product = {
    name: 'P2',
    organization: ref('organizations/org1'),
    department: ref('departments/dep1'),
    team: [],
  };
  assert.equal(await write(users.orgAdmin, 'products/p2', null, product), true);
  assert.equal(await write(users.outsider, 'products/p2', null, product), false);
});

test('objectives and key results: members of the parent item may write, not delete', async () => {
  const obj = { name: 'New O', parent: ref('products/prod1') };
  assert.equal(await write(users.member, 'objectives/o2', null, obj), true);
  assert.equal(await write(users.outsider, 'objectives/o2', null, obj), false);
  assert.equal(await write(users.orgAdmin, 'objectives/o2', null, obj), true);
  assert.equal(
    await write(users.member, 'objectives/o1', world['objectives/o1'], null),
    false
  );

  const kr = world['keyResults/k1'];
  assert.equal(
    await write(users.member, 'keyResults/k1', kr, { ...kr, name: 'Renamed' }),
    true
  );
  assert.equal(
    await write(users.outsider, 'keyResults/k1', kr, { ...kr, name: 'Renamed' }),
    false
  );
});

test('objective update uses team membership *before* the write', async () => {
  // Moving an objective away from an item you belong to is allowed …
  const before = world['objectives/o1'];
  const after = { ...before, parent: ref('departments/dep1') };
  assert.equal(await write(users.member, 'objectives/o1', before, after), true);
  // … but taking over someone else's objective is not.
  const foreign = world['objectives/oDep'];
  const takeover = { ...foreign, parent: ref('products/prod1') };
  assert.equal(await write(users.member, 'objectives/oDep', foreign, takeover), false);
});

test('progress: members of the key result parent can add, update and delete', async () => {
  const p = { value: 3, timestamp: { __ts: '2026-11-01T12:00:00.000Z' } };
  assert.equal(await write(users.member, 'keyResults/k1/progress/p1', null, p), true);
  assert.equal(await write(users.member, 'keyResults/k1/progress/p1', p, null), true);
  assert.equal(await write(users.outsider, 'keyResults/k1/progress/p1', null, p), false);
  assert.equal(
    await write(users.member, 'kpis/kpi1/goals/g1', null, { name: 'g' }),
    true
  );
});

test('users: no self-registration, no self-promotion', async () => {
  const self = { email: 'member@x.fi', admin: [] };
  assert.equal(
    await write(users.member, 'users/member@x.fi', self, { ...self, displayName: 'M' }),
    true
  );
  assert.equal(
    await write(users.member, 'users/member@x.fi', self, { ...self, superAdmin: true }),
    false
  );
  assert.equal(
    await write(users.unregistered, 'users/nobody@x.fi', null, { email: 'nobody@x.fi' }),
    false
  );
  assert.equal(
    await write(users.orgAdmin, 'users/new@x.fi', null, { email: 'new@x.fi', admin: [] }),
    true
  );
  assert.equal(
    await write(users.orgAdmin, 'users/new@x.fi', null, {
      email: 'new@x.fi',
      superAdmin: true,
    }),
    false
  );
});

test('server-managed collections reject client writes', async () => {
  // Written only by the server (triggers); even super admins cannot write them.
  for (const path of ['audit/a1', 'slugs/s', 'periods/p1']) {
    assert.equal(await write(users.super, path, null, { x: 1 }), false, path);
  }
});

test('access requests can no longer be created by people who are not signed in', async () => {
  assert.equal(
    await write(null, 'requestAccess/a@x.fi', null, { email: 'a@x.fi' }),
    false
  );
  assert.equal(
    await write(users.member, 'requestAccess/a@x.fi', null, { email: 'a@x.fi' }),
    false
  );
});

test('objective contributors: member of item, objective owned by item or its parent', async () => {
  const contributor = { item: ref('products/prod1'), objective: ref('objectives/oDep') };
  assert.equal(
    await write(users.member, 'objectiveContributors/c1', null, contributor),
    true
  );
  const unrelated = {
    item: ref('products/prod1'),
    objective: ref('objectives/elsewhere'),
  };
  const elsewhere = { 'objectives/elsewhere': { parent: ref('organizations/other') } };
  assert.equal(
    await write(users.member, 'objectiveContributors/c2', null, unrelated, elsewhere),
    false
  );
});
