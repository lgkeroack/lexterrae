import type { Context, MiddlewareHandler } from 'hono';
import { RateLimitError } from '../lib/errors.js';
import type { AppEnv } from '../types.js';

/**
 * Rate limits from 07-SECURITY.md §1.3.
 *
 * - Per-minute API limits use the Workers Rate Limiting binding (fast, no database round trip).
 * - Longer windows (sign-in, registration, refresh, uploads) are fixed-window counters in
 *   Postgres, since the binding only supports 10s/60s periods.
 *
 * Both fail open: a limiter error is logged and the request is allowed.
 */

function clientKey(c: Context<AppEnv>, keyBy: 'ip' | 'user'): string {
  const userId = keyBy === 'user' ? c.get('userId') : undefined;
  return userId ? `user:${userId}` : `ip:${c.get('deps').clientIp}`;
}

/** Per-minute limiter backed by a Workers Rate Limiting binding. */
function bindingLimiter(options: {
  binding: (env: AppEnv['Bindings']) => RateLimit | undefined;
  detail: string;
  skip?: (c: Context<AppEnv>) => boolean;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limiter = options.binding(c.env);
    if (limiter && !options.skip?.(c)) {
      let success = true;
      try {
        ({ success } = await limiter.limit({ key: clientKey(c, 'user') }));
      } catch (err) {
        c.get('deps').log.warn({
          module: 'rate-limit',
          message: 'Rate limiter unavailable',
          error: err,
        });
      }
      if (!success) throw new RateLimitError(options.detail, 60);
    }
    await next();
  };
}

/** Fixed-window limiter with counters in Postgres (rate_limit_buckets). */
function windowLimiter(options: {
  name: string;
  windowMs: number;
  max: number;
  keyBy: 'ip' | 'user';
  detail: string;
  /** Only count responses with status >= 400 (e.g. failed sign-ins). */
  countFailuresOnly?: boolean;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { sql, log } = c.get('deps');
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / options.windowMs) * options.windowMs);
    const retryAfter = Math.max(
      1,
      Math.ceil((windowStart.getTime() + options.windowMs - now) / 1000),
    );
    const key = `${options.name}:${clientKey(c, options.keyBy)}`;

    const hit = async (): Promise<number | null> => {
      try {
        const [row] = await sql`
          INSERT INTO rate_limit_buckets (key, window_start, hits) VALUES (${key}, ${windowStart}, 1)
          ON CONFLICT (key) DO UPDATE SET
            hits = CASE WHEN rate_limit_buckets.window_start = EXCLUDED.window_start
                        THEN rate_limit_buckets.hits + 1 ELSE 1 END,
            window_start = EXCLUDED.window_start
          RETURNING hits`;
        return (row as { hits: number }).hits;
      } catch (err) {
        log.warn({
          module: 'rate-limit',
          message: `Rate limit counter unavailable (${options.name})`,
          error: err,
        });
        return null;
      }
    };

    if (options.countFailuresOnly) {
      let current = 0;
      try {
        const [row] = await sql`
          SELECT hits FROM rate_limit_buckets WHERE key = ${key} AND window_start = ${windowStart}`;
        current = (row as { hits: number } | undefined)?.hits ?? 0;
      } catch (err) {
        log.warn({
          module: 'rate-limit',
          message: `Rate limit counter unavailable (${options.name})`,
          error: err,
        });
      }
      if (current >= options.max) throw new RateLimitError(options.detail, retryAfter);
      await next();
      // Errors thrown by later handlers are rendered by onError before this point
      if (c.res.status >= 400 && c.res.status !== 429) c.get('deps').defer(hit());
      return;
    }

    const hits = await hit();
    if (hits !== null && hits > options.max) throw new RateLimitError(options.detail, retryAfter);
    c.header('RateLimit-Limit', String(options.max));
    c.header('RateLimit-Remaining', String(Math.max(0, options.max - (hits ?? 0))));
    c.header('RateLimit-Reset', String(retryAfter));
    await next();
  };
}

// --- Auth endpoints (per IP) ---

export const loginLimiter = windowLimiter({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyBy: 'ip',
  countFailuresOnly: true,
  detail: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.',
});

export const registerLimiter = windowLimiter({
  name: 'register',
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyBy: 'ip',
  detail: 'Too many registration attempts. Please try again in an hour.',
});

export const refreshLimiter = windowLimiter({
  name: 'refresh',
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyBy: 'ip',
  detail: 'Too many session refresh attempts. Please try again later.',
});

// --- API endpoints (per user once authenticated, otherwise per IP) ---

export const uploadLimiter = windowLimiter({
  name: 'upload',
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyBy: 'user',
  detail: 'Upload limit reached (50 per hour). Please try again later.',
});

export const generalLimiter = bindingLimiter({
  binding: (env) => env.API_RATE_LIMITER,
  detail: 'You are making requests too quickly. Please wait a moment and try again.',
});

export const searchLimiter = bindingLimiter({
  binding: (env) => env.SEARCH_RATE_LIMITER,
  // Only text searches count; plain paging and filtering use the general limit
  skip: (c) => !c.req.query('search')?.trim(),
  detail: 'Too many searches in a short time. Please wait a moment and try again.',
});
