import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Load variables from a local .env file into process.env (without overriding
 * values already set in the real environment).
 *
 * This MUST live here rather than in server.ts: ES module imports are hoisted,
 * so any loader placed at the top of server.ts would run only after this module
 * (and the env parse below) had already been evaluated.
 */
function loadDotEnv(): void {
  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  } catch {
    return; // No .env file — rely on the real environment
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  // Comma-separated list of browser origins allowed to call the API with credentials
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(200).default(50),
  // General per-user API limit (07-SECURITY.md §1.3: 100 requests per minute)
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(100),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // The logger depends on env, so report directly to stderr. Never print values (may be secrets).
    const problems = result.error.errors
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    console.error(
      `Invalid or missing environment configuration:\n${problems}\n` +
        'Set these variables in the environment or in apps/api/.env (see .env.example).',
    );
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();

/** JWT claims shared by token issuance and verification. */
export const JWT_ISSUER = 'lexterrae';
export const JWT_AUDIENCE = 'lexterrae-api';
