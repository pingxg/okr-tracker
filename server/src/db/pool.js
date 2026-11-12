import pg from 'pg';
import config from '../config.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
  // Opening a connection (TLS + login) to a hosted database takes ~0.5 s, so
  // keep idle connections for 5 minutes instead of pg's default 10 seconds,
  // and send TCP keepalives so the host does not drop them while idle.
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 5 * 60 * 1000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (error) => {
  console.error('Postgres pool error', error);
});

export default pool;
