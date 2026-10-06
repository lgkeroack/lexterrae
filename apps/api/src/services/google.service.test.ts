import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../types.js';
import {
  buildAuthorizationUrl,
  createFlowState,
  decodeFlowState,
  displayNameFor,
  encodeFlowState,
  exchangeCode,
  findOrCreateGoogleUser,
  GoogleSignInError,
  pkceChallenge,
} from './google.service.js';

afterEach(() => vi.unstubAllGlobals());

describe('google flow state', () => {
  it('round-trips through the cookie encoding', () => {
    const flow = createFlowState();
    expect(decodeFlowState(encodeFlowState(flow))).toEqual(flow);
    expect(flow.state).not.toEqual(flow.nonce);
  });

  it('rejects missing or malformed cookies', () => {
    expect(decodeFlowState(undefined)).toBeNull();
    expect(decodeFlowState('not-base64!')).toBeNull();
    expect(decodeFlowState(btoa(JSON.stringify({ state: 'x' })))).toBeNull();
  });
});

describe('pkceChallenge', () => {
  it('matches the RFC 7636 test vector', async () => {
    await expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('buildAuthorizationUrl', () => {
  it('requests an OpenID code with state, nonce and an S256 challenge', async () => {
    const flow = createFlowState();
    const url = new URL(
      await buildAuthorizationUrl('client-1', 'https://app.example/api/auth/google/callback', flow),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-1',
      redirect_uri: 'https://app.example/api/auth/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: await pkceChallenge(flow.verifier),
      code_challenge_method: 'S256',
    });
    // The verifier itself never leaves the server
    expect(url.toString()).not.toContain(flow.verifier);
  });
});

describe('displayNameFor', () => {
  it('uses the Google name, else the email local part, capped at 100 characters', () => {
    expect(displayNameFor({ sub: '1', email: 'a@b.ca', name: ' Jane Doe ' })).toBe('Jane Doe');
    expect(displayNameFor({ sub: '1', email: 'jdoe@b.ca', name: undefined })).toBe('jdoe');
    expect(displayNameFor({ sub: '1', email: 'a@b.ca', name: 'x'.repeat(150) })).toHaveLength(100);
  });
});

describe('exchangeCode', () => {
  it('reports a failed token exchange', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );
    const error = await exchangeCode(
      { clientId: 'c', clientSecret: 's', redirectUri: 'https://app/cb' },
      'code',
      createFlowState(),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleSignInError);
    expect((error as GoogleSignInError).reason).toBe('failed');
  });
});

function fakeDeps(query: (text: string, params: unknown[]) => Promise<unknown[]>): Deps {
  return { sql: { query } } as unknown as Deps;
}

const identity = { sub: 'google-123', email: 'owner@example.com', name: 'Owner' };
const user = { id: 'u1', email: identity.email, displayName: 'Owner' };

describe('findOrCreateGoogleUser', () => {
  it('signs in an account already linked to the Google identity', async () => {
    const query = vi.fn(async () => [user]);
    await expect(findOrCreateGoogleUser(fakeDeps(query), identity)).resolves.toEqual({
      user,
      created: false,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('creates a password-less account on first sign-in', async () => {
    const query = vi.fn(async (text: string) => (text.startsWith('INSERT') ? [user] : []));
    await expect(findOrCreateGoogleUser(fakeDeps(query), identity)).resolves.toEqual({
      user,
      created: true,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), [
      identity.email,
      'Owner',
      identity.sub,
    ]);
  });

  it('never links an existing password account with the same email', async () => {
    const uniqueViolation = Object.assign(new Error('duplicate key'), {
      name: 'NeonDbError',
      code: '23505',
    });
    const query = vi.fn(async (text: string) => {
      if (text.startsWith('INSERT')) throw uniqueViolation;
      return [];
    });
    const error = await findOrCreateGoogleUser(fakeDeps(query), identity).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleSignInError);
    expect((error as GoogleSignInError).reason).toBe('account_exists');
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE'), expect.anything());
  });
});
