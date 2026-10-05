import { Router } from 'express';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { HealthCheckResponse, ServiceHealth } from '@lexterrae/shared';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { s3Client } from '../config/s3.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const router: ReturnType<typeof Router> = Router();

const CHECK_TIMEOUT_MS = 3_000;

/** Runs a dependency probe with a timeout so a hung dependency cannot hang the health endpoint. */
async function probe(
  name: string,
  check: (signal: AbortSignal) => Promise<unknown>,
): Promise<ServiceHealth> {
  const start = Date.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`));
        }, CHECK_TIMEOUT_MS);
      }),
    ]);
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (err) {
    const error = err instanceof Error ? err.message || err.name : 'Unknown error';
    logger.error({ module: 'health', message: `${name} health check failed`, error });
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - start,
      // SECURITY: Raw dependency errors can reveal hostnames/config; only expose them outside production
      ...(env.NODE_ENV !== 'production' ? { error } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

router.get('/', async (_req, res) => {
  const [database, redisCheck, s3] = await Promise.all([
    probe('Database', () => prisma.$queryRaw`SELECT 1`),
    probe('Redis', () => redis.ping()),
    probe('S3', (abortSignal) =>
      s3Client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), { abortSignal }),
    ),
  ]);

  const checks = { database, redis: redisCheck, s3 };
  const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');
  // The API cannot serve anything without the database; Redis/S3 outages only degrade some features
  const status: HealthCheckResponse['status'] =
    database.status !== 'healthy' ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded';

  const body: HealthCheckResponse = {
    status,
    version: process.env['npm_package_version'] ?? '0.0.0',
    environment: env.NODE_ENV,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
  };

  res.set('Cache-Control', 'no-store');
  res.status(status === 'unhealthy' ? 503 : 200).json(body);
});

export default router;
