/**
 * Who may grant admin rights, manage users and change items' member lists.
 * Pure policy checks, no database needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWrite } from '../src/policy/rules.js';

const ref = (path) => ({ __ref: path });
const user = (email) => ref(`users/${email}`);

const users = {
  super: { email: 'super@x.fi', doc: { superAdmin: true, admin: [] } },
  admin1: { email: 'admin1@x.fi', doc: { superAdmin: false, admin: ['org1'] } },
  member: { email: 'member@x.fi', doc: { superAdmin: false, admin: [] } },
  other: { email: 'other@x.fi', doc: { superAdmin: false, admin: [] } },
  pm: {
    email: 'pm@x.fi',
    doc: { superAdmin: false, admin: [], roles: { org1: 'projectManager' } },
  },
  pc: {
    email: 'pc@x.fi',
    doc: { superAdmin: false, admin: [], roles: { org1: 'projectCoordinator' } },
  },
};

const team1 = [user('member@x.fi'), user('pm@x.fi'), user('pc@x.fi')];

const world = {
  'organizations/org1': { name: 'Org 1', team: team1 },
  'organizations/org2': { name: 'Org 2', team: [] },
  'departments/dep1': {
    name: 'Dep 1',
    organization: ref('organizations/org1'),
    team: team1,
  },
  'departments/dep2': {
    name: 'Dep 2',
    organization: ref('organizations/org2'),
    team: [],
  },
  'users/member@x.fi': { id: 'member@x.fi', email: 'member@x.fi', admin: [] },
  'users/admin1@x.fi': { id: 'admin1@x.fi', email: 'admin1@x.fi', admin: ['org1'] },
  'users/both@x.fi': { id: 'both@x.fi', email: 'both@x.fi', admin: ['org1', 'org2'] },
  'users/super@x.fi': {
    id: 'super@x.fi',
    email: 'super@x.fi',
    admin: [],
    superAdmin: true,
  },
};

function write(actor, path, before, after) {
  const state = { ...world, [path]: after };
  return canWrite(
    actor,
    { path, before, after },
    {
      getBefore: async (p) => world[p] ?? null,
      getAfter: async (p) => (p in state ? state[p] : null),
    }
  );
}
const update = (actor, path, changes) =>
  write(actor, path, world[path], { ...world[path], ...changes });

test('nobody can make themselves an admin', async () => {
  assert.equal(
    await update(users.member, 'users/member@x.fi', { admin: ['org1'] }),
    false
  );
  assert.equal(
    await update(users.admin1, 'users/admin1@x.fi', { admin: ['org1', 'org2'] }),
    false,
    'admin of org1 cannot add org2 to themselves'
  );
  assert.equal(
    await update(users.member, 'users/member@x.fi', { superAdmin: true }),
    false
  );
});

test('people still edit their own name, role and language', async () => {
  assert.equal(
    await update(users.member, 'users/member@x.fi', {
      displayName: 'M',
      position: 'specialist',
      preferences: { lang: 'zh-CN' },
    }),
    true
  );
  assert.equal(
    await update(users.member, 'users/member@x.fi', { email: 'x@x.fi' }),
    false
  );
});

test('org admins grant and remove admin of their own organization only', async () => {
  assert.equal(
    await update(users.admin1, 'users/member@x.fi', { admin: ['org1'] }),
    true
  );
  assert.equal(
    await update(users.admin1, 'users/member@x.fi', { admin: ['org2'] }),
    false
  );
  assert.equal(
    await update(users.admin1, 'users/both@x.fi', { admin: ['org2'] }),
    true,
    'removing org1 keeps org2'
  );
  assert.equal(
    await update(users.admin1, 'users/both@x.fi', { admin: ['org1'] }),
    false,
    'cannot remove org2'
  );
  assert.equal(await update(users.member, 'users/admin1@x.fi', { admin: [] }), false);
  assert.equal(await update(users.super, 'users/member@x.fi', { admin: ['org2'] }), true);
});

test('creating users: admin rights only for the creator’s own organizations', async () => {
  const fresh = (admin) => ({ id: 'n@x.fi', email: 'n@x.fi', admin });
  assert.equal(await write(users.admin1, 'users/n@x.fi', null, fresh([])), true);
  assert.equal(await write(users.admin1, 'users/n@x.fi', null, fresh(['org1'])), true);
  assert.equal(await write(users.admin1, 'users/n@x.fi', null, fresh(['org2'])), false);
  assert.equal(await write(users.member, 'users/n@x.fi', null, fresh([])), false);
});

test('only super admins delete users', async () => {
  const doc = world['users/member@x.fi'];
  assert.equal(await write(users.admin1, 'users/member@x.fi', doc, null), false);
  assert.equal(await write(users.member, 'users/member@x.fi', doc, null), false);
  assert.equal(await write(users.super, 'users/member@x.fi', doc, null), true);
  assert.equal(
    await write(users.admin1, 'users/super@x.fi', world['users/super@x.fi'], null),
    false
  );
});

test('only org admins create departments and teams', async () => {
  const dep = (org, team = []) => ({ name: 'New', organization: ref(org), team });
  assert.equal(
    await write(
      users.member,
      'departments/n',
      null,
      dep('organizations/org1', [user('member@x.fi')])
    ),
    false,
    'listing yourself as member is not enough'
  );
  assert.equal(
    await write(users.admin1, 'departments/n', null, dep('organizations/org1')),
    true
  );
  assert.equal(
    await write(users.admin1, 'departments/n', null, dep('organizations/org2')),
    false
  );
});

test('project managers edit content and members, not the place or archive state', async () => {
  assert.equal(await update(users.pm, 'departments/dep1', { name: 'Renamed' }), true);
  assert.equal(
    await update(users.pm, 'departments/dep1', { team: [...team1, user('other@x.fi')] }),
    true
  );
  assert.equal(await update(users.pm, 'departments/dep1', { archived: true }), false);
  assert.equal(
    await update(users.pm, 'departments/dep1', {
      organization: ref('organizations/org2'),
    }),
    false
  );
  assert.equal(await update(users.pm, 'organizations/org1', { team: [] }), true);
  assert.equal(await update(users.pm, 'organizations/org1', { archived: true }), false);
});

test('coordinators and members without a role do not edit items', async () => {
  for (const actor of [users.pc, users.member]) {
    assert.equal(await update(actor, 'departments/dep1', { name: 'Renamed' }), false);
    assert.equal(await update(actor, 'departments/dep1', { team: [] }), false);
    assert.equal(await update(actor, 'organizations/org1', { name: 'X' }), false);
  }
});

test('roles are set by admins, for their own organizations only', async () => {
  assert.equal(
    await update(users.member, 'users/member@x.fi', {
      roles: { org1: 'projectManager' },
    }),
    false,
    'nobody gives themselves a role'
  );
  assert.equal(
    await update(users.admin1, 'users/member@x.fi', {
      roles: { org1: 'projectManager' },
    }),
    true
  );
  assert.equal(
    await update(users.admin1, 'users/member@x.fi', {
      roles: { org2: 'projectManager' },
    }),
    false,
    'not for another organization'
  );
  assert.equal(
    await update(users.admin1, 'users/member@x.fi', { roles: { org1: 'boss' } }),
    false,
    'unknown role'
  );
  assert.equal(
    await update(users.super, 'users/member@x.fi', {
      roles: { org2: 'projectCoordinator' },
    }),
    true
  );
});

test('org admins manage items of their organization, not of others', async () => {
  assert.equal(
    await update(users.admin1, 'departments/dep1', { team: [user('other@x.fi')] }),
    true
  );
  assert.equal(await update(users.admin1, 'departments/dep1', { archived: true }), true);
  assert.equal(await update(users.admin1, 'departments/dep2', { name: 'X' }), false);
  assert.equal(
    await update(users.admin1, 'departments/dep1', {
      organization: ref('organizations/org2'),
    }),
    false,
    'cannot move it into an organization they do not administer'
  );
});
