import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { authService } from '../services/auth.service.js';
import { auditService } from '../services/audit.service.js';
import { env } from '../config/env.js';
import { AuthenticationError } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';

const router: ReturnType<typeof Router> = Router();

const REFRESH_COOKIE = 'refreshToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Rate limiter for OAuth callback: 20 requests per 15 minutes per IP.
 */
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    type: 'https://lexterrae.io/problems/rate-limit',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many authentication attempts. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Rate limiter for token refresh: 30 requests per 15 minutes per IP.
 */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    type: 'https://lexterrae.io/problems/rate-limit',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many refresh attempts. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * GET /api/auth/google/config
 * Returns the Google OAuth client ID and redirect URI for the frontend.
 */
router.get('/google/config', (_req: Request, res: Response) => {
  res.json({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${env.ALLOWED_ORIGINS.split(',')[0]}/auth/callback`,
  });
});

/**
 * POST /api/auth/google/callback
 * Exchanges a Google authorization code for app tokens.
 * Sets refresh token as HTTP-only cookie, returns access token + user in body.
 */
router.post(
  '/google/callback',
  oauthLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, redirectUri } = req.body;
      if (!code || typeof code !== 'string') {
        throw new AuthenticationError('Authorization code is required');
      }
      if (!redirectUri || typeof redirectUri !== 'string') {
        throw new AuthenticationError('Redirect URI is required');
      }

      const result = await authService.googleAuth(code, redirectUri);

      auditService.logAction({
        actorUserId: result.user.id,
        actorIp: req.ip || '0.0.0.0',
        action: 'auth.google_login',
        resourceType: 'user',
        resourceId: result.user.id,
        requestId: req.requestId,
        outcome: 'success',
      });

      // Set refresh token as HTTP-only cookie
      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);

      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/refresh
 * Refreshes access and refresh tokens using the refresh token cookie.
 * Sets new refresh token cookie, returns new access token in body.
 */
router.post(
  '/refresh',
  refreshLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies[REFRESH_COOKIE];
      if (!refreshToken) {
        throw new AuthenticationError('No refresh token provided');
      }

      const tokens = await authService.refreshToken(refreshToken);

      // Set new refresh token cookie
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, COOKIE_OPTIONS);

      res.status(200).json({
        accessToken: tokens.accessToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/logout
 * Revokes both refresh and access tokens. Clears refresh token cookie.
 */
router.post(
  '/logout',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies[REFRESH_COOKIE];

      // Extract access token JTI for revocation
      let accessJti: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const decoded = JSON.parse(
            Buffer.from(authHeader.split(' ')[1]!.split('.')[1]!, 'base64url').toString()
          );
          accessJti = decoded.jti;
        } catch {
          // Ignore decode errors - access token revocation is best-effort
        }
      }

      if (refreshToken) {
        await authService.logout(refreshToken, accessJti);
      }

      // Clear the cookie
      res.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        path: '/api/auth',
      });

      res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/auth/me
 * Returns the current user's profile. Requires authentication.
 */
router.get(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { prisma } = await import('../config/database.js');
      const user = await prisma.user.findUnique({
        where: { id: req.context!.userId },
        select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true, updatedAt: true },
      });
      if (!user) {
        throw new AuthenticationError('User not found');
      }
      res.json({ user });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
