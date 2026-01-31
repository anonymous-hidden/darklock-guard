import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;

if (!connectionString) {
  // Fail fast so misconfiguration is obvious
  throw new Error('DATABASE_URL is required');
}

export const pool = new Pool({ connectionString });

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error', err);
});

export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
