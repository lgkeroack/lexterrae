import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import type { CookieOptions } from 'hono/utils/cookie';
import { isGoogleSignInEnabled, isLocalEnvironment } from '../env.js';
import { AuthenticationError } from '../lib/errors.js';
import { authenticate } from '../middleware/auth.js';
import { loginLimiter, refreshLimiter, registerLimiter } from '../middleware/rate-limit.js';
import { validJson } from '../middleware/validate.js';
import { audit } from '../services/audit.service.js';
import * as authService from '../services/auth.service.js';
import * as google from '../services/google.service.js';
import type { AppEnv } from '../types.js';
import {
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
} from '../validators/auth.validator.js';

const auth = new Hono<AppEnv>();

// SECURITY: these routes set or use the refresh cookie, so reject cross-site form posts
// (checks Sec-Fetch-Site / Origin for form-encodable content types). Bearer-token routes
// elsewhere are not CSRF-able and do not need this.
auth.use('*', csrf());

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

/**
 * The httpOnly cookie is authoritative: it is always the newest token for this browser. A token
 * in the body is only a fallback for clients without cookies (a stale in-memory copy must never
 * win over the cookie, or a valid session would be rejected as token reuse).
 */
function readRefreshToken(c: Context<AppEnv>, bodyToken: string | undefined): string | undefined {
  const fromCookie = getCookie(c, REFRESH_COOKIE);
  if (fromCookie) return fromCookie;
  return bodyToken || undefined;
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
  // Revoke every token the client presented (cookie and body may differ)
  const tokens = new Set([getCookie(c, REFRESH_COOKIE), body.refreshToken].filter(Boolean));
  for (const token of tokens) await authService.logout(c.get('deps'), token);
  deleteCookie(c, REFRESH_COOKIE, cookieOptions(c));
  return c.json({ message: 'Logged out successfully' }, 200);
});

// ─── Sign in with Google ──────────────────────────────────────────────────────

/** Holds state, nonce and PKCE verifier between /google/start and /google/callback. */
const GOOGLE_FLOW_COOKIE = 'lt_google_flow';

function googleFlowCookieOptions(c: Context<AppEnv>): CookieOptions {
  return {
    httpOnly: true,
    secure: !isLocalEnvironment(c.get('deps').config),
    // Lax: the callback is a top-level navigation from accounts.google.com
    sameSite: 'Lax',
    path: '/api/auth/google',
    maxAge: 10 * 60,
  };
}

function googleRedirectUri(c: Context<AppEnv>): string {
  return `${new URL(c.req.url).origin}/api/auth/google/callback`;
}

/** GET /api/auth/providers — which sign-in methods are available (drives the login page). */
auth.get('/providers', (c) => {
  return c.json({ password: true, google: isGoogleSignInEnabled(c.get('deps').config) }, 200);
});

/** GET /api/auth/google/start — redirects the browser to Google's consent screen. */
auth.get('/google/start', async (c) => {
  const { config } = c.get('deps');
  if (!isGoogleSignInEnabled(config)) return c.redirect('/login?error=disabled', 302);

  const flow = google.createFlowState();
  setCookie(c, GOOGLE_FLOW_COOKIE, google.encodeFlowState(flow), googleFlowCookieOptions(c));
  const url = await google.buildAuthorizationUrl(
    config.GOOGLE_CLIENT_ID,
    googleRedirectUri(c),
    flow,
  );
  c.header('Cache-Control', 'no-store');
  return c.redirect(url, 302);
});

/**
 * GET /api/auth/google/callback — Google redirects here with ?code&state. On success the
 * refresh cookie is set and the browser goes to /auth/google/complete, where the app
 * exchanges the cookie for an access token. Failures go back to /login?error=<reason>.
 */
auth.get('/google/callback', async (c) => {
  const deps = c.get('deps');
  const { config } = deps;
  const flow = google.decodeFlowState(getCookie(c, GOOGLE_FLOW_COOKIE));
  deleteCookie(c, GOOGLE_FLOW_COOKIE, googleFlowCookieOptions(c));
  c.header('Cache-Control', 'no-store');

  const fail = (reason: google.GoogleSignInFailure, detail?: string) => {
    if (reason !== 'cancelled') {
      deps.log.warn({ module: 'auth', message: 'Google sign-in failed', reason, error: detail });
    }
    return c.redirect(`/login?error=${reason}`, 302);
  };

  if (!isGoogleSignInEnabled(config)) return fail('disabled');
  // The user pressed Cancel (error=access_denied) or Google reported another problem
  const providerError = c.req.query('error');
  if (providerError) return fail(providerError === 'access_denied' ? 'cancelled' : 'failed');

  const code = c.req.query('code');
  const state = c.req.query('state');
  // SECURITY: the state must match the cookie set by /google/start in this browser (login CSRF)
  if (!code || !state || !flow || state !== flow.state) {
    return fail('failed', 'Missing or mismatched state');
  }

  try {
    const identity = await google.exchangeCode(
      {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        redirectUri: googleRedirectUri(c),
      },
      code,
      flow,
    );
    const { user, created } = await google.findOrCreateGoogleUser(deps, identity);
    const tokens = await authService.issueTokens(deps, user.id);

    audit(deps, {
      actorUserId: user.id,
      action: created ? 'auth.register' : 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      outcome: 'success',
      changes: { method: 'google' },
    });
    deps.log.info({
      module: 'auth',
      message: created ? 'User registered with Google' : 'User signed in with Google',
      userId: user.id,
    });

    await setRefreshCookie(c, tokens.refreshToken);
    return c.redirect('/auth/google/complete', 302);
  } catch (err) {
    if (err instanceof google.GoogleSignInError) return fail(err.reason, err.message);
    return fail('failed', err instanceof Error ? err.message : String(err));
  }
});

/** GET /api/auth/me — the signed-in user (restores the session on page load). */
auth.get('/me', authenticate, async (c) => {
  const user = await authService.getUserById(c.get('deps'), c.get('userId'));
  return c.json({ user }, 200);
});

export default auth;
