import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';
import type { ApiErrorResponse, ApiFieldError } from '@lexterrae/shared';
import { ConfigError } from '../env.js';
import { isNeonDbError, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../lib/db.js';
import {
  AppError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  ValidationError,
} from '../lib/errors.js';
import { rootLogger } from '../lib/logger.js';
import type { AppEnv } from '../types.js';

const PROBLEM_BASE = 'https://lexterrae.io/problems';

function titleFromCode(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Builds a human-readable summary of validation issues the UI can show directly. */
function summarizeIssues(issues: ApiFieldError[]): string {
  const messages = [...new Set(issues.map((i) => i.message))];
  if (messages.length === 0) return 'Request validation failed';
  return messages.join('. ').replace(/\.\./g, '.');
}

/** Translates library errors (Neon, Hono, network) into AppErrors with a proper status code. */
function normalizeError(err: Error): Error {
  if (err instanceof AppError) return err;

  if (err instanceof HTTPException && err.status === 413) {
    return new PayloadTooLargeError('Request body is too large');
  }

  if (isNeonDbError(err)) {
    if (err.code === PG_UNIQUE_VIOLATION)
      return new ConflictError('A record with this value already exists');
    if (err.code === PG_FOREIGN_KEY_VIOLATION)
      return new ValidationError('A referenced record does not exist');
    if (!err.code) {
      // No SQLSTATE: the database could not be reached (network / Neon compute unavailable)
      return new ServiceUnavailableError(
        'The database is currently unavailable. Please try again shortly.',
      );
    }
  }

  return err;
}

function problemResponse(c: Context<AppEnv>, problem: ApiErrorResponse) {
  return c.json(problem, problem.status as ContentfulStatusCode);
}

export const errorHandler: ErrorHandler<AppEnv> = (rawErr, c) => {
  const requestId = c.get('requestId');
  const log = c.get('deps')?.log ?? rootLogger.child({ requestId });
  const instance = new URL(c.req.url).pathname + new URL(c.req.url).search;

  if (rawErr instanceof ZodError) {
    const errors: ApiFieldError[] = rawErr.errors.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    log.warn({ module: 'error-handler', message: 'Validation error', path: c.req.path, errors });
    return problemResponse(c, {
      type: `${PROBLEM_BASE}/validation-error`,
      title: 'Validation Error',
      status: 400,
      detail: summarizeIssues(errors),
      instance,
      code: 'VALIDATION_ERROR',
      requestId,
      errors,
    });
  }

  if (rawErr instanceof ConfigError) {
    log.error({ module: 'error-handler', message: rawErr.message });
    return problemResponse(c, {
      type: `${PROBLEM_BASE}/service-unavailable`,
      title: 'Service Unavailable',
      status: 503,
      detail: 'The service is not configured correctly. Please try again later.',
      instance,
      code: 'SERVICE_UNAVAILABLE',
      requestId,
    });
  }

  const err = normalizeError(rawErr);

  if (err instanceof AppError) {
    const isServerError = err.statusCode >= 500;
    log[isServerError ? 'error' : 'warn']({
      module: 'error-handler',
      message: err.message,
      method: c.req.method,
      path: c.req.path,
      statusCode: err.statusCode,
      code: err.code,
      cause: err !== rawErr ? { name: rawErr.name, message: rawErr.message } : undefined,
      stack: isServerError ? rawErr.stack : undefined,
    });
    const problem: ApiErrorResponse = {
      type: `${PROBLEM_BASE}/${err.code.toLowerCase().replace(/_/g, '-')}`,
      title: titleFromCode(err.code),
      status: err.statusCode,
      detail: err.message,
      instance,
      code: err.code,
      requestId,
    };
    if (err instanceof ValidationError && err.details) {
      problem.errors = err.details as unknown as ApiFieldError[];
    }
    if (err.retryAfterSeconds !== undefined) c.header('Retry-After', String(err.retryAfterSeconds));
    return problemResponse(c, problem);
  }

  log.error({
    module: 'error-handler',
    message: 'Unhandled error',
    method: c.req.method,
    path: c.req.path,
    error: { name: err.name, message: err.message, stack: err.stack },
  });
  return problemResponse(c, {
    type: `${PROBLEM_BASE}/internal-error`,
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred. Please try again later.',
    instance,
    code: 'INTERNAL_ERROR',
    requestId,
  });
};

/** Unknown API routes get the standard JSON error shape. */
export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  errorHandler(new NotFoundError(`No route matches ${c.req.method} ${c.req.path}`), c);
