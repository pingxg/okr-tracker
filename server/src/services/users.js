/**
 * People (spec §3 "人员变动", §9 "登录"). Entra ID only says who someone is;
 * everything else about them lives here and in their memberships.
 */
import config from '../config.js';
import { db, withTransaction } from '../db/tx.js';
import { today } from '../lib/dates.js';
import { forbidden, notFound } from '../lib/errors.js';
import { ancestorsOf, canEditOwnProfile, isGroupAdmin } from '../policy/access.js';
import { recordRevision, systemContext } from './audit.js';
import { bootstrapGroupAdmin, getTree, membershipsOn } from './org.js';

const mapUser = (r) => ({
  id: r.id,
  email: r.email,
  name: r.name,
  uiLanguage: r.ui_language,
  status: r.status,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

export async function getUserByEmail(email, client) {
  const { rows } = await db(client).query('SELECT * FROM app_user WHERE email = $1', [
    email.toLowerCase(),
  ]);
  return rows.length ? mapUser(rows[0]) : null;
}

export async function getUserById(id, client) {
  const { rows } = await db(client).query('SELECT * FROM app_user WHERE id = $1', [id]);
  return rows.length ? mapUser(rows[0]) : null;
}

/**
 * Called on every successful login. Creates the person on first login with no
 * roles (spec §3 "入职"), keeps the name and Entra id in sync, and makes the
 * INITIAL_ADMIN_EMAIL account group admin the first time it signs in.
 */
export async function ensureUser({ email, name = null, oid = null }) {
  const normalized = email.toLowerCase();
  return withTransaction(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO app_user (email, name, entra_oid, last_login_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (email) DO UPDATE SET
         last_login_at = now(),
         name = COALESCE(EXCLUDED.name, app_user.name),
         entra_oid = COALESCE(app_user.entra_oid, EXCLUDED.entra_oid)
       RETURNING *, (xmax = 0) AS inserted`,
      [normalized, name, oid]
    );
    const user = mapUser(row);
    if (row.inserted) {
      const ctx = systemContext(user);
      await recordRevision(client, {
        table: 'app_user',
        recordId: user.id,
        action: 'create',
        ctx,
        after: user,
      });
      if (config.initialAdminEmails.includes(normalized)) {
        await bootstrapGroupAdmin(ctx, user, client);
      }
    }
    return user;
  });
}

/** The signed-in person with the memberships in effect today, for permission checks. */
export async function loadActor(email, client) {
  const user = await getUserByEmail(email, client);
  if (!user) {
    return null;
  }
  const memberships = await membershipsOn(today(), { userId: user.id }, client);
  return {
    ...user,
    memberships: memberships.map((m) => ({
      id: m.id,
      nodeId: m.nodeId,
      role: m.role,
      reportsTo: m.reportsTo,
      isPrimary: m.isPrimary,
    })),
  };
}

/** GET /me */
export async function getMe(actor, client) {
  const on = today();
  const { rows } = await db(client).query(
    `SELECT m.id, m.node_id, m.role, m.reports_to, m.is_primary, m.valid_from, m.valid_to,
            v.type, v.name_zh, v.name_en, r.name AS reports_to_name, r.email AS reports_to_email
     FROM membership m
     LEFT JOIN org_node_version v ON v.node_id = m.node_id
       AND v.valid_from <= $2 AND (v.valid_to IS NULL OR $2 < v.valid_to)
     LEFT JOIN app_user r ON r.id = m.reports_to
     WHERE m.user_id = $1 AND m.valid_from <= $2 AND (m.valid_to IS NULL OR $2 < m.valid_to)
     ORDER BY m.is_primary DESC, v.name_en NULLS LAST, v.name_zh`,
    [actor.id, on]
  );
  const { memberships: _ignored, ...user } = actor;
  return {
    user,
    memberships: rows.map((r) => ({
      id: r.id,
      role: r.role,
      isPrimary: r.is_primary,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      node: { id: r.node_id, type: r.type, nameZh: r.name_zh, nameEn: r.name_en },
      reportsTo: r.reports_to
        ? { id: r.reports_to, name: r.reports_to_name, email: r.reports_to_email }
        : null,
    })),
    permissions: { groupAdmin: isGroupAdmin(actor) },
    // Feature flags arrive with milestone M3 (spec §15).
    features: {},
  };
}

/** PATCH /me: personal settings. */
export async function updateMe(ctx, input) {
  if (!canEditOwnProfile(ctx.actor, ctx.actor.id)) {
    throw forbidden();
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM app_user WHERE id = $1', [
      ctx.actor.id,
    ]);
    if (!rows.length) {
      throw notFound('User');
    }
    const before = mapUser(rows[0]);
    const {
      rows: [row],
    } = await client.query(
      'UPDATE app_user SET ui_language = $2 WHERE id = $1 RETURNING *',
      [ctx.actor.id, input.uiLanguage ?? before.uiLanguage]
    );
    const after = mapUser(row);
    await recordRevision(client, {
      table: 'app_user',
      recordId: after.id,
      action: 'update',
      ctx,
      before,
      after,
    });
    return after;
  });
}

/**
 * GET /users: the people list (admin "成员与角色" page and pickers).
 *
 * Filters: q (name or email), status, nodeId (people with a role on that node
 * or below it), role, unassigned (signed in but without any role yet).
 * Each person comes with their memberships in effect today.
 */
export async function searchUsers({
  q,
  status = 'active',
  nodeId,
  role,
  unassigned = false,
  limit = 50,
  offset = 0,
} = {}) {
  const on = today();
  const { nodes } = await getTree({ date: on });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const conditions = [];
  const params = [on];
  // $1 is always today's date; the queries below always reference it so its
  // type is known even when no membership filter is used.
  const inEffect = (alias) =>
    `${alias}.valid_from <= $1::date AND (${alias}.valid_to IS NULL OR $1::date < ${alias}.valid_to)`;

  if (status !== 'all') {
    params.push(status);
    conditions.push(`u.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`);
    conditions.push(
      `(lower(coalesce(u.name, '')) LIKE $${params.length} OR u.email LIKE $${params.length})`
    );
  }
  if (nodeId || role) {
    const sub = ['m.user_id = u.id', inEffect('m')];
    if (nodeId) {
      const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
      const subtree = nodes
        .filter((n) => ancestorsOf({ parentOf }, n.id).includes(nodeId))
        .map((n) => n.id);
      params.push(subtree);
      sub.push(`m.node_id = ANY($${params.length}::uuid[])`);
    }
    if (role) {
      params.push(role);
      sub.push(`m.role = $${params.length}`);
    }
    conditions.push(`EXISTS (SELECT 1 FROM membership m WHERE ${sub.join(' AND ')})`);
  }
  const noRole = `NOT EXISTS (SELECT 1 FROM membership m WHERE m.user_id = u.id AND ${inEffect(
    'm'
  )})`;
  if (unassigned) {
    conditions.push(noRole);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  const { rows } = await db().query(
    `SELECT u.*, $1::date AS as_of, count(*) OVER () AS total FROM app_user u ${where}
     ORDER BY u.name NULLS LAST, u.email
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const {
    rows: [counts],
  } = await db().query(
    `SELECT count(*) AS unassigned FROM app_user u WHERE u.status = 'active' AND ${noRole}`,
    [on]
  );

  const ids = rows.map((r) => r.id);
  const memberships = ids.length ? await membershipsOn(on, { userIds: ids }) : [];
  const byUser = new Map(ids.map((id) => [id, []]));
  for (const m of memberships) {
    byUser.get(m.userId).push({
      id: m.id,
      role: m.role,
      isPrimary: m.isPrimary,
      validFrom: m.validFrom,
      node: (({ id, type, nameZh, nameEn }) => ({ id, type, nameZh, nameEn }))(
        nodeById.get(m.nodeId) || { id: m.nodeId }
      ),
      reportsTo: m.reportsToUser,
    });
  }

  return {
    total: rows.length ? Number(rows[0].total) : 0,
    unassignedTotal: Number(counts.unassigned),
    items: rows.map((r) => ({ ...mapUser(r), memberships: byUser.get(r.id) })),
  };
}

/** GET /users/{id}: a person and where they sit in the structure today. */
export async function getUserDetail(id) {
  const user = await getUserById(id);
  if (!user) {
    throw notFound('User');
  }
  const memberships = await membershipsOn(today(), { userId: id });
  return { user, memberships };
}
