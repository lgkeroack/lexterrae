/** Backend (document management) access: admins also manage who has access. */
export type BackendRole = 'admin' | 'member';

export const BACKEND_ROLES: readonly BackendRole[] = ['admin', 'member'];

export interface BackendAccess {
  /** null: signed in, but not authorized to use the backend. */
  role: BackendRole | null;
}

export interface AuthorizedUser {
  userId: string;
  email: string;
  displayName: string;
  role: BackendRole;
  grantedAt: string;
  /** Email of the admin who granted access (null for the first admin). */
  grantedBy: string | null;
}

export interface GrantAccessRequest {
  email: string;
  role: BackendRole;
}
