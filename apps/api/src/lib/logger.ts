import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  base: { service: 'api' },
  // SECURITY: Defence in depth — never emit credentials or tokens even if an object containing them is logged
  redact: {
    paths: [
      'password',
      'passwordHash',
      'accessToken',
      'refreshToken',
      'token',
      '*.password',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.token',
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});

export function createModuleLogger(module: string) {
  return logger.child({ module });
}
