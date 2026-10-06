import type { MiddlewareHandler } from 'hono';
import { AuthenticationError } from '../lib/errors.js';
import { TokenExpiredError, verifyToken } from '../lib/tokens.js';
import type { AppEnv } from '../types.js';

/** Requires a valid `Authorization: Bearer <access token>` and sets `userId`. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization');
  if (!header) throw new AuthenticationError('Missing Authorization header');

  const parts = header.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== 'bearer') {
    throw new AuthenticationError('Invalid Authorization header format. Expected: Bearer <token>');
  }

  try {
    const payload = await verifyToken(c.get('deps').config, parts[1]!, 'access');
    c.set('userId', payload.userId);
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      throw new AuthenticationError('Your session has expired. Please sign in again.');
    }
    throw new AuthenticationError('Invalid token');
  }
  await next();
};
