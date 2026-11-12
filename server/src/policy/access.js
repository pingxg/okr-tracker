/**
 * Permission module (spec §9 and §19): the single place that answers "may this
 * person do this?". Services call it before every change. Pure functions over
 * plain data, so every rule is covered by test/access.test.js.
 *
 * Inputs:
 *   actor  { id, status, memberships: [{ nodeId, role }] }   memberships in effect today
 *   tree   { parentOf: Map<nodeId, parentId|null>, rootId }  the org structure
 *
 * Roles are bound to a node and reach down the tree (spec §9 "范围"):
 *   group_admin  only on the group (root) node: everything
 *   entity_lead  a legal entity or brand and everything below it
 *   team_lead    a team (OKRs: the team and below; people: the team itself)
 *   member       own work only
 *   observer     read only
 *
 * This file covers the organisation (milestone M2). OKR rules follow in M3.
 */

export const ROLES = ['group_admin', 'entity_lead', 'team_lead', 'member', 'observer'];

/** The node itself followed by its ancestors up to the root. */
export function ancestorsOf(tree, nodeId) {
  const chain = [];
  const seen = new Set();
  let current = nodeId;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = tree.parentOf.get(current) ?? null;
  }
  return chain;
}

/** True when `nodeId` is `ancestorId` or below it. */
export const isWithin = (tree, nodeId, ancestorId) =>
  ancestorsOf(tree, nodeId).includes(ancestorId);

/** True when `nodeId` is below `ancestorId` (not the node itself). */
export const isBelow = (tree, nodeId, ancestorId) =>
  nodeId !== ancestorId && isWithin(tree, nodeId, ancestorId);

const isActive = (actor) => Boolean(actor) && actor.status === 'active';

const nodesWithRole = (actor, role) =>
  isActive(actor)
    ? actor.memberships.filter((m) => m.role === role).map((m) => m.nodeId)
    : [];

export const isGroupAdmin = (actor) => nodesWithRole(actor, 'group_admin').length > 0;

/** Anyone signed in and active can see the organisation chart and the people list. */
export const canViewOrg = (actor) => isActive(actor);

/** New node under `parentId`: group admins, or entity leads inside their entity. */
export function canCreateNode(actor, tree, parentId) {
  if (isGroupAdmin(actor)) {
    return true;
  }
  return nodesWithRole(actor, 'entity_lead').some((e) => isWithin(tree, parentId, e));
}

/** Rename or change the type of a node. Entity leads may rename their own entity. */
export function canEditNode(actor, tree, nodeId) {
  if (isGroupAdmin(actor)) {
    return true;
  }
  return nodesWithRole(actor, 'entity_lead').some((e) => isWithin(tree, nodeId, e));
}

/**
 * Move a node to `newParentId` or deactivate it (newParentId undefined).
 * Entity leads may restructure below their entity but not the entity itself,
 * and may not move anything out of it.
 */
export function canRestructureNode(actor, tree, nodeId, newParentId) {
  if (isGroupAdmin(actor)) {
    return true;
  }
  return nodesWithRole(actor, 'entity_lead').some(
    (e) =>
      isBelow(tree, nodeId, e) &&
      (newParentId === undefined || isWithin(tree, newParentId, e))
  );
}

/**
 * Roles the actor may grant, change or end on `nodeId`. Nobody can hand out a
 * role equal to their own, so rights cannot be escalated sideways; only group
 * admins can appoint entity leads at entity level and other group admins.
 */
export function grantableRoles(actor, tree, nodeId) {
  if (isGroupAdmin(actor)) {
    return new Set(ROLES);
  }
  const roles = new Set();
  for (const e of nodesWithRole(actor, 'entity_lead')) {
    if (isWithin(tree, nodeId, e)) {
      ['team_lead', 'member', 'observer'].forEach((r) => roles.add(r));
      if (isBelow(tree, nodeId, e)) {
        roles.add('entity_lead'); // e.g. a brand lead under the entity
      }
    }
  }
  // Spec §19: team leads maintain "本团队的成员" — their own team only.
  if (nodesWithRole(actor, 'team_lead').includes(nodeId)) {
    roles.add('member');
    roles.add('observer');
  }
  return roles;
}

export const canManageMembership = (actor, tree, nodeId, role) =>
  grantableRoles(actor, tree, nodeId).has(role);

/** People may change their own personal settings (language). */
export const canEditOwnProfile = (actor, userId) =>
  isActive(actor) && actor.id === userId;
