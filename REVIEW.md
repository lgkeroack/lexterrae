# Lex Terrae - Code Review & Next Steps

## Critical Issues

### 1. Access Tokens in localStorage (XSS Vulnerability)
**File:** `apps/web/src/stores/authStore.ts:23-24, 74`

Access and refresh tokens are stored in `localStorage`, which any injected script can read. If an attacker achieves XSS, they steal the user session entirely.

**Fix:** Store access tokens in memory only (a variable, not localStorage). Use HTTP-only, Secure, SameSite=Strict cookies for refresh tokens. Add a `/refresh` call on page load to recover sessions.

### 2. Refresh Tokens in Response Body
**File:** `apps/api/src/routes/auth.ts:75, 109, 131`

Refresh tokens are returned in JSON response bodies. They're visible in network logs and accessible to XSS.

**Fix:** Set refresh tokens as HTTP-only cookies server-side. Remove from JSON responses.

### 3. CORS Blocks All Production Requests
**File:** `apps/api/src/server.ts:68`

```typescript
origin: env.NODE_ENV === 'production' ? false : true
```

`origin: false` in production will reject all cross-origin requests. The frontend won't be able to reach the API.

**Fix:** Use an `ALLOWED_ORIGINS` environment variable:
```typescript
origin: env.NODE_ENV === 'production'
  ? env.ALLOWED_ORIGINS.split(',')
  : true
```

## High Priority Issues

### 4. No Rate Limiting on `/refresh` or Document Endpoints
**File:** `apps/api/src/routes/auth.ts:121-137`, `apps/api/src/routes/documents.ts`

The `/refresh` endpoint and all document endpoints lack rate limiting. An attacker can brute-force token refresh or exhaust storage via unlimited uploads.

**Fix:** Add rate limiters to `/refresh` (30/15min) and document upload (50/hour per user).

### 5. Logout Doesn't Revoke Access Token
**File:** `apps/api/src/services/auth.service.ts:79-86`

Only the refresh token is revoked on logout. A stolen access token remains valid for up to 15 minutes.

**Fix:** Accept the access token JTI on logout and add it to the Redis revocation list.

### 6. Request ID Header Injection
**File:** `apps/api/src/middleware/request-id.ts:13`

Client-supplied `x-request-id` is used without validation. Malicious values could inject fake log entries.

**Fix:** Validate against UUID format: `/^[a-f0-9\-]{36}$/`

## Next Steps (Priority Order)

### Immediate (Security)
- [ ] Move refresh token to HTTP-only cookie
- [ ] Store access token in memory only (not localStorage)
- [ ] Fix CORS production configuration
- [ ] Add rate limiting to `/refresh` and document endpoints
- [ ] Validate `x-request-id` header format

### Short Term (Quality)
- [ ] Write unit tests for auth service (registration, login, token refresh, logout)
- [ ] Write unit tests for document service (upload, CRUD, filtering)
- [ ] Write unit tests for file service (magic byte validation, filename sanitization)
- [ ] Write integration tests for API routes
- [ ] Set up GitHub Actions CI (lint, typecheck, test on PR)
- [ ] Add ESLint config (referenced in scripts but may not be fully configured)

### Medium Term (Features from Task Checklist)
- [ ] Email verification flow
- [ ] Password reset flow
- [ ] Bulk document operations (select, delete, re-assign jurisdictions, CSV export)
- [ ] Upload progress indicator (WebSocket or chunked transfer)
- [ ] Auto-purge soft-deleted documents after 30 days (cron job or scheduled task)
- [ ] OpenAPI 3.0 spec / Swagger documentation

### Long Term (Polish)
- [ ] WCAG 2.1 AA accessibility compliance
- [ ] Keyboard navigation for map component
- [ ] Screen reader support for map selections
- [ ] Lighthouse performance optimization
- [ ] E2E tests with Playwright
- [ ] Infrastructure as code (Helm charts, Terraform)
- [ ] Multi-factor authentication
