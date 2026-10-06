import { z } from 'zod';

/** Worker bindings (from wrangler.jsonc, see worker-configuration.d.ts) plus secrets. */
export interface Bindings {
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  API_RATE_LIMITER: RateLimit;
  SEARCH_RATE_LIMITER: RateLimit;
  ENVIRONMENT: string;
  JWT_EXPIRY: string;
  JWT_REFRESH_EXPIRY: string;
  MAX_FILE_SIZE_MB: string;
  /** Secret: Neon pooled connection string (`wrangler secret put DATABASE_URL`, or .dev.vars) */
  DATABASE_URL: string;
  /** Secret: JWT signing key (`wrangler secret put JWT_SECRET`, or .dev.vars) */
  JWT_SECRET: string;
  /** Optional: Google OAuth client ID; "Sign in with Google" is enabled when both are set */
  GOOGLE_CLIENT_ID?: string;
  /** Optional secret: Google OAuth client secret (`wrangler secret put GOOGLE_CLIENT_SECRET`) */
  GOOGLE_CLIENT_SECRET?: string;
  /** Local development only: host:port of the docker-compose Neon proxy */
  NEON_LOCAL_PROXY?: string;
}

const configSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).default('production'),
  DATABASE_URL: z
    .string({ required_error: 'is not set' })
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  NEON_LOCAL_PROXY: z.string().optional(),
  JWT_SECRET: z.string({ required_error: 'is not set' }).min(32, 'must be at least 32 characters'),
  JWT_EXPIRY: z
    .string()
    .regex(/^\d+[smhd]$/, 'must look like 15m')
    .default('15m'),
  JWT_REFRESH_EXPIRY: z
    .string()
    .regex(/^\d+[smhd]$/, 'must look like 7d')
    .default('7d'),
  MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(50),
  GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {}

let cached: { source: Bindings; config: Config } | undefined;

/** Parses and validates configuration from the Worker's bindings (cached per isolate). */
export function getConfig(env: Bindings): Config {
  if (cached?.source === env) return cached.config;
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Never include values: some are secrets
    const problems = result.error.errors
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid Worker configuration: ${problems}`);
  }
  cached = { source: env, config: result.data };
  return result.data;
}

/** Google sign-in is available only when both the client ID and secret are configured. */
export function isGoogleSignInEnabled(
  config: Config,
): config is Config & { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string } {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}

export function isLocalEnvironment(config: Config): boolean {
  return config.ENVIRONMENT === 'development' || config.ENVIRONMENT === 'test';
}

/** JWT claims shared by token issuance and verification. */
export const JWT_ISSUER = 'lexterrae';
export const JWT_AUDIENCE = 'lexterrae-api';
