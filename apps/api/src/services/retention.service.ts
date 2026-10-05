import { SOFT_DELETE_RETENTION_DAYS } from '@lexterrae/shared';
import type { Deps } from '../types.js';
import { writeAudit } from './audit.service.js';
import { deleteFile } from './file.service.js';

const BATCH_SIZE = 100;

export interface MaintenanceResult {
  purged: number;
  failed: number;
  expiredTokensRemoved: number;
  rateLimitBucketsRemoved: number;
}

/**
 * Scheduled maintenance (Cron Trigger):
 * - permanently deletes documents soft-deleted more than the retention period ago — the R2
 *   object first, then the row, so no object is ever orphaned; failures are retried next run;
 * - removes expired revoked refresh tokens and stale rate-limit counters.
 */
export async function runMaintenance(deps: Deps, now = new Date()): Promise<MaintenanceResult> {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let purged = 0;
  let failed = 0;
  const failedIds: string[] = [];

  for (;;) {
    const batch = (await deps.sql`
      SELECT id, user_id AS "userId", file_key AS "fileKey" FROM documents
      WHERE deleted_at < ${cutoff} AND NOT (id = ANY(${failedIds}::uuid[]))
      ORDER BY deleted_at LIMIT ${BATCH_SIZE}`) as {
      id: string;
      userId: string;
      fileKey: string;
    }[];
    if (batch.length === 0) break;

    for (const doc of batch) {
      try {
        await deleteFile(deps, doc.fileKey);
        await deps.sql`DELETE FROM documents WHERE id = ${doc.id}`;
        purged++;
        await writeAudit(deps, {
          actorUserId: doc.userId,
          actorIp: 'system',
          action: 'document.purge',
          resourceType: 'document',
          resourceId: doc.id,
          outcome: 'success',
        });
      } catch (err) {
        failed++;
        failedIds.push(doc.id);
        deps.log.error({
          module: 'retention',
          message: 'Failed to purge document; will retry next run',
          documentId: doc.id,
          error: err,
        });
      }
    }
  }

  const tokens = await deps.sql`DELETE FROM revoked_tokens WHERE expires_at < ${now} RETURNING jti`;
  const buckets = await deps.sql`
    DELETE FROM rate_limit_buckets WHERE window_start < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
    RETURNING key`;

  const result = {
    purged,
    failed,
    expiredTokensRemoved: tokens.length,
    rateLimitBucketsRemoved: buckets.length,
  };
  deps.log.info({ module: 'retention', message: 'Scheduled maintenance complete', ...result });
  return result;
}
