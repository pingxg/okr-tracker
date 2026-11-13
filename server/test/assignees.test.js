/**
 * Roles and assignees on key results and measurements: who may create, edit,
 * assign, archive and record progress. Pure policy checks, no database.
 *
 *   project manager      manages everything in their teams
 *   project coordinator  edits / records progress on what is assigned to them
 *                        or to nobody; no creating, assigning or archiving
 *   no role              reads only
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canWrite } from '../src/policy/rules.js';

const ref = (path) => ({ __ref: path });
const user = (email) => ref(`users/${email}`);
const role = (r) => ({ superAdmin: false, admin: [], roles: { org1: r } });

const users = {
  super: { email: 'super@x.fi', doc: { superAdmin: true, admin: [] } },
  orgAdmin: { email: 'orgadmin@x.fi', doc: { superAdmin: false, admin: ['org1'] } },
  pm: { email: 'pm@x.fi', doc: role('projectManager') },
  pc: { email: 'pc@x.fi', doc: role('projectCoordinator') },
  pc2: { email: 'pc2@x.fi', doc: role('projectCoordinator') },
  norole: { email: 'norole@x.fi', doc: { superAdmin: false, admin: [] } },
  // project manager in org1, but not on team1
  pmElsewhere: { email: 'pmx@x.fi', doc: role('projectManager') },
  // on team1, but their manager role is for another organization
  pmOtherOrg: {
    email: 'pmo@x.fi',
    doc: { superAdmin: false, admin: [], roles: { org2: 'projectManager' } },
  },
};

const team = ['pm', 'pc', 'pc2', 'norole', 'pmOtherOrg'].map((k) => user(users[k].email));

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
    team: [user('pmx@x.fi')],
  },
  'objectives/o1': { name: 'O', parent: ref('products/team1') },
  'keyResults/open': {
    name: 'Nobody assigned',
    parent: ref('products/team1'),
    objective: ref('objectives/o1'),
  },
  'keyResults/kA': {
    name: 'Assigned to pc',
    parent: ref('products/team1'),
    objective: ref('objectives/o1'),
    assignees: [user('pc@x.fi')],
  },
  'kpis/kpiA': {
    name: 'Assigned KPI',
    parent: ref('products/team1'),
    assignees: [user('pc@x.fi')],
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

const newKr = (assignees = []) => ({
  name: 'New',
  parent: ref('products/team1'),
  objective: ref('objectives/o1'),
  assignees,
});

test('only project managers (and admins) create objectives and key results', async () => {
  const objective = { name: 'New', parent: ref('products/team1') };
  assert.equal(await write(users.pm, 'objectives/n', null, objective), true);
  assert.equal(await write(users.pc, 'objectives/n', null, objective), false);
  assert.equal(await write(users.norole, 'objectives/n', null, objective), false);
  assert.equal(await write(users.orgAdmin, 'objectives/n', null, objective), true);

  assert.equal(
    await write(users.pm, 'keyResults/n', null, newKr([user('pc@x.fi')])),
    true
  );
  assert.equal(await write(users.pc, 'keyResults/n', null, newKr()), false);
  assert.equal(await write(users.norole, 'keyResults/n', null, newKr()), false);
  assert.equal(
    await write(users.pmElsewhere, 'keyResults/n', null, newKr()),
    false,
    'manager, but not on this team'
  );
  assert.equal(
    await write(users.pmOtherOrg, 'keyResults/n', null, newKr()),
    false,
    'manager role belongs to another organization'
  );
  assert.equal(
    await write(users.pm, 'keyResults/n', null, newKr([user('pmx@x.fi')])),
    false,
    'assignees must be on the team'
  );
  assert.equal(
    await write(users.pm, 'keyResults/n', null, newKr(['pc@x.fi'])),
    false,
    'malformed assignee'
  );
});

test('project managers edit, reassign and archive, also when assigned', async () => {
  assert.equal(await update(users.pm, 'keyResults/kA', { name: 'x' }), true);
  assert.equal(
    await update(users.pm, 'keyResults/kA', { assignees: [user('pc2@x.fi')] }),
    true
  );
  assert.equal(await update(users.pm, 'keyResults/kA', { archived: true }), true);
  assert.equal(await update(users.pm, 'keyResults/kA', { order: 2 }), true);
  assert.equal(
    await update(users.pm, 'keyResults/kA', { parent: ref('products/team2') }),
    false,
    'cannot move it to a team they do not manage'
  );
});

test('coordinators edit what is assigned to them or to nobody', async () => {
  assert.equal(await update(users.pc, 'keyResults/kA', { name: 'x' }), true);
  assert.equal(await update(users.pc, 'keyResults/kA', { targetValue: 50 }), true);
  assert.equal(await update(users.pc, 'keyResults/open', { name: 'x' }), true);
  assert.equal(
    await update(users.pc2, 'keyResults/kA', { name: 'x' }),
    false,
    'assigned to someone else'
  );
  for (const changes of [
    { assignees: [user('pc2@x.fi')] },
    { archived: true },
    { order: 2 },
    { parent: ref('products/team2') },
  ]) {
    assert.equal(
      await update(users.pc, 'keyResults/kA', changes),
      false,
      JSON.stringify(changes)
    );
  }
  assert.equal(
    await update(users.pc, 'keyResults/open', { assignees: [user('pc@x.fi')] }),
    false,
    'coordinators do not assign, even themselves'
  );
});

test('members without a role and outsiders only read', async () => {
  assert.equal(await update(users.norole, 'keyResults/open', { name: 'x' }), false);
  assert.equal(await update(users.pmElsewhere, 'keyResults/open', { name: 'x' }), false);
});

test('admins manage everything, assignees stay on the team', async () => {
  assert.equal(
    await update(users.orgAdmin, 'keyResults/kA', { assignees: [user('pm@x.fi')] }),
    true
  );
  assert.equal(
    await update(users.orgAdmin, 'keyResults/kA', { assignees: [user('pmx@x.fi')] }),
    false
  );
  assert.equal(
    await update(users.super, 'keyResults/kA', { assignees: [user('pmx@x.fi')] }),
    true
  );
});

test('an assignee removed from the team loses edit rights', async () => {
  const removed = { ...world['products/team1'], team: [] };
  const kr = world['keyResults/kA'];
  const result = await canWrite(
    users.pc,
    { path: 'keyResults/kA', before: kr, after: { ...kr, name: 'x' } },
    {
      getBefore: async (p) => (p === 'products/team1' ? removed : world[p] ?? null),
      getAfter: async (p) => (p === 'products/team1' ? removed : world[p] ?? null),
    }
  );
  assert.equal(result, false);
});

test('progress: managers, and coordinators on their own or unassigned ones', async () => {
  const value = { value: 1 };
  assert.equal(await write(users.pc, 'keyResults/kA/progress/p', null, value), true);
  assert.equal(await write(users.pc2, 'keyResults/kA/progress/p', null, value), false);
  assert.equal(await write(users.pc2, 'keyResults/open/progress/p', null, value), true);
  assert.equal(await write(users.pm, 'keyResults/kA/progress/p', null, value), true);
  assert.equal(
    await write(users.norole, 'keyResults/open/progress/p', null, value),
    false
  );
  assert.equal(
    await write(users.orgAdmin, 'keyResults/kA/progress/p', null, value),
    true
  );
  assert.equal(await write(users.pc2, 'keyResults/kA/progress/p', value, null), false);
});

test('measurements: same rules for the KPI, its progress and its goals', async () => {
  assert.equal(await update(users.pc, 'kpis/kpiA', { name: 'x' }), true);
  assert.equal(await update(users.pc2, 'kpis/kpiA', { name: 'x' }), false);
  assert.equal(await update(users.pc, 'kpis/kpiA', { assignees: [] }), false);
  assert.equal(await update(users.pm, 'kpis/kpiA', { assignees: [] }), true);
  const value = { value: 1 };
  assert.equal(await write(users.pc, 'kpis/kpiA/progress/p', null, value), true);
  assert.equal(await write(users.pc2, 'kpis/kpiA/progress/p', null, value), false);
  assert.equal(await write(users.pc, 'kpis/kpiA/goals/g', null, value), true);
  assert.equal(await write(users.norole, 'kpis/kpiA/goals/g', null, value), false);
});
