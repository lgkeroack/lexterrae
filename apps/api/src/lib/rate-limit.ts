import type { Request } from 'express';
import rateLimit, {
  MemoryStore,
  type ClientRateLimitInfo,
  type Options as RateLimitOptions,
  type Store,
} from 'express-rate-limit';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { logger } from './logger.js';

/**
 * express-rate-limit store backed by Redis, so limits are shared across API instances.
 *
 * If Redis is unavailable the store falls back to a per-process memory store: limits
 * still apply (per instance) and requests are never rejected just because Redis is down.
 */
class RedisStore implements Store {
  prefix: string;
  private windowMs = 60_000;
  private readonly fallback = new MemoryStore();
  private warned = false;

  constructor(name: string) {
    this.prefix = `ratelimit:${name}:`;
  }

  init(options: RateLimitOptions): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  private onRedisError(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    logger.warn({
      module: 'rate-limit',
      message: `Redis unavailable; falling back to in-memory rate limiting for ${this.prefix}`,
      error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
    });
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redisKey = this.prefix + key;
    try {
      // Atomically count the hit and start the window on the first hit
      const result = await redis
        .multi()
        .incr(redisKey)
        .pexpire(redisKey, this.windowMs, 'NX')
        .pttl(redisKey)
        .exec();
      if (!result) throw new Error('Rate limit transaction aborted');
      const [[incrErr, totalHits], , [ttlErr, ttl]] = result as [
        [Error | null, number],
        unknown,
        [Error | null, number],
      ];
      if (incrErr || ttlErr) throw incrErr ?? ttlErr;
      this.warned = false;
      const remainingMs = ttl > 0 ? ttl : this.windowMs;
      return { totalHits, resetTime: new Date(Date.now() + remainingMs) };
    } catch (err) {
      this.onRedisError(err);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await redis.decr(this.prefix + key);
    } catch (err) {
      this.onRedisError(err);
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.fallback.resetKey(key);
    try {
      await redis.del(this.prefix + key);
    } catch (err) {
      this.onRedisError(err);
    }
  }
}

/** Rate-limit responses use the same RFC 7807 shape as every other API error. */
function rateLimitHandler(detail: string): RateLimitOptions['handler'] {
  return (req, res) => {
    res.status(429).json({
      type: 'https://lexterrae.io/problems/rate-limit-exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail,
      instance: req.originalUrl,
      code: 'RATE_LIMIT_EXCEEDED',
      requestId: req.requestId,
    });
  };
}

/** Per-user key once authenticated, otherwise per-IP. */
function userOrIpKey(req: Request): string {
  return req.context?.userId ? `user:${req.context.userId}` : `ip:${req.ip ?? 'unknown'}`;
}

interface LimiterConfig {
  /** Unique name, used as the Redis key prefix */
  name: string;
  windowMs: number;
  max: number;
  /** Message shown to the user when the limit is hit */
  detail: string;
  keyBy?: 'ip' | 'user';
  skipSuccessfulRequests?: boolean;
  skip?: (req: Request) => boolean;
}

function createLimiter(config: LimiterConfig) {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,
    skip: (req) => env.NODE_ENV === 'test' || (config.skip?.(req) ?? false),
    keyGenerator: config.keyBy === 'user' ? userOrIpKey : undefined,
    store: new RedisStore(config.name),
    handler: rateLimitHandler(config.detail),
  });
}

// --- Auth endpoints (per IP) — see 07-SECURITY.md §1.3 ---

export const loginLimiter = createLimiter({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  max: 10,
  // Only failed attempts count, so legitimate users are not locked out by normal use
  skipSuccessfulRequests: true,
  detail: 'Too many failed sign-in attempts. Please wait 15 minutes and try again.',
});

export const registerLimiter = createLimiter({
  name: 'register',
  windowMs: 60 * 60 * 1000,
  max: 5,
  detail: 'Too many registration attempts. Please try again in an hour.',
});

export const refreshLimiter = createLimiter({
  name: 'refresh',
  windowMs: 15 * 60 * 1000,
  max: 60,
  detail: 'Too many session refresh attempts. Please try again later.',
});

// --- API endpoints (per user once authenticated) ---

export const generalLimiter = createLimiter({
  name: 'general',
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  keyBy: 'user',
  detail: 'You are making requests too quickly. Please wait a moment and try again.',
});

export const uploadLimiter = createLimiter({
  name: 'upload',
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyBy: 'user',
  detail: 'Upload limit reached (50 per hour). Please try again later.',
});

export const searchLimiter = createLimiter({
  name: 'search',
  windowMs: 60 * 1000,
  max: 30,
  keyBy: 'user',
  // Only text searches count; plain paging and filtering use the general limit
  skip: (req) => typeof req.query['search'] !== 'string' || req.query['search'].trim() === '',
  detail: 'Too many searches in a short time. Please wait a moment and try again.',
});
