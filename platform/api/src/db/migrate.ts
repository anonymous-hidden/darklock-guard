import fs from 'fs';
import path from 'path';
import { pool, withTransaction } from './pool';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

async function ensureSchemaTable(client: import('pg').PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function migrationAlreadyApplied(client: import('pg').PoolClient, version: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
  return rows.length > 0;
}

async function applyMigration(client: import('pg').PoolClient, version: string, sql: string) {
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
}

export async function runMigrations(): Promise<void> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await withTransaction(async (client) => {
    await ensureSchemaTable(client);
    for (const file of files) {
      const version = file.split('.')[0];
      if (await migrationAlreadyApplied(client, version)) {
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await applyMigration(client, version, sql);
    }
  });
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failure', err);
      return pool.end().finally(() => process.exit(1));
    });
}
