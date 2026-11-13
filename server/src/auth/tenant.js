/**
 * Only people of our own Microsoft 365 organization (Entra ID tenant) may
 * sign in. Accounts from other organizations, personal Microsoft accounts and
 * guest (B2B) accounts invited into the tenant are turned away.
 */

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Tenant id from OIDC_TENANT_ID, or from an issuer like
 * https://login.microsoftonline.com/<tenant-id>/v2.0. Null when unknown.
 */
export function tenantIdFrom({ tenantId, issuer }) {
  const id = tenantId || String(issuer || '').match(GUID)?.[0];
  return id ? id.toLowerCase() : null;
}

/**
 * True when the ID token claims belong to a member (not a guest) of `tenantId`.
 * Fails closed: without a known tenant nobody is let in.
 */
export function isTenantMember(claims, tenantId) {
  if (!tenantId || !claims) {
    return false;
  }
  if (String(claims.tid || '').toLowerCase() !== tenantId) {
    return false;
  }
  // Guests carry the identity provider of their home organization in `idp`
  // (another tenant, or live.com for personal accounts). Members have no
  // `idp`, or one pointing at this tenant.
  if (claims.idp) {
    const idp = String(claims.idp).toLowerCase();
    if (!idp.includes(tenantId)) {
      return false;
    }
  }
  // Optional `acct` claim, when configured in Entra: 0 member, 1 guest.
  if (claims.acct !== undefined && Number(claims.acct) !== 0) {
    return false;
  }
  return true;
}
