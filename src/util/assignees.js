/**
 * Who may edit key results and measurements, mirroring the server rules
 * (server/src/policy/rules.js). In the team the record belongs to:
 *   - admins (super admins, admins of the organization): everything;
 *   - project managers: everything (create, edit, assign, archive);
 *   - project coordinators: edit and record progress on what is assigned
 *     to them or to nobody; no assigning, moving or archiving;
 *   - members without a role and others: read only.
 * The server enforces this; these helpers only decide what the UI offers.
 */
// Relative import so the unit tests (no '@/' alias) can load this module.
import { ROLE_COORDINATOR, ROLE_MANAGER } from '../config/jobPositions';

/** User id from a reference, a "users/<id>" path or a loaded user document. */
export function userIdOf(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value.split('/').pop() || null;
  }
  return value.id || null;
}

const idsOf = (list) => (Array.isArray(list) ? list.map(userIdOf).filter(Boolean) : []);

export const assigneeIds = (record) => idsOf(record?.assignees);
export const teamIds = (item) => idsOf(item?.team);

/** `role` is the user's role in the organization the parent belongs to. */
function memberRole({ parent, userId, role }) {
  return userId && teamIds(parent).includes(userId) ? role || null : null;
}

/** The user may edit the record and record progress on it. */
export function canEditAssigned({ record, parent, userId, isAdmin, role }) {
  if (isAdmin) {
    return true;
  }
  const r = memberRole({ parent, userId, role });
  if (r === ROLE_MANAGER) {
    return true;
  }
  if (r !== ROLE_COORDINATOR) {
    return false;
  }
  const ids = assigneeIds(record);
  return ids.length === 0 || ids.includes(userId);
}

/** The user may change who is assigned, move or archive the record. */
export function canManageAssigned({ parent, userId, isAdmin, role }) {
  return isAdmin || memberRole({ parent, userId, role }) === ROLE_MANAGER;
}
