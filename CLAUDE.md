# Lex Terrae - Project Context

## What This Is

Canadian Jurisdiction Document Management Platform. Users upload PDF/text documents and tag them to Canadian legal jurisdictions (Federal, Provincial/Territorial, Municipal) via an interactive map interface. Reflects Canada's three-tier constitutional division of powers.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, D3.js (map), Zustand (state), React Router 7, Vite 6 |
| Backend | Node.js, Express 4, TypeScript, Prisma 6 (ORM), Zod (validation) |
| Database | PostgreSQL 16 |
| Cache/Sessions | Redis 7 |
| File Storage | MinIO (local) / AWS S3 (prod) |
| Auth | JWT (access + refresh tokens), bcrypt |
| Monorepo | pnpm workspaces |
| Testing | Vitest (configured but no tests written yet) |

## Repository Structure

```
apps/
  api/          Express backend (port 3001)
    src/
      routes/         auth, documents, jurisdictions, health
      services/       auth, document, file, jurisdiction, audit
      middleware/     auth (JWT), validate (Zod), error-handler, request-id
      validators/    Zod schemas for request validation
      config/        env, database (Prisma), redis, s3
      lib/           errors (custom classes), logger (Pino)
    prisma/
      schema.prisma  5 models: User, Document, Jurisdiction, DocumentJurisdiction, AuditLog
  web/          React frontend (port 5173, proxies /api to 3001)
    src/
      pages/          Login, Register, Upload, Documents, DocumentDetail, DocumentBrowser
      components/     auth/, upload/, map/, browser/, common/, layout/
      stores/         authStore, documentStore, jurisdictionStore (Zustand)
      services/       api.ts (axios client)
      data/           provinces.ts, map-paths.ts (SVG paths)
packages/
  shared/       Shared TypeScript types & constants
```

## Key Commands

```bash
pnpm install              # Install all dependencies
docker-compose up         # Start PostgreSQL, Redis, MinIO
pnpm db:generate          # Generate Prisma client
pnpm db:migrate           # Run migrations
pnpm db:seed              # Seed jurisdiction data (13 prov/terr + 100+ municipalities)
pnpm dev                  # Start both api + web
pnpm dev:api              # Start API only
pnpm dev:web              # Start web only
pnpm lint                 # ESLint across all packages
pnpm typecheck            # TypeScript strict mode check
pnpm test                 # Run tests (none exist yet)
```

## Database Models

- **User**: email, passwordHash, displayName
- **Document**: title, description, fileKey (S3), fileType, fileSizeBytes, contentText (extracted PDF text), tags[], soft-delete via deletedAt
- **Jurisdiction**: name, code, level (federal/provincial/territorial/municipal), parentId (self-referential tree), legalSystem (common_law/civil_law)
- **DocumentJurisdiction**: many-to-many junction table
- **AuditLog**: timestamp, actorUserId, actorIpHash (HMAC-SHA256), action, resourceType/Id, changes (JSON), outcome

## API Endpoints

- `POST /api/auth/register|login|refresh|logout` - Auth (register/login rate-limited)
- `POST /api/documents` - Upload (multipart, requires auth)
- `GET /api/documents` - List with pagination/filtering/sorting (requires auth)
- `GET /api/documents/:id` - Detail with jurisdictions (requires auth)
- `PATCH /api/documents/:id` - Update metadata (requires auth)
- `DELETE /api/documents/:id` - Soft delete (requires auth)
- `GET /api/documents/:id/download` - Download file (requires auth)
- `GET /api/jurisdictions` - Full tree (public, cached 24h in Redis)
- `GET /api/jurisdictions/:id` - Single with parent/children (public)
- `GET /api/health` - Health check (checks DB, Redis, S3)

## Architecture Decisions

- Error responses follow RFC 7807 Problem Details format
- File type validation uses magic bytes, not just extensions
- Filenames sanitized to prevent path traversal
- IP addresses hashed (HMAC-SHA256) in audit logs, never stored raw
- Access tokens: 15min expiry; Refresh tokens: 7 day expiry with rotation
- Structured JSON logging via Pino with request ID propagation
- Jurisdiction data seeded, not user-editable

## Known Issues & Security Concerns

See REVIEW.md for the full audit. Critical items:
1. Access tokens stored in localStorage (XSS vulnerable) - should be memory-only
2. Refresh tokens returned in response body - should be HTTP-only cookies
3. CORS `origin: false` in production blocks all cross-origin requests
4. No rate limiting on `/refresh` endpoint or document operations
5. Logout only revokes refresh token, not access token
6. No tests written yet
7. No CI/CD pipeline configured

## Implementation Status

**Done (Phases 1-3 mostly complete):**
- Monorepo scaffolding, Docker Compose, Prisma schema + seed
- Auth system (register, login, refresh, logout, JWT middleware)
- Document upload/CRUD with S3 storage and PDF text extraction
- Interactive Canada map with province drill-down and municipality selection
- Document browser with pagination, filtering, sorting, search
- Audit logging, security middleware (Helmet, CORS, rate limiting)
- Shared types package

**Not Done:**
- Testing (unit, integration, E2E) - Vitest configured but zero tests
- CI/CD (no GitHub Actions)
- Email verification / password reset
- Bulk document operations (Phase 4.3)
- Accessibility / WCAG compliance (Phase 5.2)
- API documentation (OpenAPI spec)
- Upload retry / progress (WebSocket)
- Auto-purge of soft-deleted documents after 30 days
- Virus scanning integration (ClamAV placeholder)
