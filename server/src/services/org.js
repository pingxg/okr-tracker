/**
 * Organisation structure (spec §3): nodes, their history, and memberships.
 *
 * Every change is effective-dated. Changing a node or membership closes the
 * current row on the effective date and adds a new one, unless the change is
 * effective on the same day the current row started, in which case the row is
 * corrected in place. Changes can only be appended after the latest one, never
 * inserted into the past.
 */
import { db } from '../db/tx.js';
import { today, isISODate } from '../lib/dates.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import * as access from '../policy/access.js';
import { recordRevision } from './audit.js';
import { getNodeTypes } from './settings.js';

const ROOT_TYPE = 'group';

// ---------------------------------------------------------------------------
// Row mapping

const mapVersion = (r) => ({
  id: r.node_id,
  parentId: r.parent_id,
  type: r.type,
  nameZh: r.name_zh,
  nameEn: r.name_en,
  validFrom: r.valid_from,
  validTo: r.valid_to,
});

const mapMembership = (r) => ({
  id: r.id,
  userId: r.user_id,
  nodeId: r.node_id,
  role: r.role,
  reportsTo: r.reports_to,
  isPrimary: r.is_primary,
  validFrom: r.valid_from,
  validTo: r.valid_to,
});

const IN_EFFECT = (alias, param) =>
  `${alias}.valid_from <= ${param} AND (${alias}.valid_to IS NULL OR ${param} < ${alias}.valid_to)`;

function effectiveDate(value) {
  if (value === undefined || value === null) {
    return today();
  }
  if (!isISODate(value)) {
    throw badRequest('invalid_date', 'Dates must be YYYY-MM-DD');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Reading the structure

/** Node versions in effect on `date`. */
async function versionsOn(date, client) {
  const { rows } = await db(client).query(
    `SELECT * FROM org_node_version v WHERE ${IN_EFFECT('v', '$1')}`,
    [date]
  );
  return rows.map(mapVersion);
}

function treeFrom(nodes) {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const root = nodes.find((n) => n.parentId === null);
  return { parentOf, rootId: root ? root.id : null };
}

/**
 * The structure used for permission checks: every node with its current
 * version, or its latest one if it is not in effect today (a node scheduled to
 * start later, so leads can keep working on it).
 */
export async function policyTree(client) {
  const { rows } = await db(client).query(
    `SELECT DISTINCT ON (node_id) * FROM org_node_version v
     ORDER BY node_id, (${IN_EFFECT('v', '$1')}) DESC, valid_from DESC`,
    [today()]
  );
  return treeFrom(rows.map(mapVersion));
}

/** Memberships in effect on `date`, optionally for one user or one node. */
export async function membershipsOn(date, filter, client) {
  const { userId, nodeId } = filter || {};
  const conditions = [IN_EFFECT('m', '$1')];
  const params = [date];
  if (userId) {
    params.push(userId);
    conditions.push(`m.user_id = $${params.length}`);
  }
  if (nodeId) {
    params.push(nodeId);
    conditions.push(`m.node_id = $${params.length}`);
  }
  const { rows } = await db(client).query(
    `SELECT m.*, u.name AS user_name, u.email AS user_email, u.status AS user_status,
            r.name AS reports_to_name, r.email AS reports_to_email
     FROM membership m
     JOIN app_user u ON u.id = m.user_id
     LEFT JOIN app_user r ON r.id = m.reports_to
     WHERE ${conditions.join(' AND ')}
     ORDER BY u.name NULLS LAST, u.email`,
    params
  );
  return rows.map((r) => ({
    ...mapMembership(r),
    user: {
      id: r.user_id,
      name: r.user_name,
      email: r.user_email,
      status: r.user_status,
    },
    reportsToUser: r.reports_to
      ? { id: r.reports_to, name: r.reports_to_name, email: r.reports_to_email }
      : null,
  }));
}

const LEAD_ROLES = new Set(['group_admin', 'entity_lead', 'team_lead']);

/** GET /org/tree: the whole structure on a date, with leads and head counts. */
export async function getTree(options, client) {
  const on = effectiveDate(options?.date);
  const [nodes, memberships, nodeTypes] = await Promise.all([
    versionsOn(on, client),
    membershipsOn(on, {}, client),
    getNodeTypes(client),
  ]);
  const byNode = new Map(nodes.map((n) => [n.id, { ...n, leads: [], memberCount: 0 }]));
  const counted = new Map(); // nodeId -> Set(userId)
  for (const m of memberships) {
    const node = byNode.get(m.nodeId);
    if (!node) {
      continue;
    }
    if (LEAD_ROLES.has(m.role)) {
      node.leads.push({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
      });
    }
    if (!counted.has(m.nodeId)) {
      counted.set(m.nodeId, new Set());
    }
    counted.get(m.nodeId).add(m.userId);
  }
  for (const [nodeId, people] of counted) {
    byNode.get(nodeId).memberCount = people.size;
  }
  return {
    date: on,
    rootId: treeFrom(nodes).rootId,
    nodeTypes,
    nodes: [...byNode.values()],
  };
}

/** GET /org/nodes/{id}: one node on a date, with its path, children, people and history. */
export async function getNode(nodeId, options, client) {
  const on = effectiveDate(options?.date);
  const { rows: history } = await db(client).query(
    'SELECT * FROM org_node_version WHERE node_id = $1 ORDER BY valid_from',
    [nodeId]
  );
  if (!history.length) {
    throw notFound('Node');
  }
  const versions = history.map(mapVersion);
  const current =
    versions.find((v) => v.validFrom <= on && (v.validTo === null || on < v.validTo)) ||
    null;

  const nodes = await versionsOn(on, client);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const tree = treeFrom(nodes);
  const ancestors = current
    ? access
        .ancestorsOf(tree, nodeId)
        .slice(1)
        .reverse()
        .map((id) => byId.get(id))
        .filter(Boolean)
    : [];
  const children = nodes.filter((n) => n.parentId === nodeId);
  const memberships = current ? await membershipsOn(on, { nodeId }, client) : [];

  return {
    date: on,
    node: current || versions[versions.length - 1],
    inEffect: Boolean(current),
    ancestors,
    children,
    memberships,
    history: versions,
  };
}

async function latestVersion(nodeId, client) {
  const { rows } = await db(client).query(
    'SELECT * FROM org_node_version WHERE node_id = $1 ORDER BY valid_from DESC LIMIT 1',
    [nodeId]
  );
  return rows.length ? rows[0] : null;
}

async function versionOn(nodeId, date, client) {
  const { rows } = await db(client).query(
    `SELECT * FROM org_node_version v WHERE v.node_id = $1 AND ${IN_EFFECT('v', '$2')}`,
    [nodeId, date]
  );
  return rows.length ? rows[0] : null;
}

// ---------------------------------------------------------------------------
// Changing nodes

async function assertNodeType(type, client) {
  const types = await getNodeTypes(client);
  if (!types.some((t) => t.key === type)) {
    throw badRequest('invalid_node_type', `Unknown node type: ${type}`);
  }
  if (type === ROOT_TYPE) {
    throw badRequest('invalid_node_type', 'There is only one group node');
  }
}

function assertName({ nameZh, nameEn }) {
  if (!(nameZh && nameZh.trim()) && !(nameEn && nameEn.trim())) {
    throw badRequest('name_required', 'A Chinese or English name is required');
  }
}

const clean = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);

/** POST /org/nodes */
export async function createNode(ctx, input, client) {
  const on = effectiveDate(input.effectiveDate);
  assertName(input);
  await assertNodeType(input.type, client);

  const parent = await versionOn(input.parentId, on, client);
  if (!parent) {
    throw badRequest(
      'invalid_parent',
      'The parent node does not exist on the effective date'
    );
  }
  if (!access.canCreateNode(ctx.actor, await policyTree(client), input.parentId)) {
    throw forbidden();
  }

  const {
    rows: [node],
  } = await client.query('INSERT INTO org_node (created_by) VALUES ($1) RETURNING id', [
    ctx.actor.id,
  ]);
  const {
    rows: [version],
  } = await client.query(
    `INSERT INTO org_node_version (node_id, parent_id, type, name_zh, name_en, valid_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      node.id,
      input.parentId,
      input.type,
      clean(input.nameZh),
      clean(input.nameEn),
      on,
      ctx.actor.id,
    ]
  );
  const created = mapVersion(version);
  await recordRevision(client, {
    table: 'org_node',
    recordId: node.id,
    action: 'create',
    ctx,
    after: created,
  });
  return created;
}

/** Nodes below `nodeId` on `date` (not including the node). */
async function descendantsOn(nodeId, date, client) {
  const nodes = await versionsOn(date, client);
  const tree = treeFrom(nodes);
  return nodes.filter((n) => access.isBelow(tree, n.id, nodeId)).map((n) => n.id);
}

/**
 * PATCH /org/nodes/{id}: rename, change type, move (parentId) or deactivate
 * (active: false), effective on `effectiveDate` (default today).
 */
export async function updateNode(ctx, nodeId, input, client) {
  const on = effectiveDate(input.effectiveDate);
  const latest = await latestVersion(nodeId, client);
  if (!latest) {
    throw notFound('Node');
  }
  if (latest.valid_to !== null) {
    throw badRequest('node_inactive', 'The node has been deactivated');
  }
  if (on < latest.valid_from) {
    throw badRequest(
      'effective_date_too_early',
      `Changes must take effect on or after ${latest.valid_from}`
    );
  }

  const isRoot = latest.parent_id === null;
  const deactivate = input.active === false;
  const moving = input.parentId !== undefined && input.parentId !== latest.parent_id;

  if (isRoot && (deactivate || moving)) {
    throw badRequest('root_node', 'The group node cannot be moved or deactivated');
  }

  const tree = await policyTree(client);
  if (deactivate || moving) {
    if (
      !access.canRestructureNode(
        ctx.actor,
        tree,
        nodeId,
        moving ? input.parentId : undefined
      )
    ) {
      throw forbidden();
    }
  } else if (!access.canEditNode(ctx.actor, tree, nodeId)) {
    throw forbidden();
  }

  const before = mapVersion(latest);

  if (deactivate) {
    return deactivateNode(ctx, latest, on, input.reason, client);
  }

  const next = {
    parentId: moving ? input.parentId : latest.parent_id,
    type: input.type ?? latest.type,
    nameZh: input.nameZh !== undefined ? clean(input.nameZh) : latest.name_zh,
    nameEn: input.nameEn !== undefined ? clean(input.nameEn) : latest.name_en,
  };
  assertName(next);
  if (input.type !== undefined && input.type !== latest.type) {
    if (isRoot) {
      throw badRequest('root_node', 'The group node keeps its type');
    }
    await assertNodeType(input.type, client);
  }
  if (moving) {
    if (!(await versionOn(input.parentId, on, client))) {
      throw badRequest(
        'invalid_parent',
        'The new parent does not exist on the effective date'
      );
    }
    if ((await descendantsOn(nodeId, on, client)).includes(input.parentId)) {
      throw badRequest('invalid_parent', 'A node cannot be moved below itself');
    }
  }

  let row;
  if (on === latest.valid_from) {
    // Correction on the day the version started: no new history row.
    ({
      rows: [row],
    } = await client.query(
      `UPDATE org_node_version SET parent_id = $2, type = $3, name_zh = $4, name_en = $5
       WHERE id = $1 RETURNING *`,
      [latest.id, next.parentId, next.type, next.nameZh, next.nameEn]
    ));
  } else {
    await client.query('UPDATE org_node_version SET valid_to = $2 WHERE id = $1', [
      latest.id,
      on,
    ]);
    ({
      rows: [row],
    } = await client.query(
      `INSERT INTO org_node_version (node_id, parent_id, type, name_zh, name_en, valid_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nodeId, next.parentId, next.type, next.nameZh, next.nameEn, on, ctx.actor.id]
    ));
  }
  const after = mapVersion(row);
  await recordRevision(client, {
    table: 'org_node',
    recordId: nodeId,
    action: 'update',
    ctx,
    before,
    after,
    reason: input.reason,
  });
  return after;
}

async function deactivateNode(ctx, latest, on, reason, client) {
  const nodeId = latest.node_id;
  const { rows: children } = await client.query(
    'SELECT 1 FROM org_node_version WHERE parent_id = $1 AND valid_to IS NULL LIMIT 1',
    [nodeId]
  );
  if (children.length) {
    throw badRequest('node_has_children', 'Move or deactivate the nodes below it first');
  }
  const { rows: open } = await client.query(
    'SELECT * FROM membership WHERE node_id = $1 AND valid_to IS NULL',
    [nodeId]
  );
  if (open.some((m) => m.valid_from > on)) {
    throw badRequest(
      'node_has_future_memberships',
      'Some memberships start after the effective date'
    );
  }
  if (open.some((m) => m.role === 'group_admin')) {
    throw badRequest('root_node', 'The group node cannot be deactivated');
  }
  for (const m of open) {
    const {
      rows: [ended],
    } = await client.query(
      'UPDATE membership SET valid_to = $2 WHERE id = $1 RETURNING *',
      [m.id, on]
    );
    await recordRevision(client, {
      table: 'membership',
      recordId: m.id,
      action: 'update',
      ctx,
      before: mapMembership(m),
      after: mapMembership(ended),
      reason: reason || 'Node deactivated',
    });
  }
  const {
    rows: [row],
  } = await client.query(
    'UPDATE org_node_version SET valid_to = $2 WHERE id = $1 RETURNING *',
    [latest.id, on]
  );
  const after = mapVersion(row);
  await recordRevision(client, {
    table: 'org_node',
    recordId: nodeId,
    action: 'delete',
    ctx,
    before: mapVersion(latest),
    after,
    reason,
  });
  return after;
}

// ---------------------------------------------------------------------------
// Memberships

async function assertActiveUser(userId, code, client) {
  const { rows } = await db(client).query('SELECT status FROM app_user WHERE id = $1', [
    userId,
  ]);
  if (!rows.length || rows[0].status !== 'active') {
    throw badRequest(code, 'The person does not exist or is no longer active');
  }
}

async function assertRoleFitsNode(role, nodeId, client) {
  if (role !== 'group_admin') {
    return;
  }
  const latest = await latestVersion(nodeId, client);
  if (!latest || latest.parent_id !== null) {
    throw badRequest('invalid_role', 'Group admins belong to the group node');
  }
}

async function assertAnotherGroupAdmin(membershipId, client) {
  const { rows } = await client.query(
    `SELECT 1 FROM membership m JOIN app_user u ON u.id = m.user_id
     WHERE m.role = 'group_admin' AND m.valid_to IS NULL AND m.id <> $1 AND u.status = 'active'
     LIMIT 1`,
    [membershipId]
  );
  if (!rows.length) {
    throw badRequest('last_group_admin', 'The group needs at least one group admin');
  }
}

async function clearOtherPrimary(userId, keepId, client) {
  await client.query(
    `UPDATE membership SET is_primary = false
     WHERE user_id = $1 AND id <> $2 AND valid_to IS NULL AND is_primary`,
    [userId, keepId]
  );
}

/** POST /memberships */
export async function addMembership(ctx, input, client) {
  const on = effectiveDate(input.effectiveDate);
  if (!(await versionOn(input.nodeId, on, client))) {
    throw badRequest('invalid_node', 'The node does not exist on the effective date');
  }
  if (
    !access.canManageMembership(
      ctx.actor,
      await policyTree(client),
      input.nodeId,
      input.role
    )
  ) {
    throw forbidden();
  }
  await assertActiveUser(input.userId, 'invalid_user', client);
  await assertRoleFitsNode(input.role, input.nodeId, client);
  if (input.reportsTo) {
    if (input.reportsTo === input.userId) {
      throw badRequest('invalid_reports_to', 'People cannot report to themselves');
    }
    await assertActiveUser(input.reportsTo, 'invalid_reports_to', client);
  }

  const { rows: existing } = await client.query(
    `SELECT 1 FROM membership
     WHERE user_id = $1 AND node_id = $2 AND role = $3 AND valid_to IS NULL`,
    [input.userId, input.nodeId, input.role]
  );
  if (existing.length) {
    throw conflict('membership_exists', 'The person already has this role on this node');
  }

  const {
    rows: [row],
  } = await client.query(
    `INSERT INTO membership (user_id, node_id, role, reports_to, is_primary, valid_from, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      input.userId,
      input.nodeId,
      input.role,
      input.reportsTo || null,
      Boolean(input.isPrimary),
      on,
      ctx.actor.id,
    ]
  );
  if (row.is_primary) {
    await clearOtherPrimary(row.user_id, row.id, client);
  }
  const created = mapMembership(row);
  await recordRevision(client, {
    table: 'membership',
    recordId: row.id,
    action: 'create',
    ctx,
    after: created,
  });
  return created;
}

/**
 * PATCH /memberships/{id}: change role or reporting line (effective-dated),
 * set the primary flag, or end the membership (end: true).
 */
export async function updateMembership(ctx, membershipId, input, client) {
  const on = effectiveDate(input.effectiveDate);
  const { rows } = await client.query('SELECT * FROM membership WHERE id = $1', [
    membershipId,
  ]);
  if (!rows.length) {
    throw notFound('Membership');
  }
  const current = rows[0];
  if (current.valid_to !== null) {
    throw badRequest('membership_ended', 'The membership has already ended');
  }
  if (on < current.valid_from) {
    throw badRequest(
      'effective_date_too_early',
      `Changes must take effect on or after ${current.valid_from}`
    );
  }

  const tree = await policyTree(client);
  const newRole = input.role ?? current.role;
  if (
    !access.canManageMembership(ctx.actor, tree, current.node_id, current.role) ||
    !access.canManageMembership(ctx.actor, tree, current.node_id, newRole)
  ) {
    throw forbidden();
  }

  const before = mapMembership(current);
  const losesGroupAdmin =
    current.role === 'group_admin' && (input.end || newRole !== current.role);
  if (losesGroupAdmin) {
    await assertAnotherGroupAdmin(current.id, client);
  }

  if (input.end) {
    const {
      rows: [ended],
    } = await client.query(
      'UPDATE membership SET valid_to = $2 WHERE id = $1 RETURNING *',
      [current.id, on]
    );
    const after = mapMembership(ended);
    await recordRevision(client, {
      table: 'membership',
      recordId: current.id,
      action: 'delete',
      ctx,
      before,
      after,
      reason: input.reason,
    });
    return after;
  }

  await assertRoleFitsNode(newRole, current.node_id, client);
  const newReportsTo =
    input.reportsTo !== undefined ? input.reportsTo : current.reports_to;
  if (newReportsTo && newReportsTo !== current.reports_to) {
    if (newReportsTo === current.user_id) {
      throw badRequest('invalid_reports_to', 'People cannot report to themselves');
    }
    await assertActiveUser(newReportsTo, 'invalid_reports_to', client);
  }
  if (newRole !== current.role) {
    const { rows: clash } = await client.query(
      `SELECT 1 FROM membership
       WHERE user_id = $1 AND node_id = $2 AND role = $3 AND valid_to IS NULL AND id <> $4`,
      [current.user_id, current.node_id, newRole, current.id]
    );
    if (clash.length) {
      throw conflict(
        'membership_exists',
        'The person already has this role on this node'
      );
    }
  }
  const isPrimary = input.isPrimary !== undefined ? input.isPrimary : current.is_primary;
  const datedChange = newRole !== current.role || newReportsTo !== current.reports_to;

  let row;
  if (!datedChange || on === current.valid_from) {
    // Primary flag only, or a same-day correction: update in place.
    ({
      rows: [row],
    } = await client.query(
      `UPDATE membership SET role = $2, reports_to = $3, is_primary = $4
       WHERE id = $1 RETURNING *`,
      [current.id, newRole, newReportsTo, isPrimary]
    ));
  } else {
    await client.query(
      'UPDATE membership SET valid_to = $2, is_primary = false WHERE id = $1',
      [current.id, on]
    );
    ({
      rows: [row],
    } = await client.query(
      `INSERT INTO membership (user_id, node_id, role, reports_to, is_primary, valid_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        current.user_id,
        current.node_id,
        newRole,
        newReportsTo,
        isPrimary,
        on,
        ctx.actor.id,
      ]
    ));
  }
  if (row.is_primary) {
    await clearOtherPrimary(row.user_id, row.id, client);
  }
  const after = mapMembership(row);
  await recordRevision(client, {
    table: 'membership',
    recordId: row.id,
    action: row.id === current.id ? 'update' : 'create',
    ctx,
    before,
    after,
    reason: input.reason,
  });
  return after;
}

// ---------------------------------------------------------------------------
// Bootstrap

/**
 * Spec §19 "第一个管理员": the account named in INITIAL_ADMIN_EMAIL becomes
 * group admin on first login. Creates the group (root) node if there is none.
 */
export async function bootstrapGroupAdmin(ctx, user, client) {
  const on = today();
  const { rows: roots } = await client.query(
    'SELECT node_id FROM org_node_version WHERE parent_id IS NULL AND valid_to IS NULL LIMIT 1'
  );
  let rootId = roots.length ? roots[0].node_id : null;
  if (!rootId) {
    const {
      rows: [node],
    } = await client.query('INSERT INTO org_node (created_by) VALUES ($1) RETURNING id', [
      user.id,
    ]);
    rootId = node.id;
    const {
      rows: [version],
    } = await client.query(
      `INSERT INTO org_node_version (node_id, parent_id, type, name_zh, name_en, valid_from, created_by)
       VALUES ($1, NULL, $2, '集团', 'Group', $3, $4) RETURNING *`,
      [rootId, ROOT_TYPE, on, user.id]
    );
    await recordRevision(client, {
      table: 'org_node',
      recordId: rootId,
      action: 'create',
      ctx,
      after: mapVersion(version),
    });
  }
  const { rows: existing } = await client.query(
    `SELECT 1 FROM membership
     WHERE user_id = $1 AND node_id = $2 AND role = 'group_admin' AND valid_to IS NULL`,
    [user.id, rootId]
  );
  if (!existing.length) {
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO membership (user_id, node_id, role, valid_from, created_by)
       VALUES ($1, $2, 'group_admin', $3, $1) RETURNING *`,
      [user.id, rootId, on]
    );
    await recordRevision(client, {
      table: 'membership',
      recordId: row.id,
      action: 'create',
      ctx,
      after: mapMembership(row),
      reason: 'INITIAL_ADMIN_EMAIL',
    });
  }
  return rootId;
}
