import type { AuthorizedUser, BackendRole } from '@lexterrae/shared';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { Deps } from '../types.js';

const AUTHORIZED_USER_COLUMNS = `
  a.user_id AS "userId", u.email, u.display_name AS "displayName", a.role,
  a.granted_at AS "grantedAt", g.email AS "grantedBy"`;

/**
 * The user's backend role, or null when they are not authorized. While there is no admin at
 * all, the BOOTSTRAP_ADMIN_EMAIL account becomes admin on its first request, so the app can
 * never be left without someone able to manage access.
 */
export async function getBackendRole(deps: Deps, userId: string): Promise<BackendRole | null> {
  const rows = await deps.sql.query(
    `SELECT u.email, a.role,
            EXISTS (SELECT 1 FROM backend_access WHERE role = 'admin') AS "hasAdmin"
       FROM users u LEFT JOIN backend_access a ON a.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0] as { email: string; role: BackendRole | null; hasAdmin: boolean } | undefined;
  if (!row) return null;
  if (row.role) return row.role;

  const bootstrap = deps.config.BOOTSTRAP_ADMIN_EMAIL;
  if (!row.hasAdmin && bootstrap && row.email.toLowerCase() === bootstrap) {
    await deps.sql.query(
      `INSERT INTO backend_access (user_id, role) VALUES ($1, 'admin')
       ON CONFLICT (user_id) DO UPDATE SET role = 'admin'`,
      [userId],
    );
    deps.log.info({ module: 'access', message: 'Granted bootstrap admin access', userId });
    return 'admin';
  }
  return null;
}

export async function listAuthorizedUsers(deps: Deps): Promise<AuthorizedUser[]> {
  const rows = await deps.sql.query(
    `SELECT ${AUTHORIZED_USER_COLUMNS}
       FROM backend_access a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users g ON g.id = a.granted_by
      ORDER BY a.role, lower(u.email)`,
  );
  return rows as unknown as AuthorizedUser[];
}

/**
 * Authorizes the account with this email (or changes its role). The person must have an account
 * already: access is tied to the account, not to an email someone could register later.
 */
export async function grantAccess(
  deps: Deps,
  actorId: string,
  email: string,
  role: BackendRole,
): Promise<AuthorizedUser> {
  const users = await deps.sql.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
    email,
  ]);
  const userId = (users[0] as { id: string } | undefined)?.id;
  if (!userId) {
    throw new NotFoundError(
      `No account uses ${email}. Ask them to create an account first, then add them here.`,
    );
  }
  if (userId === actorId) {
    throw new ValidationError("You can't change your own access. Ask another admin.");
  }

  await deps.sql.query(
    `INSERT INTO backend_access (user_id, role, granted_by) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = now()`,
    [userId, role, actorId],
  );
  const rows = await deps.sql.query(
    `SELECT ${AUTHORIZED_USER_COLUMNS}
       FROM backend_access a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users g ON g.id = a.granted_by
      WHERE a.user_id = $1`,
    [userId],
  );
  return rows[0] as unknown as AuthorizedUser;
}

/** Removes a user's backend access. Admins can't remove themselves, so one admin always remains. */
export async function revokeAccess(deps: Deps, actorId: string, userId: string): Promise<string> {
  if (userId === actorId) {
    throw new ValidationError("You can't remove your own access. Ask another admin.");
  }
  const rows = await deps.sql.query(
    `DELETE FROM backend_access a USING users u
      WHERE a.user_id = $1 AND u.id = a.user_id
      RETURNING u.email`,
    [userId],
  );
  const removed = rows[0] as { email: string } | undefined;
  if (!removed) throw new NotFoundError('That user does not have backend access.');
  return removed.email;
}
