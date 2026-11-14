/**
 * Group overview and "to update" list for the web app (browser session).
 *
 *   GET /api/v1/overview?organization=<id>   overview of one organization
 *   GET /api/v1/overview/mine                what the signed-in person should update
 */
import { actorFromRequest } from '../auth/users.js';
import { myUpdates, organizationOverview } from '../okr/overview.js';

async function requireUser(request, reply) {
  const actor = await actorFromRequest(request);
  if (!actor?.doc) {
    reply.code(401).send({ message: 'Sign in first' });
    return null;
  }
  return actor;
}

export default async function overviewRoutes(fastify) {
  fastify.get('/api/v1/overview', async (request, reply) => {
    const actor = await requireUser(request, reply);
    if (!actor) {
      return reply;
    }
    const id = String(request.query?.organization || '');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      return reply.code(400).send({ message: 'organization is required' });
    }
    const overview = await organizationOverview(actor, `organizations/${id}`);
    return overview || reply.code(404).send({ message: 'Organization not found' });
  });

  fastify.get('/api/v1/overview/mine', async (request, reply) => {
    const actor = await requireUser(request, reply);
    if (!actor) {
      return reply;
    }
    return myUpdates(actor);
  });
}
