import type { AuditAction } from '@lexterrae/shared';
import type { Deps } from '../types.js';

export interface AuditEntry {
  actorUserId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, unknown>;
  outcome: 'success' | 'failure';
  failureReason?: string;
  /** Defaults to the request's client IP; "system" for scheduled jobs. */
  actorIp?: string;
}

/**
 * Keyed hash of the client IP (HMAC-SHA256 with JWT_SECRET) so raw IPs are never stored,
 * and the small IPv4 space cannot be reversed with a lookup table.
 */
async function hashIp(secret: string, ip: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Writes an audit log entry. Never throws: audit failures are logged but must not break
 * the action being audited.
 */
export async function writeAudit(deps: Deps, entry: AuditEntry): Promise<void> {
  try {
    const ipHash = await hashIp(deps.config.JWT_SECRET, entry.actorIp ?? deps.clientIp);
    await deps.sql`
      INSERT INTO audit_logs
        (actor_user_id, actor_ip_hash, action, resource_type, resource_id, changes,
         request_id, outcome, failure_reason)
      VALUES
        (${entry.actorUserId ?? null}, ${ipHash}, ${entry.action}, ${entry.resourceType},
         ${entry.resourceId}, ${entry.changes ? JSON.stringify(entry.changes) : null}::jsonb,
         ${deps.requestId}, ${entry.outcome}, ${entry.failureReason ?? null})`;
  } catch (err) {
    deps.log.error({
      module: 'audit',
      message: 'Failed to write audit log entry',
      action: entry.action,
      resourceId: entry.resourceId,
      error: err,
    });
  }
}

/** Records an audit entry after the response is sent. */
export function audit(deps: Deps, entry: AuditEntry): void {
  deps.defer(writeAudit(deps, entry));
}
