import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  // Fail commands fast when Redis is down instead of hanging requests
  maxRetriesPerRequest: 3,
  connectTimeout: 5_000,
  lazyConnect: true,
  // Back off reconnect attempts up to 10s
  retryStrategy: (times) => Math.min(times * 200, 10_000),
});

// ioredis emits 'error' on every failed reconnect attempt; log once per outage to avoid flooding logs
let redisDown = false;

redis.on('error', (err) => {
  if (redisDown) return;
  redisDown = true;
  logger.error({
    module: 'redis',
    message: 'Redis connection error (further errors suppressed until reconnected)',
    error: { name: err.name, message: err.message },
  });
});

redis.on('ready', () => {
  redisDown = false;
  logger.info({ module: 'redis', message: 'Connected to Redis' });
});
