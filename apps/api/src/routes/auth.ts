import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type CookieOptions,
} from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { authService } from '../services/auth.service.js';
import { auditService } from '../services/audit.service.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AuthenticationError } from '../lib/errors.js';
import { loginLimiter, refreshLimiter, registerLimiter } from '../lib/rate-limit.js';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
} from '../validators/auth.validator.js';

const router: ReturnType<typeof Router> = Router();

/**
 * The refresh token is set as an httpOnly cookie scoped to the auth routes (and also
 * returned in the body for clients that keep it themselves). Refresh/logout accept it
 * from either the cookie or the JSON body.
 */
const REFRESH_COOKIE = 'lt_refresh';
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  // Browsers only send Secure cookies over HTTPS; local dev runs over plain http
  secure: env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test',
  sameSite: 'strict',
  path: '/api/auth',
};

function setRefreshCookie(res: Response, refreshToken: string): void {
  const { exp } = (jwt.decode(refreshToken) as { exp?: number } | null) ?? {};
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...refreshCookieOptions,
    ...(exp ? { expires: new Date(exp * 1000) } : {}),
  });
}

function readRefreshToken(req: Request): string | undefined {
  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  const fromCookie = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof fromCookie === 'string' && fromCookie.length > 0 ? fromCookie : undefined;
}

/**
 * POST /api/auth/register
 * Creates a new user account and returns tokens.
 */
router.post(
  '/register',
  registerLimiter,
  validate({ body: registerSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, displayName } = req.body;
      const result = await authService.register(email, password, displayName);

      auditService.logAction({
        actorUserId: result.user.id,
        actorIp: req.ip || '0.0.0.0',
        action: 'auth.register',
        resourceType: 'user',
        resourceId: result.user.id,
        requestId: req.requestId,
        outcome: 'success',
      });

      setRefreshCookie(res, result.refreshToken);
      res.status(201).json({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/login
 * Authenticates a user and returns tokens.
 */
router.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);

      auditService.logAction({
        actorUserId: result.user.id,
        actorIp: req.ip || '0.0.0.0',
        action: 'auth.login',
        resourceType: 'user',
        resourceId: result.user.id,
        requestId: req.requestId,
        outcome: 'success',
      });

      setRefreshCookie(res, result.refreshToken);
      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/auth/refresh
 * Rotates tokens using a valid refresh token (from the httpOnly cookie or the JSON body).
 */
router.post(
  '/refresh',
  refreshLimiter,
  validate({ body: refreshTokenSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = readRefreshToken(req);
      if (!refreshToken) {
        throw new AuthenticationError('No active session. Please sign in.');
      }
      const tokens = await authService.refreshToken(refreshToken);

      setRefreshCookie(res, tokens.refreshToken);
      res.status(200).json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    } catch (err) {
      // A rejected refresh token should not keep being re-sent by the browser
      if (err instanceof AuthenticationError) {
        res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
      }
      next(err);
    }
  },
);

/**
 * POST /api/auth/logout
 * Revokes the refresh token (cookie or body) and clears the cookie. Always succeeds.
 */
router.post(
  '/logout',
  refreshLimiter,
  validate({ body: logoutSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await authService.logout(readRefreshToken(req));

      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile (used to restore the session on page load).
 */
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getUserById(req.context!.userId);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
