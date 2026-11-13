/**
 * Roles. Admins set them per organization (users/{email}.roles =
 * { <orgId>: role }); they decide what a member may do in that organization's
 * departments and teams (the server enforces this):
 *   projectManager      manages OKRs, measurements and the member list
 *   projectCoordinator  records progress and edits what is assigned to them
 *                       or to nobody
 *   (no role)           reads only
 * "Administrator" is not a role to pick: it is shown for organization admins
 * and super admins.
 */
export const ROLE_MANAGER = 'projectManager';
export const ROLE_COORDINATOR = 'projectCoordinator';

export const jobPositions = [ROLE_MANAGER, ROLE_COORDINATOR];

/** A person's role in an organization, or null. */
export function roleIn(user, orgId) {
  const roles = user?.roles;
  if (!orgId || !roles || typeof roles !== 'object') {
    return null;
  }
  return jobPositions.includes(roles[orgId]) ? roles[orgId] : null;
}

/** Organization id of an organization, department or team (loaded document). */
export function organizationIdOf(item) {
  if (!item) {
    return null;
  }
  if (item.organization) {
    return typeof item.organization === 'string'
      ? item.organization.split('/').pop()
      : item.organization.id;
  }
  return item.id || null;
}

/**
 * Group heading on the "About" page: administrators first, then the roles in
 * this organization, then everyone else.
 */
export function positionGroup(user, orgId) {
  if (user?.superAdmin || (user?.admin || []).includes(orgId)) {
    return 'admin';
  }
  return roleIn(user, orgId) || 'others';
}

/** Order of the groups on the "About" pages. */
export const displayOrder = ['admin', ROLE_MANAGER, ROLE_COORDINATOR, 'others'];
