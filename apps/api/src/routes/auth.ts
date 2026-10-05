import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import { isLocalEnvironment } from '../env.js';
import { AuthenticationError } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { loginLimiter, refreshLimiter, registerLimiter } from '../middleware/rate-limit.js';
import { validJson } from '../middleware/validate.js';
import { audit } from '../services/audit.service.js';
import * as authService from '../services/auth.service.js';
import type { AppEnv } from '../types.js';
import {
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
} from '../validators/auth.validator.js';

const auth = new Hono<AppEnv>();

/**
 * The refresh token is set as an httpOnly cookie scoped to the auth routes (and also returned
 * in the body for clients that keep it themselves). Refresh/logout accept either.
 */
const REFRESH_COOKIE = 'lt_refresh';

function cookieOptions(c: Context<AppEnv>): CookieOptions {
  return {
    httpOnly: true,
    // Browsers only send Secure cookies over HTTPS; `wrangler dev` serves plain http
    secure: !isLocalEnvironment(c.get('deps').config),
    sameSite: 'Strict',
    path: '/api/auth',
  };
}

async function setRefreshCookie(c: Context<AppEnv>, refreshToken: string): Promise<void> {
  const expires = await authService.refreshTokenExpiry(c.get('deps'), refreshToken);
  setCookie(c, REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(c),
    ...(expires ? { expires } : {}),
  });
}

function readRefreshToken(c: Context<AppEnv>, bodyToken: string | undefined): string | undefined {
  if (bodyToken) return bodyToken;
  const fromCookie = getCookie(c, REFRESH_COOKIE);
  return fromCookie && fromCookie.length > 0 ? fromCookie : undefined;
}

/** POST /api/auth/register — creates an account and signs it in. */
auth.post('/register', registerLimiter, async (c) => {
  const deps = c.get('deps');
  const { email, password, displayName } = await validJson(c, registerSchema);
  const result = await authService.register(deps, email, password, displayName);

  audit(deps, {
    actorUserId: result.user.id,
    action: 'auth.register',
    resourceType: 'user',
    resourceId: result.user.id,
    outcome: 'success',
  });

  await setRefreshCookie(c, result.refreshToken);
  return c.json(result, 201);
});

/** POST /api/auth/login */
auth.post('/login', loginLimiter, async (c) => {
  const deps = c.get('deps');
  const { email, password } = await validJson(c, loginSchema);
  const result = await authService.login(deps, email, password);

  audit(deps, {
    actorUserId: result.user.id,
    action: 'auth.login',
    resourceType: 'user',
    resourceId: result.user.id,
    outcome: 'success',
  });

  await setRefreshCookie(c, result.refreshToken);
  return c.json(result, 200);
});

/** POST /api/auth/refresh — rotates tokens using the refresh cookie (or body). */
auth.post('/refresh', refreshLimiter, async (c) => {
  const body = await validJson(c, refreshTokenSchema);
  const refreshToken = readRefreshToken(c, body.refreshToken);
  try {
    if (!refreshToken) throw new AuthenticationError('No active session. Please sign in.');
    const tokens = await authService.refresh(c.get('deps'), refreshToken);
    await setRefreshCookie(c, tokens.refreshToken);
    return c.json(tokens, 200);
  } catch (err) {
    // A rejected refresh token should not keep being re-sent by the browser
    if (err instanceof AuthenticationError) deleteCookie(c, REFRESH_COOKIE, cookieOptions(c));
    throw err;
  }
});

/** POST /api/auth/logout — revokes the refresh token and clears the cookie. Always succeeds. */
auth.post('/logout', refreshLimiter, async (c) => {
  const body = await validJson(c, logoutSchema);
  await authService.logout(c.get('deps'), readRefreshToken(c, body.refreshToken));
  deleteCookie(c, REFRESH_COOKIE, cookieOptions(c));
  return c.json({ message: 'Logged out successfully' }, 200);
});

/** GET /api/auth/me — the signed-in user (restores the session on page load). */
auth.get('/me', authenticate, async (c) => {
  const user = await authService.getUserById(c.get('deps'), c.get('userId'));
  return c.json({ user }, 200);
});

export default auth;
