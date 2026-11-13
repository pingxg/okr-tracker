/**
 * Access policy — a direct port of the original `firestore.rules`.
 *
 * Every read and write coming from the browser is checked here (spec §9: one
 * central permission module with automated tests). Server-internal writes
 * (triggers, the external API) do not go through this module, just as the
 * Firebase Admin SDK bypassed security rules.
 *
 * Firestore rule vocabulary used below:
 *   before    resource.data          (document before the write, null on create)
 *   after     request.resource.data  (document after the write, null on delete)
 *   get(p)    value of another document before the batch
 *   getAfter(p) value of another document after the batch
 */
import {
  REF,
  collectionPattern,
  collectionOf,
  idOf,
  isTaggedRef,
  normalizePath,
  pathSegments,
} from '../../../common/docstore/encoding.js';

export class PolicyError extends Error {
  constructor(message = 'Missing or insufficient permissions.') {
    super(message);
    this.statusCode = 403;
    this.code = 'permission-denied';
  }
}

const refPath = (value) => (isTaggedRef(value) ? normalizePath(value[REF]) : null);
const refId = (value) => {
  const p = refPath(value);
  return p ? idOf(p) : null;
};
const hasRef = (list, path) =>
  Array.isArray(list) && list.some((v) => refPath(v) === path);

/**
 * Identity of the caller.
 * @typedef {{ email: string, doc: object|null }} Actor   doc = users/{email} data
 */

const isSignedIn = (actor) => Boolean(actor?.email && actor.doc);
const isSuperAdmin = (actor) => isSignedIn(actor) && actor.doc.superAdmin === true;
const isAdmin = (actor) =>
  isSignedIn(actor) && Array.isArray(actor.doc.admin) && actor.doc.admin.length > 0;
const adminOf = (actor, orgId) =>
  isAdmin(actor) && Boolean(orgId) && actor.doc.admin.includes(orgId);
const userPath = (actor) => `users/${actor.email}`;

/**
 * Admin of the organization that `node` (an organization, department or
 * product document) belongs to. `nodeId` is the id of `node` itself.
 */
function isAdminOfNode(actor, node, nodeId) {
  if (!node) {
    return false;
  }
  if ('organization' in node) {
    return adminOf(actor, refId(node.organization));
  }
  return adminOf(actor, nodeId);
}

// --- rule helpers that look at other documents --------------------------------

async function isMemberOfParent(actor, data, lookup) {
  const parentPath = refPath(data?.parent);
  if (!parentPath) {
    return false;
  }
  const parent = await lookup(parentPath);
  return hasRef(parent?.team, userPath(actor));
}

async function isAdminOfParent(actor, data, getAfter) {
  const parentPath = refPath(data?.parent);
  if (!parentPath) {
    return false;
  }
  const parent = await getAfter(parentPath);
  return isAdminOfNode(actor, parent, idOf(parentPath));
}

async function isMemberOfItem(actor, data, lookup) {
  const itemPath = refPath(data?.item);
  if (!itemPath) {
    return false;
  }
  const item = await lookup(itemPath);
  return hasRef(item?.team, userPath(actor));
}

async function isAdminOfItem(actor, data, lookup) {
  const itemPath = refPath(data?.item);
  if (!itemPath) {
    return false;
  }
  const item = await lookup(itemPath);
  return isAdminOfNode(actor, item, idOf(itemPath));
}

async function isAdminOfObjectiveParent(actor, data, lookup) {
  const objectivePath = refPath(data?.objective);
  if (!objectivePath) {
    return false;
  }
  const objective = await lookup(objectivePath);
  const parentPath = refPath(objective?.parent);
  if (!parentPath) {
    return false;
  }
  const parent = await lookup(parentPath);
  return isAdminOfNode(actor, parent, idOf(parentPath));
}

async function objectiveParentIsItemOrItemParent(data, getAfter) {
  const itemPath = refPath(data?.item);
  const objectivePath = refPath(data?.objective);
  if (!itemPath || !objectivePath) {
    return false;
  }
  const item = await getAfter(itemPath);
  const objective = await getAfter(objectivePath);
  const objectiveParentPath = refPath(objective?.parent);
  if (!item || !objectiveParentPath) {
    return false;
  }
  if (objectiveParentPath === itemPath) {
    return true;
  }
  const isProduct = 'department' in item;
  const isDepartment = 'organization' in item;
  if (isProduct) {
    return refPath(item.department) === objectiveParentPath;
  }
  if (isDepartment) {
    return refPath(item.organization) === objectiveParentPath;
  }
  return false;
}

// --- assignees of key results and measurements ---------------------------------
//
// A key result or measurement (KPI) can be assigned to one or more members of
// its parent's team (`assignees`, user references).
//   - Not assigned: every member of the parent team may edit it (as before).
//   - Assigned: only the assignees edit it and record progress; other members
//     can only read it. Assignees cannot reassign, move or archive it.
//   - Super admins and admins of the organization may do everything.

/** Fields only admins (or members, while nobody is assigned) may change. */
const MANAGED_FIELDS = ['assignees', 'parent', 'objective', 'archived'];

/** A change of only these fields is a reorder of the key result list. */
const ORDER_FIELDS = ['order', 'edited', 'editedBy'];

/** User paths of the assignees, or null when the list is malformed. */
function assigneePaths(data) {
  const list = data?.assignees;
  if (list === undefined || list === null) {
    return [];
  }
  if (!Array.isArray(list)) {
    return null;
  }
  const paths = list.map(refPath);
  return paths.every((p) => p && collectionOf(p) === 'users') ? paths : null;
}

/** Every assignee is a member of the record's parent team. */
async function assigneesInTeam(data, lookup) {
  const paths = assigneePaths(data);
  if (paths === null) {
    return false;
  }
  if (!paths.length) {
    return true;
  }
  const parentPath = refPath(data?.parent);
  const parent = parentPath ? await lookup(parentPath) : null;
  return paths.every((p) => hasRef(parent?.team, p));
}

/** The actor may edit the record and its progress (see above). */
async function canEditAssigned(actor, data, lookup) {
  if (await isAdminOfParent(actor, data, lookup)) {
    return true;
  }
  if (!(await isMemberOfParent(actor, data, lookup))) {
    return false;
  }
  const paths = assigneePaths(data) || [];
  return paths.length === 0 || paths.includes(userPath(actor));
}

async function canWriteAssigned(actor, op, before, after, getBefore, getAfter) {
  if (op === 'create') {
    return (
      ((await isMemberOfParent(actor, after, getAfter)) ||
        (await isAdminOfParent(actor, after, getAfter))) &&
      (await assigneesInTeam(after, getAfter))
    );
  }
  // update
  if (
    (await isAdminOfParent(actor, before, getBefore)) &&
    (await isAdminOfParent(actor, after, getAfter))
  ) {
    return assigneesInTeam(after, getAfter);
  }
  if (!(await isMemberOfParent(actor, before, getBefore))) {
    return false;
  }
  const changed = affectedKeys(before, after);
  // Reordering the list of key results is arranging, not editing: any team
  // member may still do it.
  if (changed.every((key) => ORDER_FIELDS.includes(key))) {
    return true;
  }
  const assigned = assigneePaths(before) || [];
  if (!assigned.length) {
    return (
      (await isMemberOfParent(actor, after, getAfter)) &&
      (await assigneesInTeam(after, getAfter))
    );
  }
  if (!assigned.includes(userPath(actor))) {
    return false;
  }
  return !changed.some((key) => MANAGED_FIELDS.includes(key));
}

/** Keys whose values differ between two documents. */
function affectedKeys(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter(
    (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])
  );
}

// --- reads --------------------------------------------------------------------

const READ_RULES = {
  requestAccess: isSuperAdmin,
  audit: isSignedIn,
  users: isSignedIn,
  organizations: isSignedIn,
  departments: isSignedIn,
  products: isSignedIn,
  keyResults: isSignedIn,
  'keyResults/*/progress': isSignedIn,
  objectives: isSignedIn,
  objectiveContributors: isSignedIn,
  periods: isSignedIn,
  kpis: isSignedIn,
  'kpis/*/progress': isSignedIn,
  'kpis/*/goals': isSignedIn,
  apiClients: isSignedIn,
  'apiClients/*/secrets': () => false,
  slugs: isSignedIn,
};

export function canRead(actor, collectionPath) {
  const rule = READ_RULES[collectionPattern(normalizePath(collectionPath))];
  return Boolean(rule && rule(actor));
}

export function assertCanRead(actor, collectionPath) {
  if (!canRead(actor, collectionPath)) {
    throw new PolicyError();
  }
}

// --- writes -------------------------------------------------------------------

/**
 * Decide whether `actor` may perform `change`.
 * @param {Actor} actor
 * @param {{path: string, before: object|null, after: object|null}} change
 * @param {{getBefore: Function, getAfter: Function}} ctx
 */
export async function canWrite(actor, change, ctx) {
  const path = normalizePath(change.path);
  const { before, after } = change;
  let op = 'update';
  if (!before) {
    op = 'create';
  } else if (!after) {
    op = 'delete';
  }
  const pattern = collectionPattern(collectionOf(path));
  const segments = pathSegments(path);
  const { getBefore, getAfter } = ctx;

  const superAdmin = isSuperAdmin(actor);

  // Parent document (e.g. the key result for keyResults/{id}/progress/{p})
  const parentDocPath = segments.length >= 4 ? segments.slice(0, 2).join('/') : null;

  switch (pattern) {
    case 'requestAccess':
      // The request-access form is gone (Microsoft sign-in creates users);
      // only super admins may still tidy up old requests.
      return superAdmin;

    case 'users': {
      const isSelf = idOf(path) === actor?.email;
      if (superAdmin) {
        return true;
      }
      if (!isSignedIn(actor)) {
        return false;
      }
      // Deliberate deviation from firestore.rules: the original let any
      // authenticated account create its own user document ("isSelf"), i.e.
      // self-register. Here only admins create users; new people go through
      // access requests, the domain whitelist or INITIAL_ADMIN_EMAIL.
      if (op === 'create') {
        return isAdmin(actor) && !('superAdmin' in (after || {}));
      }
      if (op === 'update') {
        return (
          (isSelf || isAdmin(actor)) &&
          !affectedKeys(before, after).includes('superAdmin')
        );
      }
      return isSelf || isAdmin(actor);
    }

    case 'organizations':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (op === 'create' || op === 'delete') {
        return superAdmin;
      }
      return (
        superAdmin ||
        hasRef(after?.team, userPath(actor)) ||
        isAdminOfNode(actor, after, idOf(path))
      );

    case 'departments':
    case 'products':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (op === 'delete') {
        return superAdmin;
      }
      return (
        superAdmin ||
        hasRef(after?.team, userPath(actor)) ||
        isAdminOfNode(actor, after, idOf(path))
      );

    case 'keyResults':
    case 'kpis':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (op === 'delete') {
        return superAdmin;
      }
      return (
        superAdmin ||
        (await canWriteAssigned(actor, op, before, after, getBefore, getAfter))
      );

    case 'objectives':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (op === 'delete') {
        return superAdmin;
      }
      if (op === 'create') {
        return (
          superAdmin ||
          (await isMemberOfParent(actor, after, getAfter)) ||
          (await isAdminOfParent(actor, after, getAfter))
        );
      }
      return (
        superAdmin ||
        (await isMemberOfParent(actor, before, getBefore)) ||
        (await isAdminOfParent(actor, after, getAfter))
      );

    case 'keyResults/*/progress':
    case 'kpis/*/progress':
    case 'kpis/*/goals': {
      if (!isSignedIn(actor)) {
        return false;
      }
      if (superAdmin) {
        return true;
      }
      // Progress and goals follow the key result / measurement they belong to.
      return await canEditAssigned(actor, await getAfter(parentDocPath), getAfter);
    }

    case 'apiClients/*/secrets': {
      if (!isSignedIn(actor)) {
        return false;
      }
      if (superAdmin) {
        return true;
      }
      // Rules refer to the parent document as it is after the batch.
      const parent = await getAfter(parentDocPath);
      return (
        (await isMemberOfParent(actor, parent, getAfter)) ||
        (await isAdminOfParent(actor, parent, getAfter))
      );
    }

    case 'apiClients':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (superAdmin) {
        return true;
      }
      // On delete `getAfter(document)` is null in Firestore, so only super
      // admins can delete API clients.
      if (op === 'delete') {
        return false;
      }
      return (
        (await isMemberOfParent(actor, after, getAfter)) ||
        (await isAdminOfParent(actor, after, getAfter))
      );

    case 'objectiveContributors':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (superAdmin) {
        return true;
      }
      if (op === 'create') {
        return (
          ((await isMemberOfItem(actor, after, getAfter)) &&
            (await objectiveParentIsItemOrItemParent(after, getAfter))) ||
          ((await isAdminOfItem(actor, after, getAfter)) &&
            (await isAdminOfObjectiveParent(actor, after, getAfter)))
        );
      }
      if (op === 'delete') {
        return (
          (await isMemberOfItem(actor, before, getBefore)) ||
          ((await isAdminOfItem(actor, before, getBefore)) &&
            (await isAdminOfObjectiveParent(actor, before, getBefore)))
        );
      }
      return false;

    // periods, audit, slugs and everything else: no client writes.
    default:
      return false;
  }
}

/** Build an `authorize` callback for docstore.commit(). */
export function authorizerFor(actor) {
  return async (change, ctx) => {
    if (!(await canWrite(actor, change, ctx))) {
      throw new PolicyError(`Missing or insufficient permissions for ${change.path}.`);
    }
  };
}
