/**
 * Database connection for the Node.js scripts in this folder (migrate, seed).
 *
 * DATABASE_URL comes from the environment, or from apps/api/.env when it is not set there.
 * NEON_LOCAL_PROXY (local development) is only honoured for a local database host, so running
 * `DATABASE_URL=<neon url> pnpm db:migrate` always reaches Neon even if .env has local settings.
 */
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { useLocalNeonProxy } from '../src/lib/neon.js';

if (!process.env['DATABASE_URL']) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file
  }
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.');
  process.exit(1);
}

let host: string;
try {
  host = new URL(databaseUrl).hostname;
} catch {
  console.error('DATABASE_URL is not a valid postgres:// connection string.');
  process.exit(1);
}

const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localtest.me');
const localProxy = process.env['NEON_LOCAL_PROXY'];
if (localProxy && isLocalHost) {
  useLocalNeonProxy(localProxy);
  console.log(`Database: ${host} via local Neon proxy ${localProxy}`);
} else {
  if (localProxy) console.warn(`Ignoring NEON_LOCAL_PROXY for non-local database host ${host}.`);
  console.log(`Database: ${host}`);
}
neonConfig.webSocketConstructor = WebSocket;

/** One-shot queries over HTTP. */
export const sql = neon(databaseUrl);

/** WebSocket pool: needed for multi-statement migrations and session-level locks. */
export function createPool(): Pool {
  return new Pool({ connectionString: databaseUrl });
}
