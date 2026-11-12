/**
 * Live updates (replaces Firestore snapshot listeners).
 *
 * Every committed write sends `NOTIFY okr_changes {c: collection, p: path}`.
 * One LISTEN connection per server process fans the notifications out to
 * browsers over server-sent events; the browser then re-runs the affected
 * queries. Using Postgres for this means several server instances and the
 * cron job all see each other's writes.
 */
import { EventEmitter } from 'node:events';
import pg from 'pg';
import config from '../config.js';
import { actorFromRequest } from '../auth/users.js';
import { canRead } from '../policy/rules.js';
import { CHANNEL } from '../store/docstore.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let listener = null;

async function startListener(log) {
  if (listener) {
    return;
  }
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  });
  listener = client;
  client.on('notification', (msg) => {
    try {
      emitter.emit('change', JSON.parse(msg.payload));
    } catch {
      /* ignore malformed payloads */
    }
  });
  client.on('error', (error) => {
    log.error({ err: error }, 'LISTEN connection lost; reconnecting');
    listener = null;
    setTimeout(() => startListener(log).catch(() => {}), 2000);
  });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
}

export async function stopListener() {
  if (listener) {
    const c = listener;
    listener = null;
    await c.end().catch(() => {});
  }
}

export default async function realtimeRoutes(fastify) {
  await startListener(fastify.log);
  fastify.addHook('onClose', async () => stopListener());

  fastify.get('/api/v1/realtime', async (request, reply) => {
    const actor = await actorFromRequest(request);
    if (!actor?.doc) {
      return reply.code(401).send({ message: 'Not signed in' });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const onChange = (change) => {
      if (canRead(actor, change.c)) {
        res.write(`event: change\ndata: ${JSON.stringify(change)}\n\n`);
      }
    };
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

    emitter.on('change', onChange);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      emitter.off('change', onChange);
    });
    return reply;
  });
}
