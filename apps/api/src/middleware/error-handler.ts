import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { Prisma } from '@prisma/client';
import type { ApiErrorResponse, ApiFieldError } from '@lexterrae/shared';
import { env } from '../config/env.js';
import {
  AppError,
  ConflictError,
  FileSizeError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  ValidationError,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const PROBLEM_BASE = 'https://lexterrae.io/problems';

/** Errors thrown by body-parser (express.json / urlencoded) carry an HTTP status and a type. */
interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

function isBodyParserError(err: Error): err is BodyParserError {
  const candidate = err as BodyParserError;
  return typeof candidate.type === 'string' && typeof (candidate.status ?? candidate.statusCode) === 'number';
}

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

/**
 * Translates library errors (body-parser, multer, Prisma) into AppErrors so they
 * get a correct status code and the standard response shape instead of a 500.
 */
function normalizeError(err: Error): Error {
  if (err instanceof AppError) return err;

  if (isBodyParserError(err)) {
    switch (err.type) {
      case 'entity.parse.failed':
        return new ValidationError('Request body is not valid JSON');
      case 'entity.too.large':
        return new PayloadTooLargeError('Request body is too large');
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return new ValidationError('Unsupported request body encoding');
      default:
        break;
    }
  }

  if (err instanceof MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return new FileSizeError(`File exceeds the maximum allowed size of ${env.MAX_FILE_SIZE_MB} MB`);
      case 'LIMIT_FILE_COUNT':
        return new ValidationError('Only one file can be uploaded at a time');
      case 'LIMIT_UNEXPECTED_FILE':
        return new ValidationError(`Unexpected file field "${err.field ?? ''}". Upload the file in the "file" field`);
      default:
        return new ValidationError(err.message);
    }
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return new ConflictError('A record with this value already exists');
      case 'P2025':
        return new NotFoundError('Resource not found');
      case 'P2003':
        return new ValidationError('A referenced record does not exist');
      default:
        return err;
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new ServiceUnavailableError('The database is currently unavailable. Please try again shortly.');
  }

  return err;
}

export function errorHandler(rawErr: Error, req: Request, res: Response, next: NextFunction): void {
  // If headers were already sent (e.g. mid-stream download), delegate to Express to close the connection
  if (res.headersSent) {
    next(rawErr);
    return;
  }

  const requestId = req.requestId;

  if (rawErr instanceof ZodError) {
    const errors: ApiFieldError[] = rawErr.errors.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    logger.warn({
      module: 'error-handler',
      message: 'Validation error',
      requestId,
      method: req.method,
      path: req.path,
      errors,
    });

    const problem: ApiErrorResponse = {
      type: `${PROBLEM_BASE}/validation-error`,
      title: 'Validation Error',
      status: 400,
      detail: summarizeIssues(errors),
      instance: req.originalUrl,
      code: 'VALIDATION_ERROR',
      requestId,
      errors,
    };

    res.status(400).json(problem);
    return;
  }

  const err = normalizeError(rawErr);

  if (err instanceof AppError) {
    const isServerError = err.statusCode >= 500;

    logger[isServerError ? 'error' : 'warn']({
      module: 'error-handler',
      message: err.message,
      requestId,
      method: req.method,
      path: req.path,
      statusCode: err.statusCode,
      code: err.code,
      cause: err !== rawErr ? { name: rawErr.name, message: rawErr.message } : undefined,
      stack: isServerError ? (err === rawErr ? err.stack : rawErr.stack) : undefined,
    });

    const problem: ApiErrorResponse = {
      type: `${PROBLEM_BASE}/${err.code.toLowerCase().replace(/_/g, '-')}`,
      title: titleFromCode(err.code),
      status: err.statusCode,
      detail: err.message,
      instance: req.originalUrl,
      code: err.code,
      requestId,
    };

    if (err instanceof ValidationError && err.details) {
      problem.errors = err.details as unknown as ApiFieldError[];
    }

    res.status(err.statusCode).json(problem);
    return;
  }

  // Unexpected errors
  logger.error({
    module: 'error-handler',
    message: 'Unhandled error',
    requestId,
    method: req.method,
    path: req.path,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
  });

  const problem: ApiErrorResponse = {
    type: `${PROBLEM_BASE}/internal-error`,
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred. Please try again later.',
    instance: req.originalUrl,
    code: 'INTERNAL_ERROR',
    requestId,
  };

  res.status(500).json(problem);
}

/** Catch-all for unknown routes so clients always receive the standard JSON error shape. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}`));
}
