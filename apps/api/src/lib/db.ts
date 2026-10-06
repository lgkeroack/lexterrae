import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { Config } from '../env.js';
import { useLocalNeonProxy } from './neon.js';

/** Neon serverless driver over HTTP: each query is one stateless round trip. */
export type Sql = NeonQueryFunction<false, false>;

export function createSql(config: Config): Sql {
  if (config.NEON_LOCAL_PROXY) useLocalNeonProxy(config.NEON_LOCAL_PROXY);
  return neon(config.DATABASE_URL);
}

/** Error raised by Neon for a failed SQL statement; `code` is the Postgres SQLSTATE. */
export interface NeonDbError extends Error {
  code?: string;
}

export function isNeonDbError(err: unknown): err is NeonDbError {
  return err instanceof Error && err.name === 'NeonDbError';
}

/** Postgres SQLSTATE codes the API handles explicitly. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
/** Class 22 (data exception): out-of-range numbers, invalid characters or text representations. */
export const PG_DATA_EXCEPTION_CLASS = '22';
