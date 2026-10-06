import { describe, expect, it } from 'vitest';
import type { Config } from '../env.js';
import { InvalidTokenError, signToken, TokenExpiredError, verifyToken } from './tokens.js';

const config: Config = {
  ENVIRONMENT: 'test',
  DATABASE_URL: 'postgresql://test',
  JWT_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  JWT_EXPIRY: '15m',
  JWT_REFRESH_EXPIRY: '7d',
  MAX_FILE_SIZE_MB: 50,
};

describe('tokens', () => {
  it('round-trips an access token', async () => {
    const token = await signToken(config, 'user-1', 'access');
    await expect(verifyToken(config, token, 'access')).resolves.toMatchObject({
      userId: 'user-1',
      type: 'access',
    });
  });

  it('rejects the wrong token type and a different secret', async () => {
    const refresh = await signToken(config, 'user-1', 'refresh');
    await expect(verifyToken(config, refresh, 'access')).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(
      verifyToken(
        { ...config, JWT_SECRET: 'another-secret-0123456789abcdef0123456789' },
        refresh,
        'refresh',
      ),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('reports expiry, which logout can opt out of', async () => {
    const token = await signToken({ ...config, JWT_REFRESH_EXPIRY: '1s' }, 'user-1', 'refresh');
    await new Promise((r) => setTimeout(r, 2100));
    await expect(verifyToken(config, token, 'refresh')).rejects.toBeInstanceOf(TokenExpiredError);
    await expect(
      verifyToken(config, token, 'refresh', { allowExpired: true }),
    ).resolves.toMatchObject({
      userId: 'user-1',
    });
  });
});
