/**
 * People (spec §3 "人员变动", §9 "登录"). Entra ID only says who someone is;
 * everything else about them lives here and in their memberships.
 */
import config from '../config.js';
import { db, withTransaction } from '../db/tx.js';
import { today } from '../lib/dates.js';
import { forbidden, notFound } from '../lib/errors.js';
import { canEditOwnProfile, isGroupAdmin } from '../policy/access.js';
import { recordRevision, systemContext } from './audit.js';
import { bootstrapGroupAdmin, membershipsOn } from './org.js';

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

/** GET /users: search by name or email. */
export async function searchUsers({ q, status = 'active', limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (status !== 'all') {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`);
    conditions.push(
      `(lower(coalesce(name, '')) LIKE $${params.length} OR email LIKE $${params.length})`
    );
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  const { rows } = await db().query(
    `SELECT *, count(*) OVER () AS total FROM app_user ${where}
     ORDER BY name NULLS LAST, email
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    items: rows.map(mapUser),
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
