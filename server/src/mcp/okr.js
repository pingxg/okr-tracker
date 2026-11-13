/**
 * Data access for the MCP tools. Reads use the document store directly;
 * every write goes through `commit` with the caller's policy authorizer,
 * exactly like the web app's /api/v1/docs/commit. The rights computed here
 * only explain things to the assistant; the policy decides.
 */
import {
  OP,
  REF,
  TS,
  autoId,
  collectionOf,
  idOf,
  isTaggedRef,
  isTaggedTimestamp,
  tagRef,
  tagTimestamp,
} from '../../../common/docstore/encoding.js';
import { authorizerFor, assertCanRead, PolicyError } from '../policy/rules.js';
import { commit, getDocument, getDocuments, queryDocuments } from '../store/docstore.js';

// --- item kinds ----------------------------------------------------------------

/** "team" in the UI is the `products` collection. */
export const KIND_OF_COLLECTION = {
  organizations: 'organization',
  departments: 'department',
  products: 'team',
};
const ITEM_COLLECTIONS = Object.keys(KIND_OF_COLLECTION);

export class ToolError extends Error {}

/** Validate "organizations/<id>" | "departments/<id>" | "products/<id>". */
export function assertItemRef(value) {
  const path = String(value || '').trim();
  const [collection, id, extra] = path.split('/');
  if (!ITEM_COLLECTIONS.includes(collection) || !id || extra !== undefined) {
    throw new ToolError(
      `"${value}" is not an item reference. Use one from list_structure, e.g. "departments/<id>" (teams are "products/<id>").`
    );
  }
  return path;
}

// --- decoding for the assistant ------------------------------------------------

/** Stored data -> plain JSON: references become paths, timestamps ISO strings. */
export function plain(value) {
  if (Array.isArray(value)) {
    return value.map(plain);
  }
  if (isTaggedRef(value)) {
    return value[REF];
  }
  if (isTaggedTimestamp(value)) {
    return value[TS];
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

const refPath = (value) => (isTaggedRef(value) ? value[REF] : null);
const refList = (list) => (Array.isArray(list) ? list.map(refPath).filter(Boolean) : []);
const emailOf = (userPath) => (userPath ? idOf(userPath) : null);

// --- rights (explanations; the policy is the gate) ------------------------------

export function organizationIdOf(itemPath, item) {
  if (item?.organization) {
    return idOf(refPath(item.organization));
  }
  return collectionOf(itemPath) === 'organizations' ? idOf(itemPath) : null;
}

export const ROLE_MANAGER = 'projectManager';
export const ROLE_COORDINATOR = 'projectCoordinator';

/** The actor's role in an organization ('projectManager' | 'projectCoordinator' | null). */
export const roleIn = (actor, orgId) => {
  const roles = actor.doc?.roles;
  return orgId && roles && typeof roles === 'object' ? roles[orgId] || null : null;
};

export function itemRights(actor, itemPath, item) {
  const me = `users/${actor.email}`;
  const superAdmin = actor.doc?.superAdmin === true;
  const orgId = organizationIdOf(itemPath, item);
  const orgAdmin = Boolean(orgId) && (actor.doc?.admin || []).includes(orgId);
  const member = refList(item?.team).includes(me);
  const role = member ? roleIn(actor, orgId) : null;
  return {
    superAdmin,
    orgAdmin,
    member,
    role,
    // create/edit objectives, create key results and measurements here
    canEditOkrs: superAdmin || orgAdmin || role === ROLE_MANAGER,
  };
}

/** Why the actor may not create or edit objectives here, in plain words. */
export function okrRefusal(item, itemName) {
  if (!item.member) {
    return `you are not a member of ${itemName} or an admin of its organization.`;
  }
  if (item.role === ROLE_COORDINATOR) {
    return `you are a project coordinator in ${itemName}; only project managers and admins create and edit objectives, key results and measurements.`;
  }
  return `you have no role in ${itemName} yet (read only); ask an admin to make you a project manager or coordinator.`;
}

/** Rights on a key result or measurement, with the reason in plain words. */
export function recordRights(actor, record, parentPath, parent) {
  const me = `users/${actor.email}`;
  const item = itemRights(actor, parentPath, parent);
  const assignees = refList(record?.assignees);
  const assigned = assignees.includes(me);

  let canEdit = false;
  let canManage = false;
  let reason;
  if (item.superAdmin || item.orgAdmin) {
    canEdit = true;
    canManage = true;
    reason = item.superAdmin
      ? 'You are a super admin.'
      : 'You are an admin of this organization.';
  } else if (!item.member) {
    reason = 'You are not a member of the team it belongs to, so you can only read it.';
  } else if (item.role === ROLE_MANAGER) {
    canEdit = true;
    canManage = true;
    reason = 'You are a project manager of the team it belongs to.';
  } else if (item.role !== ROLE_COORDINATOR) {
    reason =
      'You have no role in this team yet, so you can only read it; ask an admin to make you a project manager or coordinator.';
  } else if (!assignees.length || assigned) {
    canEdit = true;
    reason = assigned
      ? 'You are a project coordinator assigned to it: you may edit it and record progress, but only project managers and admins assign, move or archive.'
      : 'Nobody is assigned and you are a project coordinator of its team: you may edit it and record progress, but not assign, move or archive it.';
  } else {
    reason = `It is assigned to ${assignees
      .map(emailOf)
      .join(', ')}; as a project coordinator you can only read it.`;
  }
  return { canEdit, canRecordProgress: canEdit, canManage, reason };
}

// --- reading ---------------------------------------------------------------------

export async function readDoc(actor, path) {
  assertCanRead(actor, collectionOf(path));
  const doc = await getDocument(path);
  if (!doc.exists) {
    throw new ToolError(`${path} was not found.`);
  }
  return doc.data;
}

export async function readQuery(actor, collection, constraints) {
  assertCanRead(actor, collection);
  return queryDocuments(collection, constraints);
}

export async function readMany(actor, paths) {
  const docs = await getDocuments(paths);
  paths.forEach((p) => assertCanRead(actor, collectionOf(p)));
  return docs;
}

export const where = (field, op, value) => ({ type: 'where', field, op, value });
export const orderBy = (field, direction = 'asc') => ({
  type: 'orderBy',
  field,
  direction,
});
export const limit = (n) => ({ type: 'limit', limit: n });

// --- writing -----------------------------------------------------------------------

const serverTimestamp = { [OP]: 'serverTimestamp' };
export const deleteField = { [OP]: 'delete' };

export const created = (actor) => ({
  archived: false,
  created: serverTimestamp,
  createdBy: tagRef(`users/${actor.email}`),
});
export const edited = (actor) => ({
  edited: serverTimestamp,
  editedBy: tagRef(`users/${actor.email}`),
});

export { tagRef, tagTimestamp, autoId, refPath, refList, emailOf };

/**
 * Commit writes as the actor. A policy refusal becomes a ToolError with
 * `explanation` (why the person may not do this).
 */
export async function write(actor, ops, explanation) {
  try {
    return await commit(ops, { authorize: authorizerFor(actor) });
  } catch (error) {
    if (error instanceof PolicyError || error.statusCode === 403) {
      throw new ToolError(
        `Not allowed: ${
          explanation || 'your rights do not allow this change.'
        } Nothing was changed.`
      );
    }
    throw error;
  }
}

/** Dates as the web app stores them. */
export function dateValue(value, name) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new ToolError(`${name} must be a date like 2026-12-31.`);
  }
  return date;
}

/**
 * Keep objectiveContributors in line with the teams owning the objective's
 * key results (same as the web app's syncObjectiveContributors). Best effort:
 * the change itself is already saved.
 */
export async function syncObjectiveContributors(actor, objectivePath) {
  try {
    const objectiveRef = tagRef(objectivePath);
    const keyResults = await queryDocuments('keyResults', [
      where('objective', '==', objectiveRef),
      where('archived', '==', false),
    ]);
    const owners = [
      ...new Set(keyResults.map((kr) => refPath(kr.data.parent)).filter(Boolean)),
    ];
    const contributors = await queryDocuments('objectiveContributors', [
      where('objective', '==', objectiveRef),
    ]);
    const existing = new Map(contributors.map((c) => [refPath(c.data.item), c.path]));
    const ops = [];
    owners
      .filter((owner) => !existing.has(owner))
      .forEach((owner) =>
        ops.push({
          type: 'create',
          path: `objectiveContributors/${autoId()}`,
          data: { item: tagRef(owner), objective: objectiveRef, ...created(actor) },
        })
      );
    existing.forEach((path, owner) => {
      if (!owners.includes(owner)) {
        ops.push({ type: 'delete', path });
      }
    });
    if (ops.length) {
      await commit(ops, { authorize: authorizerFor(actor) });
    }
  } catch {
    // Not fatal; the web app also ignores failures here.
  }
}
