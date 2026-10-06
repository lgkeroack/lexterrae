# Lex Terrae — Audit-Ready Code Standards

This document defines the standards for producing code that is ready for professional security audit, compliance review, and third-party assessment.

---

## Audit Trail & Accountability

### Every State Change is Recorded

All mutations to documents, jurisdictions, and user accounts produce an immutable audit log entry.

```typescript
// Audit log entry structure
interface AuditLogEntry {
  id: string; // UUID v7 (time-sortable)
  timestamp: string; // ISO 8601, UTC
  actor: {
    userId: string;
    ip: string; // Hashed in production
    userAgent: string;
  };
  action: AuditAction;
  resource: {
    type: 'document' | 'user' | 'jurisdiction_assignment';
    id: string;
  };
  changes?: {
    field: string;
    before: unknown;
    after: unknown;
  }[];
  requestId: string;
  outcome: 'success' | 'failure';
  failureReason?: string;
}

type AuditAction =
  | 'document.upload'
  | 'document.update'
  | 'document.delete'
  | 'document.download'
  | 'document.jurisdiction_assign'
  | 'document.jurisdiction_remove'
  | 'user.register'
  | 'user.login'
  | 'user.login_failed'
  | 'user.password_change'
  | 'user.account_delete';
```

### Audit Log Storage

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID REFERENCES users(id),
  actor_ip_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  changes JSONB,
  request_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  failure_reason TEXT
);

-- Append-only: no UPDATE or DELETE permissions granted to the application role
-- Only INSERT and SELECT
REVOKE UPDATE, DELETE ON audit_logs FROM app_role;

-- Time-based partitioning for performance
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id, timestamp DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id, timestamp DESC);
CREATE INDEX idx_audit_action ON audit_logs(action, timestamp DESC);
```

### Audit Log Integration Pattern

```typescript
// Every service method that mutates state follows this pattern
class DocumentService {
  async uploadDocument(
    userId: string,
    file: UploadedFile,
    metadata: DocumentMetadata,
    jurisdictionIds: string[],
    context: RequestContext,        // Contains requestId, IP, userAgent
  ): Promise<Document> {
    const document = await this.db.transaction(async (tx) => {
      // 1. Perform the operation
      const doc = await tx.document.create({ ... });
      await tx.documentJurisdiction.createMany({ ... });

      // 2. Record the audit entry within the same transaction
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorIpHash: hashIP(context.ip),
          action: 'document.upload',
          resourceType: 'document',
          resourceId: doc.id,
          changes: [
            { field: 'title', before: null, after: metadata.title },
            { field: 'jurisdictions', before: null, after: jurisdictionIds },
          ],
          requestId: context.requestId,
          outcome: 'success',
        },
      });

      return doc;
    });

    return document;
  }
}
```

---

## Code Documentation Standards

### File Headers

Every source file includes a header comment:

```typescript
/**
 * @module upload.service
 * @description Handles file upload processing, validation, and storage.
 *              Supports PDF and TXT files up to 50 MB.
 *
 * @security File type validation uses both MIME type and magic byte checking.
 *           Files are stored in R2 after magic-byte validation.
 *           See 07-SECURITY.md §2.1 for full file upload threat model.
 *
 * @audit All upload operations are recorded in the audit log.
 */
```

### Function Documentation

Public/exported functions include JSDoc with security and audit annotations:

```typescript
/**
 * Uploads a document and assigns it to the specified jurisdictions.
 *
 * @param userId - The authenticated user's ID (from JWT claims)
 * @param file - The uploaded file stream with metadata
 * @param jurisdictionIds - Array of jurisdiction UUIDs to assign
 * @param context - Request context for audit logging
 *
 * @returns The created document record with assigned jurisdictions
 *
 * @throws {FileTypeError} If the file is not PDF or TXT
 * @throws {FileSizeError} If the file exceeds 50 MB
 * @throws {ValidationError} If jurisdictionIds is empty or contains invalid IDs
 * @throws {ExternalServiceError} If R2 storage fails (nothing is written to the database)
 *
 * @security File content is not trusted. Magic bytes are checked server-side.
 *           Filename is sanitized before storage. Content-Type is overridden
 *           based on server-side detection, not client-provided header.
 *
 * @audit Produces audit_logs entry with action 'document.upload'
 */
async function uploadDocument(
  userId: string,
  file: UploadedFile,
  jurisdictionIds: string[],
  context: RequestContext,
): Promise<DocumentWithJurisdictions> {
  // ...
}
```

### Inline Security Comments

Any code that handles security-sensitive operations includes inline comments explaining the reasoning:

```typescript
// SECURITY: Validate file type using magic bytes, not the client-provided
// Content-Type header, which can be spoofed. See OWASP File Upload guidelines.
const detectedType = await fileTypeFromBuffer(headerBytes);
if (!ALLOWED_MIME_TYPES.includes(detectedType?.mime ?? '')) {
  throw new FileTypeError(`Detected MIME type ${detectedType?.mime} is not allowed`);
}

// SECURITY: Generate a random key for R2 storage. Never use the original
// filename as the key — it could contain path traversal sequences or
// collide with existing files.
const storageKey = `uploads/${userId}/${randomUUID()}${extFromMime(detectedType.mime)}`;

// SECURITY: Override Content-Type based on our detection, not the upload header.
// This prevents stored XSS if storage serves the file with an attacker-controlled type.
const s3ContentType = detectedType.mime;
```

---

## Input Validation Schemas

All external input is validated using Zod schemas. Schemas are co-located with their routes and reused in tests.

```typescript
// validators/document.validator.ts

import { z } from 'zod';

export const uploadDocumentSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(255, 'Title must be 255 characters or fewer')
    .trim(),

  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or fewer')
    .trim()
    .optional(),

  tags: z
    .array(z.string().min(1).max(50).trim())
    .max(20, 'Maximum 20 tags allowed')
    .optional()
    .default([]),

  jurisdictionIds: z
    .array(z.string().uuid('Each jurisdiction ID must be a valid UUID'))
    .min(1, 'At least one jurisdiction must be selected')
    .max(50, 'Maximum 50 jurisdictions per document'),
});

export const documentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).trim().optional(),
  jurisdictionLevel: z.enum(['federal', 'provincial', 'territorial', 'municipal']).optional(),
  jurisdictionId: z.string().uuid().optional(),
  fileType: z.enum(['pdf', 'txt']).optional(),
  sortBy: z.enum(['title', 'uploaded_at', 'file_size_bytes']).default('uploaded_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// Usage in route handler
router.post('/documents', authenticate, async (req, res, next) => {
  try {
    const validated = uploadDocumentSchema.parse(req.body);
    // proceed with validated data — types are inferred
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        type: 'https://lexterrae.io/problems/validation-error',
        title: 'Validation Error',
        status: 400,
        detail: 'Request body failed validation',
        extensions: { errors: err.errors },
      });
    }
    next(err);
  }
});
```

---

## Testing Standards for Audit Readiness

### Test Coverage Requirements

| Category                | Min Coverage | Rationale                                   |
| ----------------------- | ------------ | ------------------------------------------- |
| Auth flows              | 95%          | Critical security surface                   |
| File upload validation  | 95%          | File handling is a top attack vector        |
| Jurisdiction assignment | 90%          | Core business logic correctness             |
| API input validation    | 95%          | Prevents injection and abuse                |
| Audit log generation    | 100%         | Auditors will verify every action is logged |
| Error handling paths    | 85%          | Graceful degradation, no info leaks         |

### Test Categories

```
tests/
├── unit/                    # Isolated logic, mocked dependencies
│   ├── validators/          # Every Zod schema edge case
│   ├── services/            # Business logic with mocked DB/R2
│   └── utils/               # Pure functions
├── integration/             # Real database (local Neon proxy), local R2 via wrangler
│   ├── routes/              # HTTP request/response testing
│   ├── audit/               # Verify audit logs are created correctly
│   └── transactions/        # Verify rollback behavior
├── e2e/                     # Full browser automation (Playwright)
│   ├── upload-flow.spec.ts
│   ├── map-selection.spec.ts
│   └── document-browser.spec.ts
└── security/                # Dedicated security test suite
    ├── file-upload-abuse.spec.ts
    ├── auth-bypass.spec.ts
    ├── injection.spec.ts
    └── rate-limiting.spec.ts
```

### Security Test Examples

```typescript
describe('File Upload Security', () => {
  it('rejects a .exe file renamed to .pdf', async () => {
    const exeBuffer = Buffer.from([0x4d, 0x5a]); // MZ header (Windows executable)
    const response = await uploadFile('malicious.pdf', exeBuffer, 'application/pdf');
    expect(response.status).toBe(415);
  });

  it('rejects a file with path traversal in filename', async () => {
    const response = await uploadFile('../../../etc/passwd', validPdfBuffer, 'application/pdf');
    expect(response.status).toBe(400);
    // Verify the file was not written outside the uploads directory
  });

  it('rejects files exceeding size limit', async () => {
    const largeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51 MB
    const response = await uploadFile('large.pdf', largeBuffer, 'application/pdf');
    expect(response.status).toBe(413);
  });

  it('creates an audit log entry on successful upload', async () => {
    const response = await uploadFile('valid.pdf', validPdfBuffer, 'application/pdf');
    expect(response.status).toBe(201);

    const auditEntry = await db.auditLog.findFirst({
      where: { action: 'document.upload', resourceId: response.body.id },
    });
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.outcome).toBe('success');
  });

  it('creates an audit log entry on failed upload', async () => {
    const response = await uploadFile('bad.exe', exeBuffer, 'application/pdf');
    expect(response.status).toBe(415);

    const auditEntry = await db.auditLog.findFirst({
      where: { action: 'document.upload', outcome: 'failure' },
    });
    expect(auditEntry).toBeDefined();
    expect(auditEntry!.failureReason).toContain('UNSUPPORTED_FILE_TYPE');
  });
});
```

---

## Configuration Management

### Environment Variables

Configuration comes from the Worker's bindings (`wrangler.jsonc` vars plus secrets) and is validated with Zod on first use — see `apps/api/src/env.ts`. A misconfigured Worker answers 503 and logs which variables are wrong (never their values).

```typescript
const configSchema = z.object({
  ENVIRONMENT: z.enum(['development', 'test', 'staging', 'production']).default('production'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//), // secret: Neon pooled connection string
  NEON_LOCAL_PROXY: z.string().optional(), // local development only
  JWT_SECRET: z.string().min(32), // secret
  JWT_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(50),
});
```

### Secrets Management

- Never commit secrets to version control (`.env` files in `.gitignore`)
- Use `.dev.vars.example` / `.env.example` with placeholder values for documentation
- In production, store secrets with `wrangler secret put` (encrypted Worker secrets) and GitHub Actions secrets
- Rotate JWT secrets on a 90-day schedule
- Database passwords rotated on a 90-day schedule

---

## Dependency Inventory

Maintain a `DEPENDENCIES.md` file listing every production dependency with its purpose and license:

```markdown
| Package                  | Version | Purpose                                         | License | Last Audited |
| ------------------------ | ------- | ----------------------------------------------- | ------- | ------------ |
| hono                     | 4.x     | HTTP framework (Workers)                        | MIT     | 2026-10-05   |
| @neondatabase/serverless | 1.x     | Neon Postgres driver (HTTP/WebSocket)           | MIT     | 2026-10-05   |
| zod                      | 3.x     | Runtime input validation                        | MIT     | 2026-10-05   |
| bcryptjs                 | 3.x     | Password hashing                                | MIT     | 2026-10-05   |
| jose                     | 6.x     | JWT signing/verification (WebCrypto)            | MIT     | 2026-10-05   |
| file-type                | 19.x    | Magic byte file type detection                  | MIT     | 2026-10-05   |
| unpdf                    | 1.x     | PDF text extraction (Workers-compatible pdf.js) | MIT     | 2026-10-05   |
| d3                       | 7.x     | SVG map rendering                               | ISC     | 2025-01-15   |
| topojson-client          | 3.x     | TopoJSON parsing for maps                       | ISC     | 2025-01-15   |
```

Run `pnpm licenses list` monthly and flag any new copyleft (GPL) dependencies for legal review.
