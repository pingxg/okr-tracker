import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTenantMember, tenantIdFrom } from '../src/auth/tenant.js';

const TENANT = 'fb1ab561-9798-4849-9f08-f2653e879e76';
const OTHER = '11111111-2222-3333-4444-555555555555';

test('tenant id comes from OIDC_TENANT_ID or the issuer URL', () => {
  assert.equal(
    tenantIdFrom({
      issuer: `https://login.microsoftonline.com/${TENANT.toUpperCase()}/v2.0`,
    }),
    TENANT
  );
  assert.equal(tenantIdFrom({ tenantId: TENANT, issuer: '' }), TENANT);
  assert.equal(
    tenantIdFrom({ issuer: 'https://login.microsoftonline.com/common/v2.0' }),
    null
  );
});

test('members of the organization are let in', () => {
  assert.equal(isTenantMember({ tid: TENANT }, TENANT), true);
  assert.equal(isTenantMember({ tid: TENANT, acct: 0 }, TENANT), true);
  assert.equal(
    isTenantMember({ tid: TENANT, idp: `https://sts.windows.net/${TENANT}/` }, TENANT),
    true
  );
});

test('other organizations, personal accounts and guests are refused', () => {
  assert.equal(isTenantMember({ tid: OTHER }, TENANT), false);
  assert.equal(isTenantMember({}, TENANT), false);
  // Guest invited from another organization
  assert.equal(
    isTenantMember({ tid: TENANT, idp: `https://sts.windows.net/${OTHER}/` }, TENANT),
    false
  );
  // Guest with a personal Microsoft account
  assert.equal(isTenantMember({ tid: TENANT, idp: 'live.com' }, TENANT), false);
  // Guest flagged by the optional acct claim
  assert.equal(isTenantMember({ tid: TENANT, acct: 1 }, TENANT), false);
});

test('without a known tenant nobody is let in', () => {
  assert.equal(isTenantMember({ tid: TENANT }, null), false);
});
