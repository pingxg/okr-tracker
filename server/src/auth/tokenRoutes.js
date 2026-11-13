/**
 * Managing AI assistant access from the profile page (browser session only;
 * a token can never be used to create more tokens).
 *
 *   GET    /api/v1/tokens                        personal tokens + connected assistants
 *   POST   /api/v1/tokens            { name, expiresInDays }  create, secret shown once
 *   DELETE /api/v1/tokens/:id                    revoke a personal token
 *   DELETE /api/v1/tokens/assistants/:clientId   disconnect an assistant (OAuth)
 */
import { actorFromRequest } from './users.js';
import {
  MAX_PATS_PER_USER,
  countActivePats,
  createToken,
  listCredentials,
  revokeClientGrant,
  revokePat,
} from './tokens.js';

const EXPIRY_DAYS = [30, 90, 180, 365];

async function requireUser(request, reply) {
  const actor = await actorFromRequest(request);
  if (!actor?.doc) {
    reply.code(401).send({ message: 'Sign in first' });
    return null;
  }
  return actor;
}

export default async function tokenRoutes(fastify) {
  fastify.get('/api/v1/tokens', async (request, reply) => {
    const actor = await requireUser(request, reply);
    if (!actor) {
      return reply;
    }
    return listCredentials(actor.email);
  });

  fastify.post('/api/v1/tokens', async (request, reply) => {
    const actor = await requireUser(request, reply);
    if (!actor) {
      return reply;
    }
    const name = String(request.body?.name || '')
      .trim()
      .slice(0, 80);
    const days = Number(request.body?.expiresInDays || 90);
    if (!name) {
      return reply.code(400).send({ message: 'A name is required' });
    }
    if (!EXPIRY_DAYS.includes(days)) {
      return reply
        .code(400)
        .send({ message: `expiresInDays must be one of ${EXPIRY_DAYS}` });
    }
    if ((await countActivePats(actor.email)) >= MAX_PATS_PER_USER) {
      return reply
        .code(400)
        .send({ message: `At most ${MAX_PATS_PER_USER} active tokens per person` });
    }
    const { id, secret, expiresAt } = await createToken({
      kind: 'pat',
      email: actor.email,
      name,
      ttlSeconds: days * 24 * 60 * 60,
    });
    return { id, name, token: secret, expires: expiresAt };
  });

  fastify.delete('/api/v1/tokens/assistants/:clientId', async (request, reply) => {
    const actor = await requireUser(request, reply);
    if (!actor) {
      return reply;
    }
    await revokeClientGrant(actor.email, request.params.clientId);
    return { ok: true };
  });

  fastify.delete('/api/v1/tokens/:id', async (request, reply) => {
    const actor = await requireUser(request, reply);
    if (!actor) {
      return reply;
    }
    const ok = await revokePat(actor.email, request.params.id);
    return ok ? { ok: true } : reply.code(404).send({ message: 'Token not found' });
  });
}
