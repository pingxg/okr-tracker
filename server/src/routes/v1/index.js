/**
 * REST API v1 (spec §16), milestone M2: people and organisation structure.
 *
 *   GET   /api/v1/me                    me, my memberships and permissions
 *   PATCH /api/v1/me                    personal settings (language)
 *   GET   /api/v1/users                 people search
 *   GET   /api/v1/users/{id}            a person and their memberships
 *   GET   /api/v1/org/tree              structure on a date (?date=YYYY-MM-DD)
 *   GET   /api/v1/org/nodes/{id}        one node on a date
 *   POST  /api/v1/org/nodes             new node
 *   PATCH /api/v1/org/nodes/{id}        rename, retype, move or deactivate
 *   POST  /api/v1/memberships           add a person to a node with a role
 *   PATCH /api/v1/memberships/{id}      change role or reporting line, or end
 *
 * Handlers only parse input and call services; rules live in the services and
 * the permission module (spec §13 "后端分层").
 */
import { z } from 'zod';
import { withTransaction } from '../../db/tx.js';
import { isISODate } from '../../lib/dates.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { canViewOrg, ROLES } from '../../policy/access.js';
import * as org from '../../services/org.js';
import * as users from '../../services/users.js';
import { requireActor } from './actor.js';

const isoDate = z.string().refine(isISODate, 'Expected a date as YYYY-MM-DD');
const uuid = z.uuid();
const name = z.string().trim().max(200);

const schemas = {
  dateQuery: z.object({ date: isoDate.optional() }),
  idParam: z.object({ id: uuid }),
  patchMe: z.object({ uiLanguage: z.enum(['en-US', 'zh-CN']) }).strict(),
  usersQuery: z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }),
  createNode: z
    .object({
      parentId: uuid,
      type: z.string().min(1).max(50),
      nameZh: name.optional(),
      nameEn: name.optional(),
      effectiveDate: isoDate.optional(),
    })
    .strict(),
  updateNode: z
    .object({
      parentId: uuid.optional(),
      type: z.string().min(1).max(50).optional(),
      nameZh: name.nullable().optional(),
      nameEn: name.nullable().optional(),
      active: z.literal(false).optional(),
      effectiveDate: isoDate.optional(),
      reason: z.string().trim().max(1000).optional(),
    })
    .strict(),
  createMembership: z
    .object({
      userId: uuid,
      nodeId: uuid,
      role: z.enum(ROLES),
      reportsTo: uuid.nullable().optional(),
      isPrimary: z.boolean().optional(),
      effectiveDate: isoDate.optional(),
    })
    .strict(),
  updateMembership: z
    .object({
      role: z.enum(ROLES).optional(),
      reportsTo: uuid.nullable().optional(),
      isPrimary: z.boolean().optional(),
      end: z.literal(true).optional(),
      effectiveDate: isoDate.optional(),
      reason: z.string().trim().max(1000).optional(),
    })
    .strict(),
};

function parse(schema, value) {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw badRequest(
      'invalid_request',
      'The request is not valid',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return result.data;
}

/** Context passed to services: who acts, and through which entry point. */
const contextOf = (request) => ({ actor: request.actor, source: 'web' });

export default async function v1Routes(fastify) {
  fastify.addHook('preHandler', async (request) => {
    request.actor = await requireActor(request);
  });

  // --- Me ------------------------------------------------------------------

  fastify.get('/me', async (request) => users.getMe(request.actor));

  fastify.patch('/me', async (request) =>
    users.updateMe(contextOf(request), parse(schemas.patchMe, request.body))
  );

  // --- People --------------------------------------------------------------

  fastify.get('/users', async (request) => {
    if (!canViewOrg(request.actor)) {
      throw forbidden();
    }
    return users.searchUsers(parse(schemas.usersQuery, request.query));
  });

  fastify.get('/users/:id', async (request) => {
    if (!canViewOrg(request.actor)) {
      throw forbidden();
    }
    const { id } = parse(schemas.idParam, request.params);
    return users.getUserDetail(id);
  });

  // --- Organisation --------------------------------------------------------

  fastify.get('/org/tree', async (request) => {
    if (!canViewOrg(request.actor)) {
      throw forbidden();
    }
    return org.getTree(parse(schemas.dateQuery, request.query));
  });

  fastify.get('/org/nodes/:id', async (request) => {
    if (!canViewOrg(request.actor)) {
      throw forbidden();
    }
    const { id } = parse(schemas.idParam, request.params);
    return org.getNode(id, parse(schemas.dateQuery, request.query));
  });

  fastify.post('/org/nodes', async (request, reply) => {
    const input = parse(schemas.createNode, request.body);
    const node = await withTransaction((client) =>
      org.createNode(contextOf(request), input, client)
    );
    return reply.code(201).send(node);
  });

  fastify.patch('/org/nodes/:id', async (request) => {
    const { id } = parse(schemas.idParam, request.params);
    const input = parse(schemas.updateNode, request.body);
    return withTransaction((client) =>
      org.updateNode(contextOf(request), id, input, client)
    );
  });

  // --- Memberships ---------------------------------------------------------

  fastify.post('/memberships', async (request, reply) => {
    const input = parse(schemas.createMembership, request.body);
    const membership = await withTransaction((client) =>
      org.addMembership(contextOf(request), input, client)
    );
    return reply.code(201).send(membership);
  });

  fastify.patch('/memberships/:id', async (request) => {
    const { id } = parse(schemas.idParam, request.params);
    const input = parse(schemas.updateMembership, request.body);
    return withTransaction((client) =>
      org.updateMembership(contextOf(request), id, input, client)
    );
  });
}
