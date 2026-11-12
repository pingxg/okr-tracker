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
let stopping = false;
let reconnectTimer = null;
let connectedOnce = false;

const RECONNECT_MS = 2000;

function scheduleReconnect(log) {
  if (stopping || reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startListener(log).catch(() => {});
  }, RECONNECT_MS);
}

async function startListener(log) {
  if (listener || stopping) {
    return;
  }
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
    // The connection is idle between writes; keepalives stop hosted
    // databases from dropping it.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  listener = client;
  const lost = (error) => {
    if (listener !== client) {
      return;
    }
    listener = null;
    if (!stopping) {
      log.error({ err: error }, 'LISTEN connection lost; reconnecting');
      client.end().catch(() => {});
      scheduleReconnect(log);
    }
  };
  client.on('notification', (msg) => {
    try {
      emitter.emit('change', JSON.parse(msg.payload));
    } catch {
      /* ignore malformed payloads */
    }
  });
  client.on('error', lost);
  client.on('end', () => lost(new Error('LISTEN connection ended')));
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (error) {
    // A failed reconnect must not leave a dead listener behind.
    lost(error);
    throw error;
  }
  if (connectedOnce) {
    // Writes made while the connection was down were not seen: tell the
    // browsers to reload what they show.
    emitter.emit('resync');
  }
  connectedOnce = true;
}

export async function stopListener() {
  stopping = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (listener) {
    const c = listener;
    listener = null;
    await c.end().catch(() => {});
  }
}

export default async function realtimeRoutes(fastify) {
  stopping = false;
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
    const onResync = () => res.write('event: resync\ndata: {}\n\n');
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

    emitter.on('change', onChange);
    emitter.on('resync', onResync);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      emitter.off('change', onChange);
      emitter.off('resync', onResync);
    });
    return reply;
  });
}
