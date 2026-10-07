import type { BackendRole } from '@lexterrae/shared';
import type { Bindings, Config } from './env.js';
import type { Sql } from './lib/db.js';
import type { Logger } from './lib/logger.js';

/** Per-request dependencies handed to services. */
export interface Deps {
  sql: Sql;
  bucket: R2Bucket;
  config: Config;
  log: Logger;
  requestId: string;
  /** Client IP from Cloudflare (CF-Connecting-IP). */
  clientIp: string;
  /** Keep background work (audit logging) alive after the response is sent. */
  defer(promise: Promise<unknown>): void;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    requestId: string;
    deps: Deps;
    /** Set by the authenticate middleware. */
    userId: string;
    /** Set by the requireBackendAccess / requireAdmin middleware. */
    backendRole: BackendRole;
  };
}
