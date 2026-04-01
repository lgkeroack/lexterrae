# Lex Terrae - Code Review & Next Steps

## Resolved Issues

All critical and high-priority security issues from the initial review have been addressed:

| Issue | Resolution |
|-------|-----------|
| Access tokens in localStorage | Stored in memory only; refresh via HTTP-only cookie |
| Refresh tokens in response body | Sent as HTTP-only, Secure, SameSite=Strict cookie |
| CORS `origin: false` in production | Uses `ALLOWED_ORIGINS` env var with explicit origins |
| No rate limiting on `/refresh` | Rate limited: 30 req/15min per IP |
| No rate limiting on document upload | Rate limited: 50 req/hr per IP |
| Logout doesn't revoke access token | Both access and refresh tokens revoked on logout |
| Request ID header injection | Validated against UUID regex |
| Password management complexity | Eliminated - replaced with Google OAuth |

## Remaining Next Steps

### Short Term (Quality)
- [ ] Write unit tests for auth service (Google OAuth flow, token refresh, logout)
- [ ] Write unit tests for document service (upload, CRUD, filtering)
- [ ] Write unit tests for file service (magic byte validation, filename sanitization)
- [ ] Write integration tests for API routes
- [ ] Set up GitHub Actions CI (lint, typecheck, test on PR)

### Medium Term (Features)
- [ ] Bulk document operations (select, delete, re-assign jurisdictions, CSV export)
- [ ] Upload progress indicator (WebSocket or chunked transfer)
- [ ] Auto-purge soft-deleted documents after 30 days (cron job)
- [ ] OpenAPI 3.0 spec / Swagger documentation

### Long Term (Polish)
- [ ] WCAG 2.1 AA accessibility compliance
- [ ] Keyboard navigation for map component
- [ ] Screen reader support for map selections
- [ ] E2E tests with Playwright
- [ ] Infrastructure as code (Helm charts, Terraform)
