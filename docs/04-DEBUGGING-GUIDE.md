# Lex Terrae — Debugging Guide & Logging Standards

## Structured Logging

### Log Format

All application logs use structured JSON (one line per entry, collected by Workers Logs) via `apps/api/src/lib/logger.ts` (backend) and a custom logger (frontend).

```typescript
// Backend log entry structure
interface LogEntry {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  timestamp: string; // ISO 8601
  requestId: string; // Correlation ID from X-Request-Id header
  service: string; // 'api' | 'file-processor' | 'scheduler'
  module: string; // e.g., 'upload.service', 'auth.controller'
  message: string; // Human-readable description
  data?: Record<string, unknown>; // Structured context
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string; // Application error code (e.g., 'FILE_TOO_LARGE')
  };
  duration_ms?: number; // For timed operations
  userId?: string; // Authenticated user (never log email/PII in prod)
}
```

### Log Levels by Environment

| Level | Development | Staging | Production |
| ----- | ----------- | ------- | ---------- |
| trace | ✅          | ❌      | ❌         |
| debug | ✅          | ✅      | ❌         |
| info  | ✅          | ✅      | ✅         |
| warn  | ✅          | ✅      | ✅         |
| error | ✅          | ✅      | ✅         |
| fatal | ✅          | ✅      | ✅         |

### What to Log

**Always log (info+):**

- Application startup and shutdown
- Incoming HTTP requests (method, path, status, duration — not body)
- Authentication events (login success/failure, token refresh, logout)
- File upload start, completion, and failure (filename, size, type — not content)
- Jurisdiction assignment changes
- Database migration events
- External service calls (R2 put/get, database errors)

**Log at debug level:**

- SQL queries with parameter placeholders (never log actual parameter values in production)
- Request/response bodies in development only
- Cache operations
- File processing pipeline steps

**Never log:**

- Passwords, tokens, API keys, or secrets
- Full file contents or extracted text
- User email addresses in production (use userId only)
- Credit card or payment information (N/A for MVP, but enforce the habit)
- Stack traces in API responses (log server-side, return generic error to client)

---

## Error Handling Strategy

### Error Classification

```typescript
// Application error hierarchy
abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  abstract readonly isOperational: boolean; // true = expected, false = bug
}

class ValidationError extends AppError {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  isOperational = true;
}

class AuthenticationError extends AppError {
  statusCode = 401;
  code = 'AUTHENTICATION_REQUIRED';
  isOperational = true;
}

class ForbiddenError extends AppError {
  statusCode = 403;
  code = 'FORBIDDEN';
  isOperational = true;
}

class NotFoundError extends AppError {
  statusCode = 404;
  code = 'NOT_FOUND';
  isOperational = true;
}

class FileTypeError extends AppError {
  statusCode = 415;
  code = 'UNSUPPORTED_FILE_TYPE';
  isOperational = true;
}

class FileSizeError extends AppError {
  statusCode = 413;
  code = 'FILE_TOO_LARGE';
  isOperational = true;
}

class ExternalServiceError extends AppError {
  statusCode = 502;
  code = 'EXTERNAL_SERVICE_FAILURE';
  isOperational = true;
}

class InternalError extends AppError {
  statusCode = 500;
  code = 'INTERNAL_ERROR';
  isOperational = false; // This indicates a bug — triggers alerts
}
```

### API Error Response Format (RFC 7807)

```json
{
  "type": "https://lexterrae.io/problems/file-too-large",
  "title": "File Too Large",
  "status": 413,
  "detail": "The uploaded file exceeds the maximum allowed size of 50 MB.",
  "instance": "/api/documents",
  "extensions": {
    "maxSizeBytes": 52428800,
    "actualSizeBytes": 78643200,
    "requestId": "req_abc123"
  }
}
```

### Global Error Handler

```typescript
// Error handler middleware pattern
function globalErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string;

  if (err instanceof AppError) {
    logger.warn({
      requestId,
      module: 'error-handler',
      message: err.message,
      error: { name: err.name, code: err.code, message: err.message },
    });

    return res.status(err.statusCode).json({
      type: `https://lexterrae.io/problems/${err.code.toLowerCase().replace(/_/g, '-')}`,
      title: err.name,
      status: err.statusCode,
      detail: err.message,
      instance: req.originalUrl,
      extensions: { requestId },
    });
  }

  // Unexpected error — this is a bug
  logger.error({
    requestId,
    module: 'error-handler',
    message: 'Unhandled error',
    error: { name: err.name, message: err.message, stack: err.stack },
  });

  return res.status(500).json({
    type: 'https://lexterrae.io/problems/internal-error',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred. Please try again later.',
    instance: req.originalUrl,
    extensions: { requestId },
  });
}
```

---

## Debugging Strategies by Domain

### Upload Failures

**Symptoms:** Upload hangs, returns 500, or file is missing after "success."

**Debug checklist:**

1. Check browser Network tab — did the request complete? Check status code and response body.
2. Check API logs for the requestId — look for file validation, R2 upload, and DB insert steps.
3. Verify storage: `curl https://<your-domain>/api/health` (the `storage` check). To check one upload, take `file_key` from its `documents` row and run `npx wrangler r2 object get lexterrae-uploads/<file_key> --file /tmp/check --remote` (`--local` under `wrangler dev`), or browse the bucket in the Cloudflare dashboard (R2 → lexterrae-uploads → Objects)
4. Check file size and type against limits in config.
5. For partial uploads, check if the DB record was created without the R2 object (indicates rollback failure).
6. Test with `curl` to isolate frontend vs. backend: `curl -X POST -F "file=@test.pdf" http://localhost:8787/api/documents`

### Map Rendering Issues

**Symptoms:** Map doesn't render, provinces missing, click events don't fire.

**Debug checklist:**

1. Open browser DevTools → Console. Check for D3.js or TopoJSON parsing errors.
2. Verify TopoJSON file loads: Network tab → check `canada-topo.json` response.
3. Check SVG element in DOM inspector — are `<path>` elements present?
4. Test click handlers in isolation: add `console.debug` to the D3 event handler.
5. For rendering glitches, compare viewport dimensions against the D3 projection configuration.
6. Check for z-index conflicts if map is behind other elements.

### Jurisdiction Data Mismatches

**Symptoms:** Selected jurisdiction doesn't match what's stored, or documents appear in wrong jurisdiction filters.

**Debug checklist:**

1. Log the jurisdiction IDs at each stage: map click → state store → API request body → DB insert.
2. Query the `jurisdictions` table: `SELECT * FROM jurisdictions WHERE code = 'BC';`
3. Check `document_jurisdictions` join table for the document in question.
4. Verify parent-child relationships: `SELECT * FROM jurisdictions WHERE parent_id = (SELECT id FROM jurisdictions WHERE code = 'BC');`
5. Test the filter API endpoint directly with known jurisdiction IDs.

### Authentication Issues

**Symptoms:** User logged out unexpectedly, 401 errors on valid sessions.

**Debug checklist:**

1. Decode the JWT at jwt.io (development only) — check `exp` claim.
2. Verify the JWT secret matches between token generation and verification.
3. Check `revoked_tokens` for the refresh token's `jti` (a refresh token can be used only once).
4. Look at the Authorization header format: must be `Bearer <token>` with exactly one space.
5. Check clock skew between client and server (JWT expiry is time-sensitive).

---

## Local Development Debugging Tools

### Backend

- **Worker debugger:** `wrangler dev` → press `d` to open DevTools for the Worker
- **Logs:** `wrangler dev` prints the JSON request logs; in production use `npx wrangler tail` or Workers Logs in the dashboard
- **Database:** `psql postgresql://postgres:postgres@localhost:5432/lexterrae` locally; the Neon console SQL editor in production
- **Cron:** `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=17+*/6+*+*+*"` runs the scheduled maintenance locally

### Frontend

- **React DevTools:** Component tree, state inspection, profiler
- **Zustand DevTools:** Install `zustand/middleware` devtools for state timeline
- **D3 debugging:** Assign SVG selections to `window.__debug_map` for console inspection
- **Network throttling:** Chrome DevTools → Network → Slow 3G to test upload behavior under poor connectivity

### Integration

- **Docker logs:** `docker compose logs -f neon-proxy` if the API cannot reach the local database
- **Local R2:** objects stored by `wrangler dev` live in `apps/api/.wrangler/state`
- **pgAdmin or psql:** Direct database access for ad-hoc queries

---

## Health Check & Diagnostics

### Health Endpoint

```
GET /api/health

Response:
{
  "status": "healthy",
  "version": "1.2.0",
  "uptime_seconds": 86400,
  "checks": {
    "database": { "status": "up", "latency_ms": 3 },
    "storage": { "status": "up", "latency_ms": 45 },
    "cache": { "status": "up", "latency_ms": 1 }
  }
}
```

### Diagnostic Endpoint (Authenticated, Admin Only)

```
GET /api/diagnostics

Response:
{
  "memory": { "rss_mb": 128, "heap_used_mb": 64, "heap_total_mb": 96 },
  "event_loop_lag_ms": 2,
  "active_connections": { "database": 5, "cache": 2 },
  "document_stats": { "total": 1250, "by_type": { "pdf": 980, "txt": 270 } },
  "jurisdiction_stats": { "federal": 45, "provincial": 890, "municipal": 315 }
}
```

---

## Incident Response Playbook

### Severity Levels

| Severity | Definition                   | Response Time     | Example                                      |
| -------- | ---------------------------- | ----------------- | -------------------------------------------- |
| P0       | Service down, data loss risk | < 15 min          | Database unreachable, R2 bucket deleted      |
| P1       | Major feature broken         | < 1 hour          | All uploads failing, auth completely broken  |
| P2       | Feature degraded             | < 4 hours         | Slow uploads, map rendering broken on mobile |
| P3       | Minor issue                  | Next business day | Typo in UI, non-critical log noise           |

### P0/P1 Response Steps

1. Acknowledge the incident and start a shared document/channel.
2. Check health endpoint: `curl https://lexterrae.io/api/health`
3. Check infrastructure: Neon status and the `/api/health` checks (database, storage); Cloudflare status.
4. Check recent deployments — was anything pushed in the last 2 hours? If so, consider rollback.
5. Check application logs for the error spike: filter by `level: error` and look for patterns.
6. Identify the root cause, apply a fix or rollback, verify recovery.
7. Write a post-mortem within 48 hours.
