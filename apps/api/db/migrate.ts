/**
 * Applies pending SQL migrations from db/migrations in filename order.
 * Each file runs in its own transaction and is recorded in schema_migrations.
 *
 * Usage: pnpm --filter @lexterrae/api db:migrate
 */
import { readdir, readFile } from 'node:fs/promises';
import { createPool } from './connect.js';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
// Arbitrary constant: serialises concurrent migration runs (e.g. two CI deploys)
const LOCK_ID = 7_351_204;

async function main() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log(`Database is up to date (${files.length} migration(s) applied).`);
      return;
    }

    for (const file of pending) {
      const body = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      process.stdout.write(`Applying ${file}... `);
      try {
        await client.query('BEGIN');
        await client.query(body);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('done');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('failed');
        throw err;
      }
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
