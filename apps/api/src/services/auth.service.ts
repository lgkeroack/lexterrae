import bcrypt from 'bcryptjs';
import type { User } from '@lexterrae/shared';
import { isNeonDbError, PG_UNIQUE_VIOLATION } from '../lib/db.js';
import { AuthenticationError, ConflictError } from '../lib/errors.js';
import { signToken, verifyToken } from '../lib/tokens.js';
import type { Deps } from '../types.js';

/**
 * bcrypt cost. 10 keeps sign-in around 100–200 ms of Worker CPU (OWASP minimum); hashes with
 * other costs still verify, since the cost is stored in the hash.
 */
const BCRYPT_ROUNDS = 10;

// SECURITY: compared against when the email is unknown, so sign-in timing does not reveal
// which accounts exist. Computed lazily (once per isolate) to keep startup fast.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('timing-equalisation-placeholder', BCRYPT_ROUNDS);
  return dummyHash;
}

const USER_COLUMNS =
  'id, email, display_name AS "displayName", created_at AS "createdAt", updated_at AS "updatedAt"';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(deps: Deps, userId: string): Promise<Tokens> {
  const [accessToken, refreshToken] = await Promise.all([
    signToken(deps.config, userId, 'access'),
    signToken(deps.config, userId, 'refresh'),
  ]);
  return { accessToken, refreshToken };
}

function expiryDate(exp: number | undefined): Date {
  return exp ? new Date(exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export async function register(
  deps: Deps,
  email: string,
  password: string,
  displayName: string,
): Promise<{ user: User } & Tokens> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let rows: Record<string, unknown>[];
  try {
    rows = await deps.sql.query(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [email.toLowerCase(), passwordHash, displayName],
    );
  } catch (err) {
    if (isNeonDbError(err) && err.code === PG_UNIQUE_VIOLATION) {
      throw new ConflictError('An account with this email already exists');
    }
    throw err;
  }
  const user = rows[0] as unknown as User;
  deps.log.info({ module: 'auth', message: 'User registered', userId: user.id });
  return { user, ...(await issueTokens(deps, user.id)) };
}

export async function login(
  deps: Deps,
  email: string,
  password: string,
): Promise<{ user: User } & Tokens> {
  const rows = await deps.sql.query(
    `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash" FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  const found = rows[0] as (User & { passwordHash: string }) | undefined;
  const isValid = await bcrypt.compare(password, found?.passwordHash ?? (await getDummyHash()));
  if (!found || !isValid) {
    deps.log.info({ module: 'auth', message: 'Login failed: invalid credentials' });
    throw new AuthenticationError('Invalid email or password');
  }
  const { passwordHash: _passwordHash, ...user } = found;
  deps.log.info({ module: 'auth', message: 'User logged in', userId: user.id });
  return { user, ...(await issueTokens(deps, user.id)) };
}

export async function getUserById(deps: Deps, userId: string): Promise<User> {
  const rows = await deps.sql.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  if (!rows[0]) {
    throw new AuthenticationError('Your account no longer exists. Please sign in again.');
  }
  return rows[0] as unknown as User;
}

/**
 * Rotates a refresh token. The presented token is atomically marked as used (insert into
 * revoked_tokens), so it can be redeemed only once, even by concurrent requests.
 */
export async function refresh(deps: Deps, refreshToken: string): Promise<Tokens> {
  let payload;
  try {
    payload = await verifyToken(deps.config, refreshToken, 'refresh');
  } catch {
    throw new AuthenticationError('Your session has expired. Please sign in again.');
  }

  const claimed = await deps.sql`
    WITH claim AS (
      INSERT INTO revoked_tokens (jti, expires_at) VALUES (${payload.jti}, ${expiryDate(payload.exp)})
      ON CONFLICT (jti) DO NOTHING
      RETURNING jti
    )
    SELECT EXISTS (SELECT 1 FROM claim) AS claimed,
           EXISTS (SELECT 1 FROM users WHERE id = ${payload.userId}) AS user_exists`;
  const { claimed: ok, user_exists: userExists } = claimed[0] as {
    claimed: boolean;
    user_exists: boolean;
  };

  if (!ok) {
    deps.log.warn({
      module: 'auth',
      message: 'Refresh token reuse rejected',
      userId: payload.userId,
    });
    throw new AuthenticationError('Your session has expired. Please sign in again.');
  }
  // The account may have been deleted since the token was issued
  if (!userExists) throw new AuthenticationError('Your session has expired. Please sign in again.');

  return issueTokens(deps, payload.userId);
}

/** Revokes a refresh token (if valid). Never throws: logout always succeeds for the client. */
export async function logout(deps: Deps, refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  try {
    const payload = await verifyToken(deps.config, refreshToken, 'refresh', { allowExpired: true });
    await deps.sql`
      INSERT INTO revoked_tokens (jti, expires_at) VALUES (${payload.jti}, ${expiryDate(payload.exp)})
      ON CONFLICT (jti) DO NOTHING`;
    deps.log.info({ module: 'auth', message: 'User logged out', userId: payload.userId });
  } catch (err) {
    deps.log.warn({
      module: 'auth',
      message: 'Could not revoke refresh token on logout',
      error: err,
    });
  }
}

/** Seconds-since-epoch expiry of a token we issued (for the cookie's Expires). */
export async function refreshTokenExpiry(
  deps: Deps,
  refreshToken: string,
): Promise<Date | undefined> {
  try {
    const { exp } = await verifyToken(deps.config, refreshToken, 'refresh');
    return exp ? new Date(exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}
