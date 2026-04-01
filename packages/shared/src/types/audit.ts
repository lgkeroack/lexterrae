export type AuditAction =
  | 'document.upload'
  | 'document.update'
  | 'document.delete'
  | 'document.download'
  | 'document.jurisdiction_assign'
  | 'document.jurisdiction_remove'
  | 'user.google_login'
  | 'user.login_failed'
  | 'user.account_delete';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorUserId: string | null;
  actorIpHash: string;
  action: AuditAction;
  resourceType: 'document' | 'user' | 'jurisdiction_assignment';
  resourceId: string;
  changes: AuditChange[] | null;
  requestId: string;
  outcome: 'success' | 'failure';
  failureReason: string | null;
}

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}
