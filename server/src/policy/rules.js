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

// --- roles -------------------------------------------------------------------------
//
// Roles are set per organization by its admins (users/{email}.roles =
// { <orgId>: 'projectManager' | 'projectCoordinator' }). In the departments
// and teams a person is a member of:
//   - project manager:     manages OKRs, measurements and the member list;
//   - project coordinator: records progress and edits key results /
//                          measurements assigned to them or to nobody;
//   - no role:             reads only.
// Admins of the organization and super admins may do everything.

export const ROLE_MANAGER = 'projectManager';
export const ROLE_COORDINATOR = 'projectCoordinator';
const ROLES = [ROLE_MANAGER, ROLE_COORDINATOR];

/** Organization id of an organization, department or team document. */
function orgIdOfNode(node, nodeId) {
  if (!node) {
    return null;
  }
  return 'organization' in node ? refId(node.organization) : nodeId;
}

const roleIn = (actor, orgId) => {
  const roles = actor?.doc?.roles;
  return orgId && roles && typeof roles === 'object' ? roles[orgId] || null : null;
};

/** The actor's role in `node` if they are on its team, else null. */
function memberRole(actor, node, nodeId) {
  if (!node || !hasRef(node.team, userPath(actor))) {
    return null;
  }
  return roleIn(actor, orgIdOfNode(node, nodeId));
}

// --- rule helpers that look at other documents --------------------------------

async function parentRole(actor, data, lookup) {
  const parentPath = refPath(data?.parent);
  if (!parentPath) {
    return null;
  }
  return memberRole(actor, await lookup(parentPath), idOf(parentPath));
}

/** Project manager on the team of the document's parent item. */
async function isManagerOfParent(actor, data, lookup) {
  return (await parentRole(actor, data, lookup)) === ROLE_MANAGER;
}

/** Project coordinator on the team of the document's parent item. */
async function isCoordinatorOfParent(actor, data, lookup) {
  return (await parentRole(actor, data, lookup)) === ROLE_COORDINATOR;
}

async function isAdminOfParent(actor, data, getAfter) {
  const parentPath = refPath(data?.parent);
  if (!parentPath) {
    return false;
  }
  const parent = await getAfter(parentPath);
  return isAdminOfNode(actor, parent, idOf(parentPath));
}

/** Project manager on the team of the document's `item`. */
async function isManagerOfItem(actor, data, lookup) {
  const itemPath = refPath(data?.item);
  if (!itemPath) {
    return false;
  }
  return memberRole(actor, await lookup(itemPath), idOf(itemPath)) === ROLE_MANAGER;
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

// --- users and items ---------------------------------------------------------------

/** User fields nobody but super admins may change. */
const USER_LOCKED_FIELDS = ['superAdmin', 'id', 'email'];

/**
 * Organization admin rights may only change for organizations the actor is
 * an admin of (super admins are allowed before this is reached).
 */
function adminChangeAllowed(actor, beforeList, afterList) {
  const toSet = (list) => new Set(Array.isArray(list) ? list : []);
  const before = toSet(beforeList);
  const after = toSet(afterList);
  if (afterList !== undefined && afterList !== null && !Array.isArray(afterList)) {
    return false;
  }
  const changed = [
    ...[...before].filter((id) => !after.has(id)),
    ...[...after].filter((id) => !before.has(id)),
  ];
  const mine = actor.doc?.admin || [];
  return changed.every((id) => mine.includes(id));
}

/**
 * Roles may only change for organizations the actor is an admin of; a role
 * is one of ROLES (or removed).
 */
function rolesChangeAllowed(actor, beforeRoles, afterRoles) {
  if (afterRoles !== undefined && afterRoles !== null) {
    if (typeof afterRoles !== 'object' || Array.isArray(afterRoles)) {
      return false;
    }
    if (!Object.values(afterRoles).every((r) => r === null || ROLES.includes(r))) {
      return false;
    }
  }
  const before = beforeRoles && typeof beforeRoles === 'object' ? beforeRoles : {};
  const after = afterRoles && typeof afterRoles === 'object' ? afterRoles : {};
  const orgs = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...orgs].filter(
    (org) => (before[org] || null) !== (after[org] || null)
  );
  const mine = actor.doc?.admin || [];
  return changed.every((org) => mine.includes(org));
}

/**
 * Item fields only admins change: where the item sits and whether it is
 * archived. Project managers may also change its member list.
 */
const ITEM_ADMIN_FIELDS = ['organization', 'department', 'archived'];

const keepsAdminFields = (before, after) =>
  !affectedKeys(before, after).some((key) => ITEM_ADMIN_FIELDS.includes(key));

// --- key results and measurements --------------------------------------------------
//
// A key result or measurement (KPI) can be assigned to one or more members of
// its parent's team (`assignees`, user references).
//   - Admins and project managers of the parent item may do everything:
//     create, edit, assign, move (where they manage too), archive, reorder.
//   - Project coordinators edit the content and record progress of those
//     assigned to them or to nobody; they cannot create, assign, move,
//     reorder or archive.
//   - Everyone else reads only.

/** Fields coordinators may not change. */
const MANAGED_FIELDS = ['assignees', 'parent', 'objective', 'archived', 'order'];

async function managesParent(actor, data, lookup) {
  return (
    (await isAdminOfParent(actor, data, lookup)) ||
    (await isManagerOfParent(actor, data, lookup))
  );
}

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

/** The actor may edit the record and record its progress (see above). */
async function canEditAssigned(actor, data, lookup) {
  if (await managesParent(actor, data, lookup)) {
    return true;
  }
  if (!(await isCoordinatorOfParent(actor, data, lookup))) {
    return false;
  }
  const paths = assigneePaths(data) || [];
  return paths.length === 0 || paths.includes(userPath(actor));
}

async function canWriteAssigned(actor, op, before, after, getBefore, getAfter) {
  if (op === 'create') {
    return (
      (await managesParent(actor, after, getAfter)) &&
      (await assigneesInTeam(after, getAfter))
    );
  }
  // update
  const changed = affectedKeys(before, after);
  if (await managesParent(actor, before, getBefore)) {
    // Moving it needs management rights at the new place as well.
    if (changed.includes('parent') && !(await managesParent(actor, after, getAfter))) {
      return false;
    }
    return assigneesInTeam(after, getAfter);
  }
  // Coordinators: content of what is assigned to them or to nobody.
  if (!(await canEditAssigned(actor, before, getBefore))) {
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
      // Deliberate deviations from firestore.rules:
      // - only admins create users (no self-registration);
      // - admin rights are granted by super admins, or by an organization's
      //   admins for that organization only (the original let anyone edit
      //   their own `admin` list, and any admin edit anyone's);
      // - only super admins delete users.
      // Roles (per organization) follow the same rule as admin rights.
      if (op === 'create') {
        return (
          isAdmin(actor) &&
          !after?.superAdmin &&
          adminChangeAllowed(actor, [], after?.admin) &&
          rolesChangeAllowed(actor, {}, after?.roles)
        );
      }
      if (op === 'update') {
        const changed = affectedKeys(before, after);
        if (USER_LOCKED_FIELDS.some((key) => changed.includes(key))) {
          return false;
        }
        if (
          changed.includes('admin') &&
          !(isAdmin(actor) && adminChangeAllowed(actor, before?.admin, after?.admin))
        ) {
          return false;
        }
        if (
          changed.includes('roles') &&
          !(isAdmin(actor) && rolesChangeAllowed(actor, before?.roles, after?.roles))
        ) {
          return false;
        }
        return isSelf || isAdmin(actor);
      }
      return false;
    }

    case 'organizations':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (op === 'create' || op === 'delete') {
        return superAdmin;
      }
      if (superAdmin || isAdminOfNode(actor, after, idOf(path))) {
        return true;
      }
      // Project managers edit the content and member list, not the archive state.
      return (
        memberRole(actor, before, idOf(path)) === ROLE_MANAGER &&
        keepsAdminFields(before, after)
      );

    case 'departments':
    case 'products':
      if (!isSignedIn(actor)) {
        return false;
      }
      if (op === 'delete') {
        return superAdmin;
      }
      if (superAdmin) {
        return true;
      }
      // Only admins of the organization create departments and teams.
      if (op === 'create') {
        return isAdminOfNode(actor, after, idOf(path));
      }
      // Admins of the organization it is in (and moves to) manage it.
      if (
        isAdminOfNode(actor, before, idOf(path)) &&
        isAdminOfNode(actor, after, idOf(path))
      ) {
        return true;
      }
      // Project managers edit the content and member list, not the place or
      // archive state.
      return (
        memberRole(actor, before, idOf(path)) === ROLE_MANAGER &&
        keepsAdminFields(before, after)
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
          (await isManagerOfParent(actor, after, getAfter)) ||
          (await isAdminOfParent(actor, after, getAfter))
        );
      }
      return (
        superAdmin ||
        (await isManagerOfParent(actor, before, getBefore)) ||
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
        (await isManagerOfParent(actor, parent, getAfter)) ||
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
        (await isManagerOfParent(actor, after, getAfter)) ||
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
          ((await isManagerOfItem(actor, after, getAfter)) &&
            (await objectiveParentIsItemOrItemParent(after, getAfter))) ||
          ((await isAdminOfItem(actor, after, getAfter)) &&
            (await isAdminOfObjectiveParent(actor, after, getAfter)))
        );
      }
      if (op === 'delete') {
        return (
          (await isManagerOfItem(actor, before, getBefore)) ||
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
