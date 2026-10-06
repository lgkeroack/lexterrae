import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { User } from '@lexterrae/shared';
import { isNeonDbError, PG_UNIQUE_VIOLATION } from '../lib/db.js';
import type { Deps } from '../types.js';

/**
 * Sign in with Google (OpenID Connect authorization-code flow with PKCE).
 *
 * The Worker is the OAuth client: /api/auth/google/start redirects to Google with a random
 * state, nonce and PKCE challenge (kept in a short-lived httpOnly cookie), and
 * /api/auth/google/callback exchanges the code, verifies the ID token against Google's keys
 * and signs the user in.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Cached per isolate; jose refetches when Google rotates its keys
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Why Google sign-in failed; sent to the login page as ?error=<reason>. */
export type GoogleSignInFailure =
  | 'cancelled'
  | 'failed'
  | 'unverified_email'
  | 'account_exists'
  | 'disabled';

export class GoogleSignInError extends Error {
  constructor(
    readonly reason: GoogleSignInFailure,
    message: string = reason,
  ) {
    super(message);
  }
}

/** Per-attempt secrets, stored in the state cookie between start and callback. */
export interface GoogleFlowState {
  state: string;
  nonce: string;
  verifier: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function createFlowState(): GoogleFlowState {
  return { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
}

export function encodeFlowState(flow: GoogleFlowState): string {
  return base64url(new TextEncoder().encode(JSON.stringify(flow)));
}

export function decodeFlowState(value: string | undefined): GoogleFlowState | null {
  if (!value) return null;
  try {
    const json = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as Partial<GoogleFlowState>;
    if (
      typeof parsed.state === 'string' &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.verifier === 'string'
    ) {
      return { state: parsed.state, nonce: parsed.nonce, verifier: parsed.verifier };
    }
  } catch {
    // Malformed cookie
  }
  return null;
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  flow: GoogleFlowState,
): Promise<string> {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await pkceChallenge(flow.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | undefined;
}

/** Exchanges the authorization code and returns the verified identity from the ID token. */
export async function exchangeCode(
  params: { clientId: string; clientSecret: string; redirectUri: string },
  code: string,
  flow: GoogleFlowState,
): Promise<GoogleIdentity> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    }),
  });
  if (!response.ok) {
    // SECURITY: Google's error body names the problem (e.g. invalid_grant) but holds no secrets
    const detail = await response.text().catch(() => '');
    throw new GoogleSignInError(
      'failed',
      `Token exchange failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }
  const { id_token: idToken } = (await response.json()) as { id_token?: string };
  if (!idToken) throw new GoogleSignInError('failed', 'Token response had no id_token');

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleKeys, {
      issuer: ISSUERS,
      audience: params.clientId,
    }));
  } catch (err) {
    throw new GoogleSignInError(
      'failed',
      `ID token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (payload['nonce'] !== flow.nonce) {
    throw new GoogleSignInError('failed', 'ID token nonce mismatch');
  }
  const email = payload['email'];
  if (typeof payload.sub !== 'string' || typeof email !== 'string' || email.length > 255) {
    throw new GoogleSignInError('failed', 'ID token is missing sub or email');
  }
  if (payload['email_verified'] !== true) {
    throw new GoogleSignInError('unverified_email', 'Google email address is not verified');
  }
  const name = typeof payload['name'] === 'string' ? payload['name'] : undefined;
  return { sub: payload.sub, email: email.toLowerCase(), name };
}

const USER_COLUMNS =
  'id, email, display_name AS "displayName", created_at AS "createdAt", updated_at AS "updatedAt"';

export function displayNameFor(identity: GoogleIdentity): string {
  const name = identity.name?.trim() || identity.email.split('@')[0] || 'User';
  return name.slice(0, 100);
}

/**
 * Finds the account for a Google identity, creating one on first sign-in.
 *
 * SECURITY: an existing account with the same email is never linked automatically. Anyone can
 * register an email/password account for an address they do not own, so linking would let
 * that person into the real owner's account once the owner signs in with Google.
 */
export async function findOrCreateGoogleUser(
  deps: Deps,
  identity: GoogleIdentity,
): Promise<{ user: User; created: boolean }> {
  const bySub = await deps.sql.query(`SELECT ${USER_COLUMNS} FROM users WHERE google_sub = $1`, [
    identity.sub,
  ]);
  if (bySub[0]) return { user: bySub[0] as unknown as User, created: false };

  try {
    const rows = await deps.sql.query(
      `INSERT INTO users (email, password_hash, display_name, google_sub) VALUES ($1, NULL, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [identity.email, displayNameFor(identity), identity.sub],
    );
    return { user: rows[0] as unknown as User, created: true };
  } catch (err) {
    if (isNeonDbError(err) && err.code === PG_UNIQUE_VIOLATION) {
      // A concurrent first sign-in may have just created it
      const retry = await deps.sql.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE google_sub = $1`,
        [identity.sub],
      );
      if (retry[0]) return { user: retry[0] as unknown as User, created: false };
      throw new GoogleSignInError(
        'account_exists',
        'An account with this email already exists (password sign-in)',
      );
    }
    throw err;
  }
}
