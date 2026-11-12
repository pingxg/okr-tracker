/**
 * Permission module tests for the organisation (spec §19, milestone M2).
 * Pure functions, no database needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorsOf,
  canCreateNode,
  canEditNode,
  canManageMembership,
  canRestructureNode,
  canViewOrg,
  grantableRoles,
  isGroupAdmin,
} from '../src/policy/access.js';

// group
// ├── entityA
// │   ├── brandA
// │   │   └── teamA1
// │   └── deptA
// └── entityB
//     └── teamB1
const tree = {
  rootId: 'group',
  parentOf: new Map([
    ['group', null],
    ['entityA', 'group'],
    ['brandA', 'entityA'],
    ['teamA1', 'brandA'],
    ['deptA', 'entityA'],
    ['entityB', 'group'],
    ['teamB1', 'entityB'],
  ]),
};

const person = (id, ...memberships) => ({
  id,
  status: 'active',
  memberships: memberships.map(([nodeId, role]) => ({ nodeId, role })),
});

const admin = person('admin', ['group', 'group_admin']);
const leadA = person('leadA', ['entityA', 'entity_lead']);
const teamLead = person('teamLead', ['teamA1', 'team_lead']);
const member = person('member', ['teamA1', 'member']);
const observer = person('observer', ['group', 'observer']);
const nobody = person('nobody');
const leftCompany = { ...person('left', ['group', 'group_admin']), status: 'inactive' };

test('ancestorsOf walks to the root and survives cycles', () => {
  assert.deepEqual(ancestorsOf(tree, 'teamA1'), ['teamA1', 'brandA', 'entityA', 'group']);
  const loop = {
    parentOf: new Map([
      ['a', 'b'],
      ['b', 'a'],
    ]),
  };
  assert.deepEqual(ancestorsOf(loop, 'a'), ['a', 'b']);
});

test('everyone active can view the organisation; inactive people cannot', () => {
  for (const p of [admin, leadA, teamLead, member, observer, nobody]) {
    assert.equal(canViewOrg(p), true, p.id);
  }
  assert.equal(canViewOrg(leftCompany), false);
  assert.equal(canViewOrg(null), false);
});

test('inactive group admins lose their rights', () => {
  assert.equal(isGroupAdmin(admin), true);
  assert.equal(isGroupAdmin(leftCompany), false);
  assert.equal(canCreateNode(leftCompany, tree, 'group'), false);
});

test('creating nodes: group admin anywhere, entity lead inside the entity only', () => {
  assert.equal(canCreateNode(admin, tree, 'group'), true);
  assert.equal(canCreateNode(admin, tree, 'teamB1'), true);

  assert.equal(canCreateNode(leadA, tree, 'entityA'), true);
  assert.equal(canCreateNode(leadA, tree, 'brandA'), true);
  assert.equal(canCreateNode(leadA, tree, 'group'), false);
  assert.equal(canCreateNode(leadA, tree, 'entityB'), false);

  for (const p of [teamLead, member, observer, nobody]) {
    assert.equal(canCreateNode(p, tree, 'teamA1'), false, p.id);
  }
});

test('renaming: entity leads may rename their own entity and below', () => {
  assert.equal(canEditNode(leadA, tree, 'entityA'), true);
  assert.equal(canEditNode(leadA, tree, 'teamA1'), true);
  assert.equal(canEditNode(leadA, tree, 'teamB1'), false);
  assert.equal(canEditNode(leadA, tree, 'group'), false);
  assert.equal(canEditNode(teamLead, tree, 'teamA1'), false);
});

test('moving and deactivating: entity leads only below their entity, never out of it', () => {
  assert.equal(canRestructureNode(admin, tree, 'entityA', undefined), true);

  assert.equal(canRestructureNode(leadA, tree, 'teamA1', 'deptA'), true);
  assert.equal(canRestructureNode(leadA, tree, 'teamA1', undefined), true);
  assert.equal(canRestructureNode(leadA, tree, 'entityA', undefined), false);
  assert.equal(canRestructureNode(leadA, tree, 'teamA1', 'entityB'), false);
  assert.equal(canRestructureNode(leadA, tree, 'teamB1', 'deptA'), false);

  assert.equal(canRestructureNode(teamLead, tree, 'teamA1', undefined), false);
});

test('group admins can grant every role', () => {
  assert.deepEqual([...grantableRoles(admin, tree, 'group')].sort(), [
    'entity_lead',
    'group_admin',
    'member',
    'observer',
    'team_lead',
  ]);
});

test('entity leads cannot appoint a peer at entity level, only below it', () => {
  assert.equal(canManageMembership(leadA, tree, 'entityA', 'team_lead'), true);
  assert.equal(canManageMembership(leadA, tree, 'entityA', 'member'), true);
  assert.equal(canManageMembership(leadA, tree, 'entityA', 'entity_lead'), false);
  assert.equal(canManageMembership(leadA, tree, 'brandA', 'entity_lead'), true);
  assert.equal(canManageMembership(leadA, tree, 'teamA1', 'group_admin'), false);
  assert.equal(canManageMembership(leadA, tree, 'teamB1', 'member'), false);
});

test('team leads manage members and observers of their own team only', () => {
  assert.equal(canManageMembership(teamLead, tree, 'teamA1', 'member'), true);
  assert.equal(canManageMembership(teamLead, tree, 'teamA1', 'observer'), true);
  assert.equal(canManageMembership(teamLead, tree, 'teamA1', 'team_lead'), false);
  assert.equal(canManageMembership(teamLead, tree, 'brandA', 'member'), false);
  assert.equal(canManageMembership(teamLead, tree, 'teamB1', 'member'), false);
});

test('members, observers and people without roles cannot manage anyone', () => {
  for (const p of [member, observer, nobody]) {
    assert.equal(grantableRoles(p, tree, 'teamA1').size, 0, p.id);
  }
});
