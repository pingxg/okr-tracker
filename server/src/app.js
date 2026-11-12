/**
 * HTTP server: Fastify for the new API, with the two ported Express apps
 * (external API and access requests) mounted underneath.
 */
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import expressPlugin from '@fastify/express';
import fastifyStatic from '@fastify/static';
import config from './config.js';
import authRoutes from './auth/routes.js';
import docRoutes from './routes/docs.js';
import realtimeRoutes from './routes/realtime.js';
import { listTriggers } from './store/hooks.js';
import pool from './db/pool.js';

// Registers the ported Cloud Function triggers and returns the Express apps.
import { api, internal } from './functions/index.js';

export async function buildApp({ logger = true } = {}) {
  const fastify = Fastify({
    logger,
    trustProxy: config.trustProxyHops,
    bodyLimit: 2 * 1024 * 1024,
  });

  await fastify.register(cookie);

  // Legacy Express apps. They parse their own bodies, so they are mounted
  // before Fastify's body parsing runs.
  await fastify.register(expressPlugin);
  // Number of reverse proxies in front of the app (Render: 1). Needed for
  // correct client IPs in the rate limiters.
  api.set('trust proxy', config.trustProxyHops);
  internal.set('trust proxy', config.trustProxyHops);
  fastify.use('/api/external', api);
  fastify.use('/api/internal', internal);

  fastify.setErrorHandler((error, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Request failed');
    }
    reply.code(status).send({
      message: status >= 500 ? 'Internal server error' : error.message,
      code: error.code,
    });
  });

  fastify.get('/api/v1/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true, triggers: listTriggers().length };
  });

  await fastify.register(authRoutes);
  await fastify.register(docRoutes);
  await fastify.register(realtimeRoutes);

  // Built frontend with SPA fallback.
  if (existsSync(config.staticDir)) {
    await fastify.register(fastifyStatic, { root: config.staticDir, wildcard: false });
    fastify.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ message: 'Not found' });
    });
  }

  return fastify;
}
