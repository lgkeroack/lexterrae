/**
 * Structured JSON logger for Workers Logs. Each call writes one JSON line via console.
 * SECURITY: credential-like keys are redacted at any depth.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'accesstoken',
  'refreshtoken',
  'token',
  'authorization',
  'cookie',
  'jwt_secret',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(fields: Record<string, unknown>): void;
  info(fields: Record<string, unknown>): void;
  warn(fields: Record<string, unknown>): void;
  error(fields: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(base: Record<string, unknown> = {}, minLevel: Level = 'info'): Logger {
  const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const write = (level: Level, fields: Record<string, unknown>) => {
    if (order[level] < order[minLevel]) return;
    const line = JSON.stringify(
      redact({ level, time: new Date().toISOString(), ...base, ...fields }),
    );
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return {
    debug: (f) => write('debug', f),
    info: (f) => write('info', f),
    warn: (f) => write('warn', f),
    error: (f) => write('error', f),
    child: (f) => createLogger({ ...base, ...f }, minLevel),
  };
}

export const rootLogger = createLogger({ service: 'api' });
