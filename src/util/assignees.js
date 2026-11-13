/**
 * Assignees of key results and measurements, mirroring the server rules
 * (server/src/policy/rules.js):
 *   - nobody assigned: every member of the parent team may edit it;
 *   - assigned: only the assignees edit it and record progress;
 *   - reassigning, moving and archiving an assigned one is for admins only;
 *   - super admins and admins of the organization may do everything.
 * The server enforces this; these helpers only decide what the UI offers.
 */

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

/** The user may edit the record and record progress on it. */
export function canEditAssigned({ record, parent, userId, isAdmin }) {
  if (isAdmin) {
    return true;
  }
  if (!userId || !teamIds(parent).includes(userId)) {
    return false;
  }
  const ids = assigneeIds(record);
  return ids.length === 0 || ids.includes(userId);
}

/** The user may change who is assigned, move or archive the record. */
export function canManageAssigned({ record, parent, userId, isAdmin }) {
  if (isAdmin) {
    return true;
  }
  if (!userId || !teamIds(parent).includes(userId)) {
    return false;
  }
  return assigneeIds(record).length === 0;
}
