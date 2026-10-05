/**
 * Database connection for the Node.js scripts in this folder (migrate, seed).
 * Reads DATABASE_URL (and NEON_LOCAL_PROXY for local development) from the environment
 * or apps/api/.env.
 */
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { useLocalNeonProxy } from '../src/lib/neon.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the real environment
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env.');
  process.exit(1);
}

const localProxy = process.env['NEON_LOCAL_PROXY'];
if (localProxy) useLocalNeonProxy(localProxy);
neonConfig.webSocketConstructor = WebSocket;

/** One-shot queries over HTTP. */
export const sql = neon(databaseUrl);

/** WebSocket pool: needed for multi-statement migrations and session-level locks. */
export function createPool(): Pool {
  return new Pool({ connectionString: databaseUrl });
}
