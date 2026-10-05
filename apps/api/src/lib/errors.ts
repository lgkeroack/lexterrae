export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly code: string;
  public readonly isOperational: boolean;
  /** Sent as a Retry-After header (seconds) when set, e.g. for rate limiting. */
  public retryAfterSeconds?: number;

  constructor(message: string, isOperational = true) {
    super(message);
    this.name = new.target.name;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly code = 'VALIDATION_ERROR';
  public readonly details?: Record<string, unknown>[];

  constructor(message = 'Validation failed', details?: Record<string, unknown>[]) {
    super(message);
    this.details = details;
  }
}

export class AuthenticationError extends AppError {
  public readonly statusCode = 401;
  public readonly code = 'AUTHENTICATION_ERROR';

  constructor(message = 'Authentication required') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  public readonly statusCode = 403;
  public readonly code = 'FORBIDDEN';

  constructor(message = 'Access denied') {
    super(message);
  }
}

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly code = 'NOT_FOUND';

  constructor(message = 'Resource not found') {
    super(message);
  }
}

export class ConflictError extends AppError {
  public readonly statusCode = 409;
  public readonly code = 'CONFLICT';

  constructor(message = 'Resource conflict') {
    super(message);
  }
}

export class FileSizeError extends AppError {
  public readonly statusCode = 413;
  public readonly code = 'FILE_TOO_LARGE';

  constructor(message = 'File size exceeds the allowed limit') {
    super(message);
  }
}

export class FileTypeError extends AppError {
  public readonly statusCode = 415;
  public readonly code = 'UNSUPPORTED_FILE_TYPE';

  constructor(message = 'File type is not supported') {
    super(message);
  }
}

export class InternalError extends AppError {
  public readonly statusCode = 500;
  public readonly code = 'INTERNAL_ERROR';

  constructor(message = 'Internal server error') {
    super(message, false);
  }
}

export class ExternalServiceError extends AppError {
  public readonly statusCode = 502;
  public readonly code = 'EXTERNAL_SERVICE_ERROR';

  constructor(message = 'External service unavailable') {
    super(message);
  }
}

export class PayloadTooLargeError extends AppError {
  public readonly statusCode = 413;
  public readonly code = 'PAYLOAD_TOO_LARGE';

  constructor(message = 'Request body is too large') {
    super(message);
  }
}

export class ServiceUnavailableError extends AppError {
  public readonly statusCode = 503;
  public readonly code = 'SERVICE_UNAVAILABLE';

  constructor(message = 'Service temporarily unavailable. Please try again shortly.') {
    super(message);
  }
}

export class RateLimitError extends AppError {
  public readonly statusCode = 429;
  public readonly code = 'RATE_LIMIT_EXCEEDED';

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
