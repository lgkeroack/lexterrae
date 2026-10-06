/** A single field-level validation problem. `path` is prefixed with the request part, e.g. "body.email". */
export interface ApiFieldError {
  path: string;
  message: string;
  code: string;
}

/**
 * RFC 7807 problem details returned by the API for every error response.
 * `detail` is always a human-readable message suitable for display in the UI.
 */
export interface ApiErrorResponse {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  /** Stable machine-readable error code, e.g. "VALIDATION_ERROR", "AUTHENTICATION_ERROR". */
  code?: string;
  /** Correlates with server logs (also sent as the X-Request-Id response header). */
  requestId?: string;
  /** Present for validation errors. */
  errors?: ApiFieldError[];
  extensions?: Record<string, unknown>;
}

export interface ServiceHealth {
  status: 'healthy' | 'unhealthy';
  latencyMs?: number;
  /** Only included outside production. */
  error?: string;
}

export interface HealthCheckResponse {
  /** "unhealthy" (HTTP 503) when the database is down; "degraded" (HTTP 200) when file storage is down. */
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  environment: string;
  timestamp: string;
  checks: {
    /** Neon Postgres */
    database: ServiceHealth;
    /** Cloudflare R2 */
    storage: ServiceHealth;
  };
}
