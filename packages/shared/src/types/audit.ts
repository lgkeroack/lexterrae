export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'document.upload'
  | 'document.update'
  | 'document.delete'
  | 'document.restore'
  | 'document.purge'
  | 'document.download'
  | 'document.jurisdiction_assign'
  | 'document.jurisdiction_remove'
  | 'user.register'
  | 'user.login'
  | 'user.login_failed'
  | 'user.password_change'
  | 'user.account_delete'
  | 'access.grant'
  | 'access.revoke';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorUserId: string | null;
  actorIpHash: string;
  action: AuditAction;
  resourceType: 'document' | 'user' | 'jurisdiction_assignment';
  resourceId: string;
  /** Free-form JSON; document.update stores { field: { from, to } }. */
  changes: Record<string, unknown> | null;
  requestId: string;
  outcome: 'success' | 'failure';
  failureReason: string | null;
}

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}
