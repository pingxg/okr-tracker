# OKR Tracker (Node + PostgreSQL edition)

A fork of [oslokommune/okr-tracker](https://github.com/oslokommune/okr-tracker) that runs without
Google Firebase. The Vue frontend is unchanged; the backend is a Node.js server with a PostgreSQL
database, so the app can be self-hosted anywhere: a single Docker image, `docker compose`, or
Render.

The original project is © 2020 Oslo kommune, MIT licensed (see [LICENCE](LICENCE)).

## What changed in this fork

| Before (Firebase) | Now |
| --- | --- |
| Firestore, read and written directly by the browser | PostgreSQL, accessed through the Node server (`/api/v1/docs/*`) |
| `firestore.rules` | `server/src/policy/rules.js` — the same rules, enforced on the server, with tests |
| Cloud Functions triggers (audit log, slugs, progress roll-up, KPI caches) | Same code in `server/src/functions`, run by the server after each write |
| Firestore real-time listeners | Postgres `NOTIFY` → server-sent events → the browser refreshes affected data |
| Firebase Auth (Google / Microsoft popup) | OpenID Connect on the server (Microsoft Entra ID or any OIDC provider), httpOnly session cookie |
| External API on Cloud Functions + Google API Gateway | Same Express routes mounted at `/api/external` (see `public/openapi.yaml`) |
| Scheduled Firestore backups | `server/scripts/backup.js` (`pg_dump`) and the database host's point-in-time recovery |
| Apps Script user sync, Google Sheets integration | Removed; users are created on first SSO login |

Phase 1 keeps the original data model: every Firestore document is a row in the `documents`
table with the same path and fields (see `server/src/db/migrations/001_documents.sql`).
Reporting views (`okr_objectives`, `okr_key_results`, …) make the data easy to query from BI
tools. A relational model is planned for a later phase.

## Architecture

```
src/                 Vue 3 frontend (unchanged pages and components)
  backend/           Firestore/VueFire-compatible client for the Node API
common/docstore/     Value encoding shared by browser and server
server/
  src/
    app.js           Fastify server, mounts the legacy Express apps
    auth/            OIDC login, sessions, user provisioning
    policy/          Access rules (port of firestore.rules)
    store/           Document store on Postgres, queries, triggers
    compat/          Firebase Admin / Functions stand-ins used by the ported functions
    functions/       Ported Cloud Functions (audit, slugs, progress, KPI, external API)
    routes/          Document API and live updates
  scripts/           seed.js, backup.js
  test/              node:test suites
```

## Run locally

Requirements: Node.js 22 and PostgreSQL 14+ (or Docker).

### With Docker

```bash
docker compose up --build
docker compose exec app node scripts/seed.js   # optional demo data
```

Open http://localhost:3000 and sign in with `admin@example.com` and password `okr-dev`.

### Without Docker

```bash
npm install
npm --prefix server install
cp server/.env.example server/.env        # set DATABASE_URL and DEV_LOGIN_PASSWORD
npm --prefix server run seed              # optional demo data (admin@example.com)
npm run dev:server                        # API on http://localhost:3000
npm run dev                               # frontend on http://localhost:8080, proxies /api
```

## Sign-in with Microsoft Entra ID

1. Register an application in Entra ID (single tenant).
2. Add the redirect URI `<PUBLIC_URL>/api/v1/auth/callback` (type: Web) and create a client secret.
3. Set `OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0`, `OIDC_CLIENT_ID`,
   `OIDC_CLIENT_SECRET` and `PUBLIC_URL`.
4. Set `INITIAL_ADMIN_EMAIL` to the first super admin.

With `AUTO_CREATE_USERS=true` (default) everyone who can sign in to the tenant gets a user with no
roles on first login. Set it to `false` to require access requests or the `domainWhitelist`
collection instead. Any other OpenID Connect provider works the same way.

`DEV_LOGIN_PASSWORD` enables email + shared password sign-in for development and test
environments; leave it empty in production.

## Deploy to Render

`render.yaml` defines a Postgres database and one web service (Docker) in Frankfurt. Create a
Blueprint from the repository, then fill in `PUBLIC_URL`, the `OIDC_*` variables and
`INITIAL_ADMIN_EMAIL`. Migrations run automatically on start.

## Tests

```bash
npm run lint
npm run test:unit                                    # frontend (Jest)
TEST_DATABASE_URL=postgres://… npm --prefix server test   # server (node:test)
```

Server tests that need a database are skipped when `TEST_DATABASE_URL` is not set.

## Known limitations

- Icons are still loaded from Oslo kommune's Punkt CDN; they go away when the UI is replaced.
- Existing Firestore data needs an export/import tool, which is not part of this phase.
- Live updates refresh data shortly after a change instead of Firestore's optimistic local updates.
- The integrations page still mentions an `x-api-key` header; the external API no longer needs it.
