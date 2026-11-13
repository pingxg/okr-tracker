/**
 * Roles people can pick in their profile. A role is a label only: it groups
 * members on the "About" pages and does not grant any rights (rights come from
 * admin / super admin in Admin).
 */
export const jobPositions = [
  'projectManager',
  'projectCoordinator',
  'specialist',
  'administration',
  'other',
];

/**
 * Group heading on the "About" pages for each role. Roles from the original
 * list that were saved before are kept in a sensible group, so nobody drops
 * out of the member list.
 */
const groupOf = {
  projectManager: 'projectManager',
  projectCoordinator: 'projectCoordinator',
  specialist: 'specialist',
  administration: 'administration',
  hr: 'administration',
  humanResourcesManager: 'administration',
};

export const positionGroup = (position) => groupOf[position] || 'others';

/** Order of the groups on the "About" pages. */
export const displayOrder = [
  'projectManager',
  'projectCoordinator',
  'specialist',
  'administration',
  'others',
];
