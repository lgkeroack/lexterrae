import type { MiddlewareHandler } from 'hono';
import { getConfig } from '../env.js';
import { createSql } from '../lib/db.js';
import { createLogger } from '../lib/logger.js';
import type { AppEnv } from '../types.js';

// Client-supplied IDs are accepted only if short and log-safe (prevents log injection / bloat)
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Sets up per-request state: request ID, logger, database client and request logging.
 * Background work registered with `deps.defer` (audit logging) continues after the response.
 */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);

  const config = getConfig(c.env);
  const log = createLogger(
    { service: 'api', requestId },
    config.ENVIRONMENT === 'production' ? 'info' : 'debug',
  );
  const pending: Promise<unknown>[] = [];

  c.set('deps', {
    sql: createSql(config),
    bucket: c.env.BUCKET,
    config,
    log,
    requestId,
    clientIp: c.req.header('cf-connecting-ip') ?? '0.0.0.0',
    defer: (promise) => {
      pending.push(
        promise.catch((err: unknown) =>
          log.error({ message: 'Background task failed', error: err }),
        ),
      );
    },
  });

  const start = Date.now();
  try {
    await next();
  } finally {
    const status = c.res.status;
    log[status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info']({
      module: 'http',
      method: c.req.method,
      path: c.req.path,
      statusCode: status,
      durationMs: Date.now() - start,
    });
    if (pending.length > 0) c.executionCtx.waitUntil(Promise.allSettled(pending));
  }
};
