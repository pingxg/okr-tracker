/**
 * Assignees of key results and measurements: who may edit them and record
 * progress. Pure policy checks, no database needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWrite } from '../src/policy/rules.js';

const ref = (path) => ({ __ref: path });
const user = (email) => ref(`users/${email}`);

const users = {
  super: { email: 'super@x.fi', doc: { superAdmin: true, admin: [] } },
  orgAdmin: { email: 'orgadmin@x.fi', doc: { superAdmin: false, admin: ['org1'] } },
  member: { email: 'member@x.fi', doc: { superAdmin: false, admin: [] } },
  assignee: { email: 'assignee@x.fi', doc: { superAdmin: false, admin: [] } },
  outsider: { email: 'outsider@x.fi', doc: { superAdmin: false, admin: [] } },
};

const team = [user('member@x.fi'), user('assignee@x.fi')];

const world = {
  'organizations/org1': { name: 'Org', team: [] },
  'products/team1': {
    name: 'Team',
    organization: ref('organizations/org1'),
    department: ref('departments/dep1'),
    team,
  },
  'products/team2': {
    name: 'Other team',
    organization: ref('organizations/org1'),
    department: ref('departments/dep1'),
    team: [user('outsider@x.fi')],
  },
  'objectives/o1': { name: 'O', parent: ref('products/team1') },
  'keyResults/open': {
    name: 'Nobody assigned',
    parent: ref('products/team1'),
    objective: ref('objectives/o1'),
  },
  'keyResults/kA': {
    name: 'Assigned',
    parent: ref('products/team1'),
    objective: ref('objectives/o1'),
    assignees: [user('assignee@x.fi')],
  },
  'kpis/kpiA': {
    name: 'Assigned KPI',
    parent: ref('products/team1'),
    assignees: [user('assignee@x.fi')],
  },
};

function write(actor, path, before, after, overrides = {}) {
  const state = { ...world, [path]: after, ...overrides };
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

test('team members create key results and assign team members only', async () => {
  const kr = (assignees) => ({
    name: 'New',
    parent: ref('products/team1'),
    objective: ref('objectives/o1'),
    assignees,
  });
  assert.equal(await write(users.member, 'keyResults/n', null, kr([])), true);
  assert.equal(
    await write(users.member, 'keyResults/n', null, kr([user('assignee@x.fi')])),
    true
  );
  assert.equal(
    await write(users.member, 'keyResults/n', null, kr([user('outsider@x.fi')])),
    false,
    'assignee outside the team'
  );
  assert.equal(
    await write(users.member, 'keyResults/n', null, kr(['assignee@x.fi'])),
    false,
    'malformed assignee'
  );
  assert.equal(
    await write(users.outsider, 'keyResults/n', null, kr([])),
    false,
    'not a member'
  );
});

test('a key result nobody is assigned to: every team member may edit it', async () => {
  assert.equal(await update(users.member, 'keyResults/open', { name: 'x' }), true);
  assert.equal(
    await update(users.member, 'keyResults/open', {
      assignees: [user('assignee@x.fi')],
    }),
    true
  );
  assert.equal(await update(users.outsider, 'keyResults/open', { name: 'x' }), false);
});

test('an assigned key result: only assignees edit, and not the managed fields', async () => {
  assert.equal(await update(users.assignee, 'keyResults/kA', { name: 'x' }), true);
  assert.equal(await update(users.assignee, 'keyResults/kA', { targetValue: 50 }), true);
  assert.equal(
    await update(users.member, 'keyResults/kA', { name: 'x' }),
    false,
    'team member who is not assigned'
  );
  assert.equal(
    await update(users.assignee, 'keyResults/kA', {
      assignees: [user('member@x.fi')],
    }),
    false,
    'assignee cannot reassign'
  );
  assert.equal(
    await update(users.assignee, 'keyResults/kA', { archived: true }),
    false,
    'assignee cannot archive'
  );
  assert.equal(
    await update(users.assignee, 'keyResults/kA', { parent: ref('products/team2') }),
    false,
    'assignee cannot move it'
  );
});

test('any team member may still reorder an assigned key result', async () => {
  assert.equal(await update(users.member, 'keyResults/kA', { order: 3 }), true);
  assert.equal(
    await update(users.member, 'keyResults/kA', { order: 3, name: 'x' }),
    false,
    'reorder plus a real edit'
  );
  assert.equal(await update(users.outsider, 'keyResults/kA', { order: 3 }), false);
});

test('admins manage assigned key results, within the team', async () => {
  assert.equal(
    await update(users.orgAdmin, 'keyResults/kA', { assignees: [user('member@x.fi')] }),
    true
  );
  assert.equal(await update(users.orgAdmin, 'keyResults/kA', { archived: true }), true);
  assert.equal(
    await update(users.orgAdmin, 'keyResults/kA', { assignees: [user('outsider@x.fi')] }),
    false,
    'admins also assign team members only'
  );
  assert.equal(
    await update(users.super, 'keyResults/kA', { assignees: [user('outsider@x.fi')] }),
    true
  );
});

test('an assignee removed from the team loses edit rights', async () => {
  const overrides = { 'products/team1': { ...world['products/team1'], team: [] } };
  const kr = world['keyResults/kA'];
  // getBefore reads the world as it was; simulate removal for both phases.
  const result = await canWrite(
    users.assignee,
    { path: 'keyResults/kA', before: kr, after: { ...kr, name: 'x' } },
    {
      getBefore: async (p) => overrides[p] ?? world[p] ?? null,
      getAfter: async (p) => overrides[p] ?? world[p] ?? null,
    }
  );
  assert.equal(result, false);
});

test('progress follows the key result: assignees, or every member when unassigned', async () => {
  const value = { value: 1, timestamp: new Date().toISOString() };
  assert.equal(
    await write(users.assignee, 'keyResults/kA/progress/p', null, value),
    true
  );
  assert.equal(await write(users.member, 'keyResults/kA/progress/p', null, value), false);
  assert.equal(
    await write(users.orgAdmin, 'keyResults/kA/progress/p', null, value),
    true
  );
  assert.equal(await write(users.super, 'keyResults/kA/progress/p', null, value), true);
  assert.equal(
    await write(users.member, 'keyResults/open/progress/p', null, value),
    true
  );
  assert.equal(
    await write(users.outsider, 'keyResults/open/progress/p', null, value),
    false
  );
  // Deleting a progress value follows the same rule.
  assert.equal(await write(users.member, 'keyResults/kA/progress/p', value, null), false);
  assert.equal(
    await write(users.assignee, 'keyResults/kA/progress/p', value, null),
    true
  );
});

test('measurements: same rules for the KPI, its progress and its goals', async () => {
  assert.equal(await update(users.assignee, 'kpis/kpiA', { name: 'x' }), true);
  assert.equal(await update(users.member, 'kpis/kpiA', { name: 'x' }), false);
  assert.equal(
    await update(users.assignee, 'kpis/kpiA', { assignees: [] }),
    false,
    'assignee cannot unassign'
  );
  const value = { value: 1 };
  assert.equal(await write(users.assignee, 'kpis/kpiA/progress/p', null, value), true);
  assert.equal(await write(users.member, 'kpis/kpiA/progress/p', null, value), false);
  assert.equal(await write(users.assignee, 'kpis/kpiA/goals/g', null, value), true);
  assert.equal(await write(users.member, 'kpis/kpiA/goals/g', null, value), false);
});
