import { randomUUID } from 'node:crypto';
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { createModuleLogger } from '../lib/logger.js';
import { auditService } from './audit.service.js';
import { fileService } from './file.service.js';

const logger = createModuleLogger('retention.service');

/** Soft-deleted documents are recoverable for this long, then purged (07-SECURITY.md §4.3). */
export const SOFT_DELETE_RETENTION_DAYS = 30;

const LOCK_KEY = 'retention:purge-lock';
const LOCK_TTL_SECONDS = 15 * 60;
const BATCH_SIZE = 100;

export interface PurgeResult {
  purged: number;
  failed: number;
  /** True when another instance held the lock and this run did nothing */
  skipped: boolean;
}

export class RetentionService {
  /**
   * Permanently deletes documents soft-deleted more than the retention period ago:
   * the stored file first, then the database row (jurisdiction links cascade).
   *
   * A file that cannot be removed from storage keeps its row, so the next run retries it
   * and no object is ever orphaned. A Redis lock stops multiple API instances purging at
   * once; if Redis is unavailable the purge still runs (deletes are idempotent).
   */
  async purgeExpiredDocuments(now: Date = new Date()): Promise<PurgeResult> {
    const lockToken = randomUUID();
    let lockHeld = false;
    try {
      lockHeld = (await redis.set(LOCK_KEY, lockToken, 'EX', LOCK_TTL_SECONDS, 'NX')) === 'OK';
      if (!lockHeld) return { purged: 0, failed: 0, skipped: true };
    } catch {
      logger.warn({ message: 'Redis unavailable; running purge without a lock' });
    }

    const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const requestId = `retention-${lockToken}`;
    let purged = 0;
    let failed = 0;
    const failedIds: string[] = [];

    try {
      for (;;) {
        const batch = await prisma.document.findMany({
          where: { deletedAt: { lt: cutoff }, id: { notIn: failedIds } },
          select: { id: true, userId: true, fileKey: true },
          orderBy: { deletedAt: 'asc' },
          take: BATCH_SIZE,
        });
        if (batch.length === 0) break;

        for (const doc of batch) {
          try {
            await fileService.deleteFromS3(doc.fileKey);
            await prisma.document.delete({ where: { id: doc.id } });
            purged++;
            await auditService.logAction({
              actorUserId: doc.userId,
              actorIp: 'system',
              action: 'document.purge',
              resourceType: 'document',
              resourceId: doc.id,
              requestId,
              outcome: 'success',
            });
          } catch (err) {
            failed++;
            failedIds.push(doc.id);
            logger.error({
              message: 'Failed to purge soft-deleted document; will retry on next run',
              documentId: doc.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } finally {
      if (lockHeld) {
        // Release only our own lock
        const current = await redis.get(LOCK_KEY).catch(() => null);
        if (current === lockToken) await redis.del(LOCK_KEY).catch(() => undefined);
      }
    }

    if (purged > 0 || failed > 0) {
      logger.info({ message: 'Purged expired soft-deleted documents', purged, failed });
    }
    return { purged, failed, skipped: false };
  }
}

export const retentionService = new RetentionService();
