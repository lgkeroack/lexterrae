import { Hono } from 'hono';
import type { HealthCheckResponse, ServiceHealth } from '@lexterrae/shared';
import { version } from '../../package.json';
import type { AppEnv } from '../types.js';

const CHECK_TIMEOUT_MS = 3_000;

const health = new Hono<AppEnv>();

/** GET /api/health — database (Neon) and storage (R2) status. */
health.get('/', async (c) => {
  const { sql, bucket, config, log } = c.get('deps');

  const probe = async (name: string, check: () => Promise<unknown>): Promise<ServiceHealth> => {
    const start = Date.now();
    let timer: number | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`)),
            CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'healthy', latencyMs: Date.now() - start };
    } catch (err) {
      const error = err instanceof Error ? err.message || err.name : 'Unknown error';
      log.error({ module: 'health', message: `${name} health check failed`, error });
      // SECURITY: raw dependency errors can reveal hostnames/config; only expose them outside production
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        ...(config.ENVIRONMENT !== 'production' ? { error } : {}),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const [database, storage] = await Promise.all([
    probe('Database', () => sql`SELECT 1`),
    probe('Storage', () => bucket.head('healthcheck')),
  ]);

  // Nothing works without the database; a storage outage only affects uploads/downloads
  const status: HealthCheckResponse['status'] =
    database.status !== 'healthy'
      ? 'unhealthy'
      : storage.status !== 'healthy'
        ? 'degraded'
        : 'healthy';

  const body: HealthCheckResponse = {
    status,
    version,
    environment: config.ENVIRONMENT,
    timestamp: new Date().toISOString(),
    checks: { database, storage },
  };
  c.header('Cache-Control', 'no-store');
  return c.json(body, status === 'unhealthy' ? 503 : 200);
});

export default health;
