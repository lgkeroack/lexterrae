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
| Auth | Google OAuth 2.0, JWT (access tokens in memory, refresh tokens in HTTP-only cookies) |
| Monorepo | pnpm workspaces |
| Testing | Vitest (configured but no tests written yet) |

## Repository Structure

```
apps/
  api/          Express backend (port 3001)
    src/
      routes/         auth (Google OAuth), documents, jurisdictions, health
      services/       auth, document, file, jurisdiction, audit
      middleware/     auth (JWT + Redis revocation check), validate (Zod), error-handler, request-id
      validators/    Zod schemas for request validation
      config/        env, database (Prisma), redis, s3
      lib/           errors (custom classes), logger (Pino)
    prisma/
      schema.prisma  5 models: User, Document, Jurisdiction, DocumentJurisdiction, AuditLog
  web/          React frontend (port 5173, proxies /api to 3001)
    src/
      pages/          Login, AuthCallback, Upload, Documents, DocumentDetail, DocumentBrowser
      components/     auth/, upload/, map/, browser/, common/, layout/
      stores/         authStore, documentStore, jurisdictionStore (Zustand)
      services/       api.ts (fetch client with token refresh)
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

## Authentication Flow (Google OAuth)

1. Frontend loads Google OAuth config from `GET /api/auth/google/config`
2. User clicks "Sign in with Google" -> redirected to Google consent screen
3. Google redirects back to `/auth/callback?code=...`
4. Frontend sends code to `POST /api/auth/google/callback`
5. Backend exchanges code for Google ID token, finds/creates user
6. Backend returns access token in response body + sets refresh token as HTTP-only cookie
7. Frontend stores access token in memory only (never localStorage)
8. On page reload, `AuthGuard` calls `POST /api/auth/refresh` (cookie sent automatically)
9. Logout: `POST /api/auth/logout` revokes both tokens + clears cookie

**Required env vars:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (from Google Cloud Console)

## Database Models

- **User**: googleId (unique), email, displayName, avatarUrl
- **Document**: title, description, fileKey (S3), fileType, fileSizeBytes, contentText (extracted PDF text), tags[], soft-delete via deletedAt
- **Jurisdiction**: name, code, level (federal/provincial/territorial/municipal), parentId (self-referential tree), legalSystem (common_law/civil_law)
- **DocumentJurisdiction**: many-to-many junction table
- **AuditLog**: timestamp, actorUserId, actorIpHash (HMAC-SHA256), action, resourceType/Id, changes (JSON), outcome

## API Endpoints

- `GET /api/auth/google/config` - Returns Google client ID + redirect URI
- `POST /api/auth/google/callback` - Exchange Google auth code for tokens (rate-limited)
- `POST /api/auth/refresh` - Refresh via HTTP-only cookie (rate-limited)
- `POST /api/auth/logout` - Revoke both tokens, clear cookie
- `GET /api/auth/me` - Current user profile (requires auth)
- `POST /api/documents` - Upload (multipart, requires auth, rate-limited)
- `GET /api/documents` - List with pagination/filtering/sorting (requires auth)
- `GET /api/documents/:id` - Detail with jurisdictions (requires auth)
- `PATCH /api/documents/:id` - Update metadata (requires auth)
- `DELETE /api/documents/:id` - Soft delete (requires auth)
- `GET /api/documents/:id/download` - Download file (requires auth)
- `GET /api/jurisdictions` - Full tree (public, cached 24h in Redis)
- `GET /api/jurisdictions/:id` - Single with parent/children (public)
- `GET /api/health` - Health check (checks DB, Redis, S3)

## Security Architecture

- **Tokens**: Access token (15m) in memory only; refresh token (7d) in HTTP-only, Secure, SameSite=Strict cookie
- **Token revocation**: Both access and refresh tokens checked against Redis revocation list
- **CORS**: Uses `ALLOWED_ORIGINS` env var (comma-separated), always explicit origins
- **Rate limiting**: OAuth callback (20/15min), token refresh (30/15min), uploads (50/hr)
- **Request ID**: Client-supplied `X-Request-Id` validated as UUID format, otherwise server-generated
- **File security**: Magic byte validation, filename sanitization, forced download headers
- **Audit logging**: All actions logged with HMAC-SHA256 hashed IPs
- **Error responses**: RFC 7807 Problem Details format, no sensitive data leaked

## Implementation Status

**Done:**
- Monorepo scaffolding, Docker Compose, Prisma schema + seed
- Google OAuth authentication (replaces email/password)
- HTTP-only cookie token management (replaces localStorage)
- Document upload/CRUD with S3 storage and PDF text extraction
- Interactive Canada map with province drill-down and municipality selection
- Document browser with pagination, filtering, sorting, search
- Audit logging, security middleware (Helmet, CORS, rate limiting)
- Shared types package

**Not Done:**
- Testing (unit, integration, E2E) - Vitest configured but zero tests
- CI/CD (no GitHub Actions)
- Bulk document operations
- Accessibility / WCAG compliance
- API documentation (OpenAPI spec)
- Upload progress (WebSocket)
- Auto-purge of soft-deleted documents after 30 days
