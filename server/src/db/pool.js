import pg from 'pg';
import config from '../config.js';

// Return `date` columns as 'YYYY-MM-DD' strings instead of local-midnight Date
// objects, which shift by a day depending on the server's time zone.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DATABASE_POOL_SIZE || 10),
});

pool.on('error', (error) => {
  console.error('Postgres pool error', error);
});

export default pool;
