import { describe, expect, it, vi } from 'vitest';
import type { Deps } from '../types.js';
import { getBackendRole, grantAccess, revokeAccess } from './access.service.js';

/** Fake Neon client answering each query from `answer`, recording what was sent. */
function fakeDeps(answer: (text: string, params: unknown[]) => unknown[], bootstrap?: string) {
  const query = vi.fn(async (text: string, params: unknown[] = []) => answer(text, params));
  const deps = {
    sql: { query },
    config: { BOOTSTRAP_ADMIN_EMAIL: bootstrap },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Deps;
  return { deps, query };
}

describe('getBackendRole', () => {
  it("returns the user's role, or null when they have none", async () => {
    const member = fakeDeps(() => [{ email: 'a@x.ca', role: 'member', hasAdmin: true }]);
    await expect(getBackendRole(member.deps, 'u1')).resolves.toBe('member');
    const none = fakeDeps(() => [{ email: 'a@x.ca', role: null, hasAdmin: true }]);
    await expect(getBackendRole(none.deps, 'u1')).resolves.toBeNull();
  });

  it('makes the bootstrap email admin only while there is no admin', async () => {
    const first = fakeDeps(
      (text) =>
        text.startsWith('SELECT') ? [{ email: 'Boss@X.ca', role: null, hasAdmin: false }] : [],
      'boss@x.ca',
    );
    await expect(getBackendRole(first.deps, 'u1')).resolves.toBe('admin');
    expect(first.query).toHaveBeenLastCalledWith(expect.stringMatching(/^INSERT/), ['u1']);

    const later = fakeDeps(() => [{ email: 'boss@x.ca', role: null, hasAdmin: true }], 'boss@x.ca');
    await expect(getBackendRole(later.deps, 'u1')).resolves.toBeNull();

    const other = fakeDeps(
      () => [{ email: 'else@x.ca', role: null, hasAdmin: false }],
      'boss@x.ca',
    );
    await expect(getBackendRole(other.deps, 'u1')).resolves.toBeNull();
  });
});

describe('grantAccess / revokeAccess', () => {
  it('requires an existing account and refuses changes to your own access', async () => {
    const noAccount = fakeDeps(() => []);
    await expect(grantAccess(noAccount.deps, 'admin', 'new@x.ca', 'member')).rejects.toThrow(
      /No account uses new@x.ca/,
    );
    const self = fakeDeps(() => [{ id: 'admin' }]);
    await expect(grantAccess(self.deps, 'admin', 'me@x.ca', 'member')).rejects.toThrow(
      /your own access/,
    );
    await expect(revokeAccess(self.deps, 'admin', 'admin')).rejects.toThrow(/your own access/);
  });

  it('grants access to another account', async () => {
    const row = { userId: 'u2', email: 'b@x.ca', role: 'admin' };
    const { deps, query } = fakeDeps((text) =>
      text.includes('WHERE lower(email)') ? [{ id: 'u2' }] : text.startsWith('SELECT') ? [row] : [],
    );
    await expect(grantAccess(deps, 'admin', 'b@x.ca', 'admin')).resolves.toEqual(row);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/^INSERT/), ['u2', 'admin', 'admin']);
  });

  it('reports a user who had no access', async () => {
    const { deps } = fakeDeps(() => []);
    await expect(revokeAccess(deps, 'admin', 'u2')).rejects.toThrow(/does not have backend access/);
  });
});
