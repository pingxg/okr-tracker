import pg from 'pg';
import config from '../config.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
});

pool.on('error', (error) => {
  console.error('Postgres pool error', error);
});

export default pool;
