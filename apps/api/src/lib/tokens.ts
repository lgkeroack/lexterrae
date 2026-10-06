import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { JWT_AUDIENCE, JWT_ISSUER, type Config } from '../env.js';

export type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  userId: string;
  jti: string;
  type: TokenType;
  exp?: number;
}

function key(config: Config): Uint8Array {
  return new TextEncoder().encode(config.JWT_SECRET);
}

export async function signToken(config: Config, userId: string, type: TokenType): Promise<string> {
  return new SignJWT({ userId, type })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(type === 'access' ? config.JWT_EXPIRY : config.JWT_REFRESH_EXPIRY)
    .sign(key(config));
}

export class TokenExpiredError extends Error {}
export class InvalidTokenError extends Error {}

/**
 * Verifies signature (HS256 only), issuer, audience, expiry and token type.
 * `allowExpired` is used by logout so an expired refresh token can still be revoked.
 */
export async function verifyToken(
  config: Config,
  token: string,
  expectedType: TokenType,
  options: { allowExpired?: boolean } = {},
): Promise<TokenPayload> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, key(config), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      ...(options.allowExpired ? { currentDate: new Date(0) } : {}),
    }));
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw new TokenExpiredError('Token expired');
    throw new InvalidTokenError('Invalid token');
  }
  const { userId, jti, type, exp } = payload;
  if (typeof userId !== 'string' || typeof jti !== 'string' || type !== expectedType) {
    throw new InvalidTokenError('Invalid token');
  }
  return { userId, jti, type: expectedType, exp: typeof exp === 'number' ? exp : undefined };
}
