/**
 * Document API used by the browser (the Firestore replacement).
 *
 *   POST /api/v1/docs/get     { path, depth? }                  -> document
 *   POST /api/v1/docs/query   { collection, constraints, depth?, count? }
 *   POST /api/v1/docs/commit  { ops: [{ type, path, data?, merge? }] }
 *
 * `depth` resolves references server-side (VueFire's maxRefDepth). Reads and
 * writes are checked by the policy module; writes then run the triggers.
 */
import { collectionOf } from '../../../common/docstore/encoding.js';
import { actorFromRequest } from '../auth/users.js';
import { assertCanRead, authorizerFor, canRead, PolicyError } from '../policy/rules.js';
import {
  assertCollectionPath,
  assertDocumentPath,
  commit,
  countDocuments,
  getDocument,
  queryDocuments,
} from '../store/docstore.js';
import { resolveReferences } from '../store/resolve.js';

const objectBody = { type: 'object' };

export default async function docRoutes(fastify) {
  fastify.post('/api/v1/docs/get', { schema: { body: objectBody } }, async (request) => {
    const actor = await actorFromRequest(request);
    const path = assertDocumentPath(request.body.path);
    assertCanRead(actor, collectionOf(path));

    const doc = await getDocument(path);
    const { docs, deps } = await resolveReferences([doc], request.body.depth, (c) =>
      canRead(actor, c)
    );
    return { doc: docs[0], deps };
  });

  fastify.post(
    '/api/v1/docs/query',
    { schema: { body: objectBody } },
    async (request) => {
      const actor = await actorFromRequest(request);
      const collection = assertCollectionPath(request.body.collection);
      assertCanRead(actor, collection);
      const constraints = Array.isArray(request.body.constraints)
        ? request.body.constraints
        : [];

      if (request.body.count) {
        return { count: await countDocuments(collection, constraints) };
      }

      const found = await queryDocuments(collection, constraints);
      const { docs, deps } = await resolveReferences(found, request.body.depth, (c) =>
        canRead(actor, c)
      );
      return { docs, deps };
    }
  );

  fastify.post(
    '/api/v1/docs/commit',
    { schema: { body: objectBody } },
    async (request) => {
      const actor = await actorFromRequest(request);
      const ops = request.body.ops;
      if (!Array.isArray(ops)) {
        const error = new Error('ops must be an array');
        error.statusCode = 400;
        throw error;
      }
      // Only access requests may be written without a tracker user.
      const anonymousAllowed = ops.every((op) =>
        String(op.path || '').startsWith('requestAccess/')
      );
      if (!actor?.doc && !anonymousAllowed) {
        throw new PolicyError();
      }

      const results = await commit(
        ops.map(({ type, path, data, merge }) => ({ type, path, data, merge })),
        { authorize: authorizerFor(actor) }
      );
      return { results };
    }
  );
}
