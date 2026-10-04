import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { Prisma } from '@prisma/client';
import { env, JWT_AUDIENCE, JWT_ISSUER } from '../config/env.js';
import {
  AuthenticationError,
  ConflictError,
  ServiceUnavailableError,
  ValidationError,
} from '../lib/errors.js';
import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('auth.service');
const BCRYPT_ROUNDS = 12;
const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
} as const;

// SECURITY: Compared against when the email is unknown so login timing does not reveal which accounts exist
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('timing-equalisation-placeholder', BCRYPT_ROUNDS);

interface RefreshPayload {
  userId: string;
  jti: string;
  type: string;
  exp?: number;
}

/** Seconds until the token's exp claim (min 1), so revocation entries expire with the token. */
function secondsUntilExpiry(exp: number | undefined): number {
  if (!exp) return 7 * 24 * 60 * 60;
  return Math.max(1, exp - Math.floor(Date.now() / 1000));
}

export class AuthService {
  async register(email: string, password: string, displayName: string) {
    // Validate password strength
    this.validatePassword(password);

    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: email.toLowerCase(),
          passwordHash,
          displayName,
        },
        select: USER_SELECT,
      });
    } catch (err) {
      // Concurrent registration with the same email
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('An account with this email already exists');
      }
      throw err;
    }

    logger.info({ userId: user.id, message: 'User registered successfully' });
    const tokens = this.generateTokens(user.id);
    return { user, ...tokens };
  }

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { ...USER_SELECT, passwordHash: true },
    });

    const isValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !isValid) {
      logger.info({ message: 'Login failed: invalid credentials' });
      throw new AuthenticationError('Invalid email or password');
    }

    logger.info({ userId: user.id, message: 'User logged in successfully' });
    const tokens = this.generateTokens(user.id);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return { user: safeUser, ...tokens };
  }

  async getUserById(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) {
      throw new AuthenticationError('Your account no longer exists. Please sign in again.');
    }
    return user;
  }

  async refreshToken(refreshToken: string) {
    const payload = this.verifyRefreshToken(refreshToken);

    // Rotation: atomically mark the presented token as used. SET NX fails if the jti is
    // already present, which also closes the race where two concurrent refreshes reuse one token.
    let claimed: string | null;
    try {
      claimed = await redis.set(
        `revoked:${payload.jti}`,
        '1',
        'EX',
        secondsUntilExpiry(payload.exp),
        'NX',
      );
    } catch (err) {
      logger.error({
        message: 'Redis unavailable during token refresh',
        error: err instanceof Error ? err.message : String(err),
      });
      throw new ServiceUnavailableError(
        'Unable to refresh your session right now. Please try again shortly.',
      );
    }
    if (claimed === null) {
      logger.warn({ userId: payload.userId, message: 'Refresh token reuse rejected' });
      throw new AuthenticationError('Your session has expired. Please sign in again.');
    }

    // The account may have been deleted since the token was issued
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true },
    });
    if (!user) {
      throw new AuthenticationError('Your session has expired. Please sign in again.');
    }

    logger.info({ userId: payload.userId, message: 'Token refreshed' });
    return this.generateTokens(payload.userId);
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    let payload: RefreshPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        ignoreExpiration: true,
      }) as RefreshPayload;
    } catch {
      return; // Token already invalid, nothing to revoke
    }

    try {
      await redis.set(`revoked:${payload.jti}`, '1', 'EX', secondsUntilExpiry(payload.exp));
      logger.info({ userId: payload.userId, message: 'User logged out' });
    } catch (err) {
      // Logout must still succeed for the client; the cookie is cleared regardless
      logger.error({
        message: 'Failed to revoke refresh token on logout',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private verifyRefreshToken(refreshToken: string): RefreshPayload {
    let payload: RefreshPayload;
    try {
      payload = jwt.verify(refreshToken, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      }) as RefreshPayload;
    } catch {
      throw new AuthenticationError('Your session has expired. Please sign in again.');
    }
    if (payload.type !== 'refresh' || !payload.userId || !payload.jti) {
      throw new AuthenticationError('Invalid refresh token');
    }
    return payload;
  }

  private generateTokens(userId: string) {
    const accessJti = uuidv4();
    const refreshJti = uuidv4();

    const accessToken = jwt.sign({ userId, jti: accessJti, type: 'access' }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRY as string & jwt.SignOptions['expiresIn'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const refreshToken = jwt.sign({ userId, jti: refreshJti, type: 'refresh' }, env.JWT_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRY as string & jwt.SignOptions['expiresIn'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return { accessToken, refreshToken };
  }

  private validatePassword(password: string) {
    if (password.length < 12) {
      throw new ValidationError('Password must be at least 12 characters long');
    }
    if (password.length > 128) {
      throw new ValidationError('Password must be 128 characters or fewer');
    }
    if (!/[A-Z]/.test(password)) {
      throw new ValidationError('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      throw new ValidationError('Password must contain at least one lowercase letter');
    }
    if (!/\d/.test(password)) {
      throw new ValidationError('Password must contain at least one digit');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      throw new ValidationError('Password must contain at least one special character');
    }
  }
}

export const authService = new AuthService();
