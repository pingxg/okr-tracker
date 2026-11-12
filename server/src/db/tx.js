import pool from './pool.js';

/**
 * Run `fn(client)` in a transaction. Services take a client so several of them
 * can share one transaction, and so audit rows commit together with the change.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Query runner for reads: the pool itself, or a transaction's client. */
export const db = (client) => client || pool;
