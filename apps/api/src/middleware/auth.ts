import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env, JWT_AUDIENCE, JWT_ISSUER } from '../config/env.js';
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

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next(new AuthenticationError('Missing Authorization header'));
    return;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== 'bearer') {
    next(new AuthenticationError('Invalid Authorization header format. Expected: Bearer <token>'));
    return;
  }

  const token = parts[1]!;

  try {
    // SECURITY: Pin the algorithm and validate issuer/audience claims set at signing time
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as unknown as JwtPayload;

    if (!decoded.userId) {
      next(new AuthenticationError('Invalid token: missing userId'));
      return;
    }

    if (decoded.type !== 'access') {
      next(new AuthenticationError('Invalid token type'));
      return;
    }

    req.context = {
      userId: decoded.userId,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      logger.debug({
        module: 'auth',
        message: 'Token expired',
        requestId: req.requestId,
      });
      next(new AuthenticationError('Your session has expired. Please sign in again.'));
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
