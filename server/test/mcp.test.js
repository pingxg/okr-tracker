/**
 * MCP endpoint, tokens and OAuth, end to end over real HTTP against a real
 * Postgres database. Skipped unless TEST_DATABASE_URL is set.
 *
 * Checks that an assistant can do exactly what its user may do: the same
 * policy as the web app decides every change.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const url = process.env.TEST_DATABASE_URL;
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.PUBLIC_URL = BASE;
}
const skip = !url && 'TEST_DATABASE_URL not set';

let app;
let pool;
let tokens;
let session;
let Client;
let Transport;
const pat = {};

const ref = (path) => ({ __ref: path });
const user = (email) => ref(`users/${email}`);

async function connect(token) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new Transport(new URL(`${BASE}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  return client;
}

async function call(token, name, args = {}) {
  const client = await connect(token);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text || '';
    return {
      error: result.isError === true,
      text,
      data: result.isError ? null : JSON.parse(text),
    };
  } finally {
    await client.close();
  }
}

before(async () => {
  if (skip) {
    return;
  }
  ({ default: pool } = await import('../src/db/pool.js'));
  const { migrate } = await import('../src/db/migrate.js');
  await migrate({ log: () => {} });
  await pool.query('TRUNCATE documents, auth_tokens, oauth_clients CASCADE');
  const store = await import('../src/store/docstore.js');
  tokens = await import('../src/auth/tokens.js');
  session = await import('../src/auth/session.js');
  ({ Client } = await import('@modelcontextprotocol/sdk/client/index.js'));
  ({ StreamableHTTPClientTransport: Transport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  ));

  // org1 > dep1 > team1. alice and bob are on team1, carol on no team,
  // dana is admin of org1.
  const meta = { archived: false };
  await store.commit(
    [
      [
        'users/alice@x.fi',
        { id: 'alice@x.fi', email: 'alice@x.fi', admin: [], superAdmin: false },
      ],
      [
        'users/bob@x.fi',
        { id: 'bob@x.fi', email: 'bob@x.fi', admin: [], superAdmin: false },
      ],
      [
        'users/carol@x.fi',
        { id: 'carol@x.fi', email: 'carol@x.fi', admin: [], superAdmin: false },
      ],
      [
        'users/dana@x.fi',
        { id: 'dana@x.fi', email: 'dana@x.fi', admin: ['org1'], superAdmin: false },
      ],
      ['organizations/org1', { name: 'Org', slug: 'org', team: [], ...meta }],
      [
        'departments/dep1',
        {
          name: 'Dep',
          slug: 'dep',
          organization: ref('organizations/org1'),
          team: [],
          ...meta,
        },
      ],
      [
        'products/team1',
        {
          name: 'Team',
          slug: 'team',
          organization: ref('organizations/org1'),
          department: ref('departments/dep1'),
          team: [user('alice@x.fi'), user('bob@x.fi')],
          ...meta,
        },
      ],
    ].map(([path, data]) => ({ type: 'set', path, data })),
    { runHooks: false }
  );

  for (const name of ['alice', 'bob', 'carol', 'dana']) {
    // eslint-disable-next-line no-await-in-loop
    pat[name] = (
      await tokens.createToken({ kind: 'pat', email: `${name}@x.fi`, name: 'test' })
    ).secret;
  }

  const { buildApp } = await import('../src/app.js');
  app = await buildApp({ logger: false });
  await app.listen({ port: PORT, host: '127.0.0.1' });
});

after(async () => {
  if (app) {
    await app.close();
  }
  if (pool) {
    await pool.end();
  }
});

test('no or bad token: 401 pointing to the OAuth metadata', { skip }, async () => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(res.status, 401);
  assert.match(
    res.headers.get('www-authenticate'),
    /resource_metadata="http:\/\/127\.0\.0\.1:3199\/\.well-known\/oauth-protected-resource"/
  );
  await assert.rejects(connect('okr_pat_nonsense'));
});

test('get_my_permissions tells each person what they may change', { skip }, async () => {
  const alice = (await call(pat.alice, 'get_my_permissions')).data;
  assert.deepEqual(
    alice.memberOf.map((i) => i.ref),
    ['products/team1']
  );
  assert.equal(alice.superAdmin, false);
  const carol = (await call(pat.carol, 'get_my_permissions')).data;
  assert.deepEqual(carol.memberOf, []);
  const dana = (await call(pat.dana, 'get_my_permissions')).data;
  assert.deepEqual(
    dana.adminOfOrganizations.map((o) => o.ref),
    ['organizations/org1']
  );
});

let objectiveId;
let krId;
let kpiId;

test(
  'members create objectives; outsiders are refused with a reason',
  { skip },
  async () => {
    const args = {
      item_ref: 'products/team1',
      name: 'Grow',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    };
    const refused = await call(pat.carol, 'create_objective', args);
    assert.equal(refused.error, true);
    assert.match(refused.text, /Not allowed: you are not a member of Team/);
    const ok = await call(pat.alice, 'create_objective', args);
    assert.equal(ok.error, false);
    objectiveId = ok.data.objectiveId;
  }
);

test(
  'key results: assignees must be on the team; only assignees edit',
  { skip },
  async () => {
    const base = {
      objective_id: objectiveId,
      name: 'Revenue',
      unit: 'EUR',
      start_value: 0,
      target_value: 100,
    };
    const outsider = await call(pat.alice, 'create_key_result', {
      ...base,
      assignee_emails: ['carol@x.fi'],
    });
    assert.equal(outsider.error, true, 'carol is not on the team');
    const ok = await call(pat.alice, 'create_key_result', {
      ...base,
      assignee_emails: ['bob@x.fi'],
    });
    assert.equal(ok.error, false, ok.text);
    krId = ok.data.keyResultId;

    // alice is on the team but not assigned
    const aliceEdit = await call(pat.alice, 'update_key_result', {
      key_result_id: krId,
      name: 'x',
    });
    assert.equal(aliceEdit.error, true);
    assert.match(aliceEdit.text, /assigned to bob@x\.fi/);
    assert.equal(
      (
        await call(pat.alice, 'record_key_result_progress', {
          key_result_id: krId,
          value: 5,
        })
      ).error,
      true
    );

    // bob is assigned
    assert.equal(
      (
        await call(pat.bob, 'update_key_result', {
          key_result_id: krId,
          name: 'Revenue 2026',
        })
      ).error,
      false
    );
    assert.equal(
      (
        await call(pat.bob, 'record_key_result_progress', {
          key_result_id: krId,
          value: 40,
        })
      ).error,
      false
    );
    const reassign = await call(pat.bob, 'update_key_result', {
      key_result_id: krId,
      assignee_emails: ['alice@x.fi'],
    });
    assert.equal(reassign.error, true, 'assignees cannot reassign');
    const archive = await call(pat.bob, 'set_archived', {
      kind: 'key_result',
      id: krId,
      archived: true,
    });
    assert.equal(archive.error, true);
    assert.match(archive.text, /assignees cannot archive/);

    // the org admin manages it
    assert.equal(
      (
        await call(pat.dana, 'update_key_result', {
          key_result_id: krId,
          assignee_emails: ['bob@x.fi', 'alice@x.fi'],
        })
      ).error,
      false
    );
    assert.equal(
      (
        await call(pat.dana, 'set_archived', {
          kind: 'key_result',
          id: krId,
          archived: true,
        })
      ).error,
      false
    );
    assert.equal(
      (
        await call(pat.dana, 'set_archived', {
          kind: 'key_result',
          id: krId,
          archived: false,
        })
      ).error,
      false
    );
  }
);

test('reads show rights per key result and the recorded progress', { skip }, async () => {
  const okrs = (await call(pat.carol, 'get_okrs', { item_ref: 'products/team1' })).data;
  const kr = okrs.objectives[0].keyResults[0];
  assert.equal(kr.name, 'Revenue 2026');
  assert.deepEqual(kr.assignees.sort(), ['alice@x.fi', 'bob@x.fi']);
  assert.equal(kr.yourRights.canEdit, false);
  const details = (await call(pat.bob, 'get_key_result', { key_result_id: krId })).data;
  assert.equal(details.yourRights.canEdit, true);
  assert.equal(details.yourRights.canManage, false);
  assert.equal(details.progress[0].value, 40);
  assert.equal(details.progress[0].by, 'bob@x.fi');
});

test(
  'measurements: assigned values, one per day, current value kept',
  { skip },
  async () => {
    const created = await call(pat.alice, 'create_measurement', {
      item_ref: 'products/team1',
      name: 'Stores',
      type: 'plain',
      format: 'integer',
      start_value: 'zero',
      preferred_trend: 'increase',
      update_frequency: 'weekly',
      assignee_emails: ['bob@x.fi'],
    });
    assert.equal(created.error, false, created.text);
    kpiId = created.data.measurementId;

    assert.equal(
      (
        await call(pat.alice, 'record_measurement_value', {
          measurement_id: kpiId,
          value: 3,
        })
      ).error,
      true
    );
    assert.equal(
      (
        await call(pat.carol, 'record_measurement_value', {
          measurement_id: kpiId,
          value: 3,
        })
      ).error,
      true
    );
    assert.equal(
      (
        await call(pat.bob, 'record_measurement_value', {
          measurement_id: kpiId,
          value: 7,
          date: '2026-01-05',
        })
      ).error,
      false
    );
    assert.equal(
      (
        await call(pat.bob, 'record_measurement_value', {
          measurement_id: kpiId,
          value: 9,
          date: '2026-01-05',
        })
      ).error,
      false
    );
    const kpi = (await call(pat.bob, 'get_measurement', { measurement_id: kpiId })).data;
    assert.deepEqual(
      kpi.values.map((v) => v.value),
      [9],
      'same day replaced'
    );
    assert.equal(kpi.currentValue, 9);
    assert.equal(
      (
        await call(pat.bob, 'update_measurement', {
          measurement_id: kpiId,
          assignee_emails: [],
        })
      ).error,
      true
    );
  }
);

test('revoked personal tokens stop working at once', { skip }, async () => {
  const { id, secret } = await tokens.createToken({
    kind: 'pat',
    email: 'alice@x.fi',
    name: 'tmp',
  });
  assert.equal((await call(secret, 'get_my_permissions')).error, false);
  await tokens.revokePat('alice@x.fi', id);
  await assert.rejects(connect(secret));
});

test('token API: browser session only, secret shown once', { skip }, async () => {
  const cookie = `okr_session=${session.createSession({
    email: 'alice@x.fi',
    provider: 'oidc',
  })}`;
  const createRes = await fetch(`${BASE}/api/v1/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Claude Desktop', expiresInDays: 30 }),
  });
  const created = await createRes.json();
  assert.match(created.token, /^okr_pat_/);
  const list = await (
    await fetch(`${BASE}/api/v1/tokens`, { headers: { Cookie: cookie } })
  ).json();
  assert.ok(list.tokens.some((t) => t.id === created.id && !('token' in t)));
  const viaToken = await fetch(`${BASE}/api/v1/tokens`, {
    headers: { Authorization: `Bearer ${created.token}` },
  });
  assert.equal(viaToken.status, 401, 'a token cannot manage tokens');
});

test(
  'OAuth: register, sign in, consent, PKCE, rotating refresh tokens',
  { skip },
  async () => {
    const meta = await (
      await fetch(`${BASE}/.well-known/oauth-authorization-server`)
    ).json();
    assert.equal(meta.token_endpoint, `${BASE}/oauth/token`);
    const resource = await (
      await fetch(`${BASE}/.well-known/oauth-protected-resource`)
    ).json();
    assert.equal(resource.resource, `${BASE}/mcp`);

    const redirectUri = 'https://assistant.example/callback';
    const reg = await (
      await fetch(meta.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Test Assistant',
          redirect_uris: [redirectUri],
        }),
      })
    ).json();
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authUrl = `/oauth/authorize?response_type=code&client_id=${
      reg.client_id
    }&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&code_challenge=${challenge}&code_challenge_method=S256&state=s1`;

    // Not signed in: sent to the Microsoft login, which returns here.
    const anon = await fetch(`${BASE}${authUrl}`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.match(
      anon.headers.get('location'),
      /^\/api\/v1\/auth\/login\?redirect=%2Foauth%2Fauthorize/
    );

    // Signed in: consent page.
    const cookie = `okr_session=${session.createSession({
      email: 'bob@x.fi',
      provider: 'oidc',
    })}`;
    const consent = await fetch(`${BASE}${authUrl}`, { headers: { Cookie: cookie } });
    const html = await consent.text();
    assert.match(html, /Allow Test Assistant to use OKR as you\?/);
    assert.equal(consent.headers.get('x-frame-options'), 'DENY');
    const decision = html
      .match(/name="decision" value="([^"]+)"/)[1]
      .replace(/&quot;/g, '"');

    const allowed = await fetch(`${BASE}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ decision, allow: 'yes' }),
    });
    const back = new URL(allowed.headers.get('location'));
    assert.equal(back.origin + back.pathname, redirectUri);
    assert.equal(back.searchParams.get('state'), 's1');
    const code = back.searchParams.get('code');

    const token = (body) =>
      fetch(meta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: reg.client_id, ...body }),
      });
    const wrong = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: 'x'.repeat(43),
    });
    assert.equal(wrong.status, 400, 'wrong PKCE verifier');
    // The failed attempt used the code up.
    const reused = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    assert.equal(reused.status, 400, 'codes work once');

    // Fresh code, correct verifier.
    const again = await fetch(`${BASE}${authUrl}`, { headers: { Cookie: cookie } });
    const decision2 = (await again.text())
      .match(/name="decision" value="([^"]+)"/)[1]
      .replace(/&quot;/g, '"');
    const allowed2 = await fetch(`${BASE}/oauth/authorize`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: new URLSearchParams({ decision: decision2, allow: 'yes' }),
    });
    const code2 = new URL(allowed2.headers.get('location')).searchParams.get('code');
    const issued = await (
      await token({
        grant_type: 'authorization_code',
        code: code2,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      })
    ).json();
    assert.match(issued.access_token, /^okr_at_/);

    // The access token acts as bob, with bob's rights.
    const me = (await call(issued.access_token, 'get_my_permissions')).data;
    assert.equal(me.you.email, 'bob@x.fi');
    assert.equal(
      (
        await call(issued.access_token, 'update_key_result', {
          key_result_id: krId,
          assignee_emails: [],
        })
      ).error,
      true
    );

    // Refresh tokens rotate.
    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
    });
    assert.equal(refreshed.status, 200);
    const replay = await token({
      grant_type: 'refresh_token',
      refresh_token: issued.refresh_token,
    });
    assert.equal(replay.status, 400);

    // Disconnecting the assistant in the profile revokes its tokens.
    const next = await refreshed.json();
    await tokens.revokeClientGrant('bob@x.fi', reg.client_id);
    await assert.rejects(connect(next.access_token));
  }
);

test(
  'discovery probes: GET asks for sign-in, unknown documents are a real 404',
  { skip },
  async () => {
    const get = await fetch(`${BASE}/mcp`, { headers: { Accept: 'text/event-stream' } });
    assert.equal(get.status, 401);
    assert.match(get.headers.get('www-authenticate'), /resource_metadata=/);
    const oidc = await fetch(`${BASE}/.well-known/openid-configuration`);
    assert.equal(oidc.status, 404);
    assert.match(oidc.headers.get('content-type'), /json/);
    const insertion = await fetch(`${BASE}/.well-known/oauth-authorization-server/mcp`);
    assert.equal((await insertion.json()).issuer, BASE);
  }
);

test('OAuth: confidential clients get a secret and must send it', { skip }, async () => {
  const redirectUri = 'https://assistant.example/cb2';
  const reg = await (
    await fetch(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Confidential',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'client_secret_basic',
      }),
    })
  ).json();
  assert.equal(reg.token_endpoint_auth_method, 'client_secret_basic');
  assert.match(reg.client_secret, /^okr_cs_/);

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const cookie = `okr_session=${session.createSession({
    email: 'alice@x.fi',
    provider: 'oidc',
  })}`;
  const consent = await fetch(
    `${BASE}/oauth/authorize?response_type=code&client_id=${
      reg.client_id
    }&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&code_challenge=${challenge}&code_challenge_method=S256`,
    { headers: { Cookie: cookie } }
  );
  const decision = (await consent.text())
    .match(/name="decision" value="([^"]+)"/)[1]
    .replace(/&quot;/g, '"');
  const allowed = await fetch(`${BASE}/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body: new URLSearchParams({ decision, allow: 'yes' }),
  });
  const code = new URL(allowed.headers.get('location')).searchParams.get('code');
  const exchange = (secret) =>
    fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${reg.client_id}:${secret}`).toString(
          'base64'
        )}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
  assert.equal((await exchange('wrong')).status, 401, 'wrong client secret');
  const ok = await exchange(reg.client_secret);
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).access_token, /^okr_at_/);
});
