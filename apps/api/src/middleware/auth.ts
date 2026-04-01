import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { AuthenticationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface RequestContext {
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

interface JwtPayload {
  userId: string;
  jti: string;
  type: string;
  iat?: number;
  exp?: number;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next(new AuthenticationError('Missing Authorization header'));
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    next(new AuthenticationError('Invalid Authorization header format. Expected: Bearer <token>'));
    return;
  }

  const token = parts[1]!;

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as unknown as JwtPayload;

    if (!decoded.userId) {
      next(new AuthenticationError('Invalid token: missing userId'));
      return;
    }

    if (decoded.type !== 'access') {
      next(new AuthenticationError('Invalid token type'));
      return;
    }

    // Check if access token has been revoked
    const isRevoked = await redis.get(`revoked:${decoded.jti}`);
    if (isRevoked) {
      next(new AuthenticationError('Token has been revoked'));
      return;
    }

    req.context = {
      userId: decoded.userId,
    };

    next();
  } catch (err) {
    if (err instanceof AuthenticationError) {
      next(err);
      return;
    }

    if (err instanceof jwt.TokenExpiredError) {
      logger.debug({
        module: 'auth',
        message: 'Token expired',
        requestId: req.requestId,
      });
      next(new AuthenticationError('Token has expired'));
      return;
    }

    if (err instanceof jwt.JsonWebTokenError) {
      logger.debug({
        module: 'auth',
        message: 'Invalid token',
        requestId: req.requestId,
        error: err.message,
      });
      next(new AuthenticationError('Invalid token'));
      return;
    }

    next(new AuthenticationError('Token verification failed'));
  }
}
