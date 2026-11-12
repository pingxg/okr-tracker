/**
 * API v1 organisation tests (milestone M2) through the real HTTP routes and a
 * real Postgres database. Skipped unless TEST_DATABASE_URL is set.
 *
 *   TEST_DATABASE_URL=postgres://okr:okr@localhost:5432/okr_test npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
}
process.env.INITIAL_ADMIN_EMAIL = 'admin@test.fi';
process.env.DEV_LOGIN_PASSWORD = 'test';

const skip = !url && 'TEST_DATABASE_URL not set';

let app;
let pool;
let createSession;
let usersService;
let todayISO;

const people = {};
const nodes = {};

const cookieFor = (email) =>
  `okr_session=${createSession({ email, provider: 'password' })}`;

// Real HTTP requests: Fastify's inject() returns empty bodies once the
// @fastify/express plugin is registered.
let baseUrl;

async function call(email, method, path, body) {
  const headers = email ? { cookie: cookieFor(email) } : {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const as = (email) => ({
  get: (path) => call(email, 'GET', path),
  post: (path, body) => call(email, 'POST', path, body),
  patch: (path, body) => call(email, 'PATCH', path, body),
});

const admin = as('admin@test.fi');

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

before(async () => {
  if (skip) {
    return;
  }
  ({ default: pool } = await import('../src/db/pool.js'));
  const { migrate } = await import('../src/db/migrate.js');
  await migrate({ log: () => {} });
  await pool.query(
    'TRUNCATE revision, membership, org_node_version, org_node, setting, app_user, documents CASCADE'
  );
  ({ createSession } = await import('../src/auth/session.js'));
  usersService = await import('../src/services/users.js');
  ({ today: todayISO } = await import('../src/lib/dates.js'));
  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;

  // People who have signed in once (no roles yet).
  for (const [key, email] of Object.entries({
    leadA: 'lead.a@test.fi',
    teamLead: 'team.lead@test.fi',
    member: 'member@test.fi',
    newcomer: 'newcomer@test.fi',
    other: 'other@test.fi',
  })) {
    people[key] = await usersService.ensureUser({ email, name: key });
  }
});

after(async () => {
  if (app) {
    await app.close();
  }
  if (pool) {
    await pool.end();
  }
});

test('requests without a session are rejected', { skip }, async () => {
  const res = await call(null, 'GET', '/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'unauthenticated');
});

test(
  'the initial admin becomes group admin and the group node is created',
  { skip },
  async () => {
    const res = await admin.get('/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'admin@test.fi');
    assert.equal(res.body.permissions.groupAdmin, true);
    assert.equal(res.body.memberships.length, 1);
    assert.equal(res.body.memberships[0].role, 'group_admin');
    assert.equal(res.body.memberships[0].node.type, 'group');
    people.admin = res.body.user;
    nodes.group = res.body.memberships[0].node.id;
  }
);

test('people who have no tracker account are refused', { skip }, async () => {
  const res = await as('stranger@elsewhere.com').get('/me');
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'not_registered');
});

test('group admin builds the structure', { skip }, async () => {
  const create = async (key, parent, type, nameEn, nameZh) => {
    const res = await admin.post('/org/nodes', {
      parentId: parent,
      type,
      nameEn,
      nameZh,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    nodes[key] = res.body.id;
  };
  await create('entityA', nodes.group, 'entity', 'Spartao Oy', '斯巴达有限公司');
  await create('brandA', nodes.entityA, 'brand', 'Sushibar');
  await create('teamA1', nodes.brandA, 'team', 'Sushibar Ops');
  await create('deptA', nodes.entityA, 'department', 'Finance', '财务部');
  await create('entityB', nodes.group, 'entity', 'Other Oy');

  const tree = await admin.get('/org/tree');
  assert.equal(tree.status, 200);
  assert.equal(tree.body.rootId, nodes.group);
  assert.equal(tree.body.nodes.length, 6);
  assert.ok(tree.body.nodeTypes.some((t) => t.key === 'brand'));
});

test('node input is validated', { skip }, async () => {
  let res = await admin.post('/org/nodes', { parentId: nodes.group, type: 'entity' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'name_required');

  res = await admin.post('/org/nodes', {
    parentId: nodes.group,
    type: 'planet',
    nameEn: 'X',
  });
  assert.equal(res.body.code, 'invalid_node_type');

  res = await admin.post('/org/nodes', {
    parentId: nodes.group,
    type: 'group',
    nameEn: 'X',
  });
  assert.equal(res.body.code, 'invalid_node_type');

  res = await admin.post('/org/nodes', {
    parentId: 'not-a-uuid',
    type: 'team',
    nameEn: 'X',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'invalid_request');
  assert.ok(res.body.details.some((d) => d.path === 'parentId'));

  res = await admin.post('/org/nodes', {
    parentId: nodes.group,
    type: 'team',
    nameEn: 'X',
    x: 1,
  });
  assert.equal(res.body.code, 'invalid_request');
});

test('group admin assigns leads and members', { skip }, async () => {
  const add = async (who, node, role, extra = {}) => {
    const res = await admin.post('/memberships', {
      userId: people[who].id,
      nodeId: nodes[node],
      role,
      ...extra,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  await add('leadA', 'entityA', 'entity_lead', { isPrimary: true });
  await add('teamLead', 'teamA1', 'team_lead', { reportsTo: people.leadA.id });
  await add('member', 'teamA1', 'member', { reportsTo: people.teamLead.id });

  const dup = await admin.post('/memberships', {
    userId: people.member.id,
    nodeId: nodes.teamA1,
    role: 'member',
  });
  assert.equal(dup.status, 409);

  const badAdmin = await admin.post('/memberships', {
    userId: people.member.id,
    nodeId: nodes.teamA1,
    role: 'group_admin',
  });
  assert.equal(badAdmin.body.code, 'invalid_role');

  const self = await admin.post('/memberships', {
    userId: people.member.id,
    nodeId: nodes.deptA,
    role: 'member',
    reportsTo: people.member.id,
  });
  assert.equal(self.body.code, 'invalid_reports_to');

  const team = await admin.get(`/org/nodes/${nodes.teamA1}`);
  assert.equal(team.status, 200);
  assert.equal(team.body.memberships.length, 2);
  assert.deepEqual(
    team.body.ancestors.map((a) => a.nameEn),
    ['Group', 'Spartao Oy', 'Sushibar']
  );

  const tree = await admin.get('/org/tree');
  const teamNode = tree.body.nodes.find((n) => n.id === nodes.teamA1);
  assert.equal(teamNode.memberCount, 2);
  assert.deepEqual(
    teamNode.leads.map((l) => l.role),
    ['team_lead']
  );
});

test('entity lead works inside the entity only', { skip }, async () => {
  const lead = as('lead.a@test.fi');

  const dept = await lead.post('/org/nodes', {
    parentId: nodes.entityA,
    type: 'department',
    nameEn: 'HR',
  });
  assert.equal(dept.status, 201);
  nodes.hr = dept.body.id;

  assert.equal(
    (
      await lead.post('/org/nodes', {
        parentId: nodes.group,
        type: 'entity',
        nameEn: 'X',
      })
    ).status,
    403
  );
  assert.equal(
    (
      await lead.post('/org/nodes', {
        parentId: nodes.entityB,
        type: 'team',
        nameEn: 'X',
      })
    ).status,
    403
  );

  // Cannot appoint a peer at entity level, can appoint a brand lead.
  const peer = await lead.post('/memberships', {
    userId: people.other.id,
    nodeId: nodes.entityA,
    role: 'entity_lead',
  });
  assert.equal(peer.status, 403);
  const brandLead = await lead.post('/memberships', {
    userId: people.other.id,
    nodeId: nodes.brandA,
    role: 'entity_lead',
  });
  assert.equal(brandLead.status, 201);

  // Cannot move its own entity, can restructure below it.
  assert.equal(
    (await lead.patch(`/org/nodes/${nodes.entityA}`, { parentId: nodes.entityB })).status,
    403
  );
  assert.equal(
    (await lead.patch(`/org/nodes/${nodes.hr}`, { parentId: nodes.entityB })).status,
    403
  );
  const renamed = await lead.patch(`/org/nodes/${nodes.entityA}`, {
    nameEn: 'Spartao Oy Ab',
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.nameEn, 'Spartao Oy Ab');
});

test('team lead manages members of the own team only', { skip }, async () => {
  const lead = as('team.lead@test.fi');
  const ok = await lead.post('/memberships', {
    userId: people.newcomer.id,
    nodeId: nodes.teamA1,
    role: 'member',
  });
  assert.equal(ok.status, 201);

  const promote = await lead.patch(`/memberships/${ok.body.id}`, { role: 'team_lead' });
  assert.equal(promote.status, 403);

  const elsewhere = await lead.post('/memberships', {
    userId: people.newcomer.id,
    nodeId: nodes.deptA,
    role: 'member',
  });
  assert.equal(elsewhere.status, 403);

  const node = await lead.post('/org/nodes', {
    parentId: nodes.teamA1,
    type: 'team',
    nameEn: 'X',
  });
  assert.equal(node.status, 403);
});

test('members can read the structure but not change it', { skip }, async () => {
  const member = as('member@test.fi');
  assert.equal((await member.get('/org/tree')).status, 200);
  assert.equal((await member.get(`/org/nodes/${nodes.teamA1}`)).status, 200);
  const users = await member.get('/users?q=lead');
  assert.equal(users.status, 200);
  assert.deepEqual(users.body.items.map((u) => u.email).sort(), [
    'lead.a@test.fi',
    'team.lead@test.fi',
  ]);
  assert.equal(
    (
      await member.post('/org/nodes', {
        parentId: nodes.teamA1,
        type: 'team',
        nameEn: 'X',
      })
    ).status,
    403
  );
  assert.equal(
    (await member.patch(`/org/nodes/${nodes.teamA1}`, { nameEn: 'Hacked' })).status,
    403
  );
});

test('renames take effect on their date and keep history', { skip }, async () => {
  const start = todayISO();
  const later = addDays(start, 30);

  const res = await admin.patch(`/org/nodes/${nodes.deptA}`, {
    nameEn: 'Group Finance',
    effectiveDate: later,
    reason: 'Reorganisation',
  });
  assert.equal(res.status, 200);

  const now = await admin.get(`/org/nodes/${nodes.deptA}`);
  assert.equal(now.body.node.nameEn, 'Finance');
  assert.equal(now.body.history.length, 2);

  const future = await admin.get(`/org/nodes/${nodes.deptA}?date=${later}`);
  assert.equal(future.body.node.nameEn, 'Group Finance');
  assert.equal(future.body.node.nameZh, '财务部');

  const yesterday = await admin.get(`/org/tree?date=${addDays(start, -1)}`);
  assert.equal(yesterday.body.nodes.length, 0, 'nothing existed before today');

  // Changes are appended after the latest one, never inserted into the past.
  const tooEarly = await admin.patch(`/org/nodes/${nodes.deptA}`, {
    nameEn: 'Oops',
    effectiveDate: addDays(later, -1),
  });
  assert.equal(tooEarly.body.code, 'effective_date_too_early');

  const { rows } = await pool.query(
    `SELECT action, reason, source, after->>'nameEn' AS name FROM revision
     WHERE table_name = 'org_node' AND record_id = $1 ORDER BY id`,
    [nodes.deptA]
  );
  assert.deepEqual(
    rows.map((r) => r.action),
    ['create', 'update']
  );
  assert.equal(rows[1].reason, 'Reorganisation');
  assert.equal(rows[1].source, 'web');
  assert.equal(rows[1].name, 'Group Finance');
});

test('same-day corrections do not add history', { skip }, async () => {
  await admin.patch(`/org/nodes/${nodes.hr}`, { nameZh: '人力资源部' });
  const hr = await admin.get(`/org/nodes/${nodes.hr}`);
  assert.equal(hr.body.history.length, 1);
  assert.equal(hr.body.node.nameZh, '人力资源部');
});

test('moves are checked for cycles; the group node stays put', { skip }, async () => {
  const cycle = await admin.patch(`/org/nodes/${nodes.entityA}`, {
    parentId: nodes.teamA1,
  });
  assert.equal(cycle.body.code, 'invalid_parent');

  const root = await admin.patch(`/org/nodes/${nodes.group}`, {
    parentId: nodes.entityA,
  });
  assert.equal(root.body.code, 'root_node');

  const moved = await admin.patch(`/org/nodes/${nodes.teamA1}`, {
    parentId: nodes.entityA,
  });
  assert.equal(moved.status, 200);
  const team = await admin.get(`/org/nodes/${nodes.teamA1}`);
  assert.deepEqual(
    team.body.ancestors.map((a) => a.id),
    [nodes.group, nodes.entityA]
  );
});

test(
  'deactivating a node ends its memberships; nodes with children are refused',
  { skip },
  async () => {
    const parent = await admin.patch(`/org/nodes/${nodes.entityA}`, { active: false });
    assert.equal(parent.body.code, 'node_has_children');

    const tomorrow = addDays(todayISO(), 1);
    const res = await admin.patch(`/org/nodes/${nodes.teamA1}`, {
      active: false,
      effectiveDate: tomorrow,
      reason: 'Team merged',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.validTo, tomorrow);

    const { rows } = await pool.query(
      'SELECT valid_to FROM membership WHERE node_id = $1',
      [nodes.teamA1]
    );
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.valid_to === tomorrow));

    const gone = await admin.get(`/org/tree?date=${tomorrow}`);
    assert.equal(
      gone.body.nodes.some((n) => n.id === nodes.teamA1),
      false
    );
    const stillToday = await admin.get('/org/tree');
    assert.equal(
      stillToday.body.nodes.some((n) => n.id === nodes.teamA1),
      true
    );

    const again = await admin.patch(`/org/nodes/${nodes.teamA1}`, { nameEn: 'X' });
    assert.equal(again.body.code, 'node_inactive');
  }
);

test('role changes are dated; the last group admin cannot leave', { skip }, async () => {
  const later = addDays(todayISO(), 10);
  const created = await admin.post('/memberships', {
    userId: people.newcomer.id,
    nodeId: nodes.deptA,
    role: 'member',
  });
  const changed = await admin.patch(`/memberships/${created.body.id}`, {
    role: 'team_lead',
    effectiveDate: later,
  });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.body.id, created.body.id, 'a dated change adds a row');
  assert.equal(changed.body.validFrom, later);

  const now = await admin.get(`/org/nodes/${nodes.deptA}`);
  assert.equal(
    now.body.memberships.find((m) => m.userId === people.newcomer.id).role,
    'member'
  );
  const then = await admin.get(`/org/nodes/${nodes.deptA}?date=${later}`);
  assert.equal(
    then.body.memberships.find((m) => m.userId === people.newcomer.id).role,
    'team_lead'
  );

  const me = await admin.get('/me');
  const own = me.body.memberships.find((m) => m.role === 'group_admin');
  const leave = await admin.patch(`/memberships/${own.id}`, { end: true });
  assert.equal(leave.body.code, 'last_group_admin');
});

test('people change their own language', { skip }, async () => {
  const member = as('member@test.fi');
  const res = await member.patch('/me', { uiLanguage: 'zh-CN' });
  assert.equal(res.status, 200);
  assert.equal(res.body.uiLanguage, 'zh-CN');
  const bad = await member.patch('/me', { uiLanguage: 'nb-NO' });
  assert.equal(bad.status, 400);
});

test('deactivated people are locked out', { skip }, async () => {
  await pool.query(
    "UPDATE app_user SET status = 'inactive' WHERE email = 'other@test.fi'"
  );
  const res = await as('other@test.fi').get('/me');
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'user_inactive');
});
