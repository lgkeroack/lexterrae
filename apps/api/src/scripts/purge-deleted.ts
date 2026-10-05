/**
 * One-off purge of documents past their soft-delete retention period.
 * The API server also runs this automatically every 6 hours.
 *
 * Usage: pnpm --filter @lexterrae/api purge:deleted
 */
import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { retentionService, SOFT_DELETE_RETENTION_DAYS } from '../services/retention.service.js';

async function main() {
  await redis.connect().catch(() => undefined);
  const result = await retentionService.purgeExpiredDocuments();
  if (result.skipped) {
    console.log('Another purge is already running; nothing to do.');
  } else {
    console.log(
      `Purged ${result.purged} document(s) deleted more than ${SOFT_DELETE_RETENTION_DAYS} days ago` +
        (result.failed ? `; ${result.failed} failed and will be retried.` : '.'),
    );
  }
  process.exitCode = result.failed > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error('Purge failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
