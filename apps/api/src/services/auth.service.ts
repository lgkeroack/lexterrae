import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { AuthenticationError } from '../lib/errors.js';
import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('auth.service');

interface GoogleTokenPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified: boolean;
}

export class AuthService {
  /**
   * Exchange a Google OAuth authorization code for tokens, then find or create the user.
   */
  async googleAuth(code: string, redirectUri: string) {
    // Exchange code for Google tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      logger.error({ message: 'Google token exchange failed', error: err });
      throw new AuthenticationError('Google authentication failed');
    }

    const tokenData = await tokenRes.json() as { id_token: string };

    // Decode and verify the ID token
    const googleUser = this.decodeGoogleIdToken(tokenData.id_token);

    if (!googleUser.email_verified) {
      throw new AuthenticationError('Google email is not verified');
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { googleId: googleUser.sub } });

    if (!user) {
      // Check if email already exists from a different Google account
      const existingByEmail = await prisma.user.findUnique({ where: { email: googleUser.email } });
      if (existingByEmail) {
        // Link this Google ID to existing account
        user = await prisma.user.update({
          where: { email: googleUser.email },
          data: {
            googleId: googleUser.sub,
            avatarUrl: googleUser.picture,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            googleId: googleUser.sub,
            email: googleUser.email,
            displayName: googleUser.name,
            avatarUrl: googleUser.picture,
          },
        });
        logger.info({ userId: user.id, message: 'New user created via Google OAuth' });
      }
    } else {
      // Update avatar and display name from Google on each login
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          avatarUrl: googleUser.picture,
          displayName: googleUser.name,
        },
      });
    }

    const { googleId, ...safeUser } = user;
    const tokens = this.generateTokens(user.id);
    return { user: safeUser, ...tokens };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_SECRET) as { userId: string; jti: string; type: string };
      if (payload.type !== 'refresh') {
        throw new AuthenticationError('Invalid token type');
      }

      // Check if token is revoked
      const isRevoked = await redis.get(`revoked:${payload.jti}`);
      if (isRevoked) {
        throw new AuthenticationError('Token has been revoked');
      }

      // Revoke old refresh token (rotation)
      await redis.set(`revoked:${payload.jti}`, '1', 'EX', 7 * 24 * 60 * 60);

      return this.generateTokens(payload.userId);
    } catch (err) {
      if (err instanceof AuthenticationError) throw err;
      throw new AuthenticationError('Invalid or expired refresh token');
    }
  }

  async logout(refreshToken: string, accessJti?: string) {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_SECRET, { ignoreExpiration: true }) as { jti: string };
      await redis.set(`revoked:${payload.jti}`, '1', 'EX', 7 * 24 * 60 * 60);
    } catch {
      // Token already invalid, nothing to revoke
    }

    // Also revoke the access token if provided
    if (accessJti) {
      await redis.set(`revoked:${accessJti}`, '1', 'EX', 15 * 60);
    }
  }

  generateTokens(userId: string) {
    const accessJti = uuidv4();
    const refreshJti = uuidv4();

    const accessToken = jwt.sign(
      { userId, jti: accessJti, type: 'access' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRY as string & jwt.SignOptions['expiresIn'], issuer: 'lexterrae', audience: 'lexterrae-api' },
    );

    const refreshToken = jwt.sign(
      { userId, jti: refreshJti, type: 'refresh' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRY as string & jwt.SignOptions['expiresIn'], issuer: 'lexterrae', audience: 'lexterrae-api' },
    );

    return { accessToken, refreshToken, accessJti };
  }

  private decodeGoogleIdToken(idToken: string): GoogleTokenPayload {
    // Decode the JWT payload (Google's ID token is a standard JWT)
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new AuthenticationError('Invalid Google ID token format');
    }
    try {
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
      return payload as GoogleTokenPayload;
    } catch {
      throw new AuthenticationError('Failed to decode Google ID token');
    }
  }
}

export const authService = new AuthService();
