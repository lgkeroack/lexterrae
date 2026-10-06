import { app } from './app.js';
import { getConfig, type Bindings } from './env.js';
import { createSql } from './lib/db.js';
import { createLogger } from './lib/logger.js';
import { runMaintenance } from './services/retention.service.js';

export default {
  fetch: app.fetch,

  /** Cron Trigger (wrangler.jsonc `triggers.crons`): retention purge and cleanup. */
  async scheduled(controller, env, ctx) {
    const config = getConfig(env);
    const requestId = `cron-${controller.cron}-${controller.scheduledTime}`;
    const log = createLogger({ service: 'api', requestId });
    const pending: Promise<unknown>[] = [];
    await runMaintenance(
      {
        sql: createSql(config),
        bucket: env.BUCKET,
        config,
        log,
        requestId,
        clientIp: 'system',
        defer: (p) => pending.push(p),
      },
      new Date(controller.scheduledTime),
    );
    ctx.waitUntil(Promise.allSettled(pending));
  },
} satisfies ExportedHandler<Bindings>;
