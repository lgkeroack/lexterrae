# Lex Terrae — Task Checklist & Acceptance Criteria

## Phase 1: Foundation

### 1.1 Project Scaffolding

- [ ] Initialize monorepo with pnpm workspaces
- [ ] Configure TypeScript with strict mode across all packages
- [ ] Set up ESLint + Prettier (see `03-CODE-QUALITY.md`)
- [ ] Configure Vitest for unit tests, Playwright for E2E
- [ ] Set up Husky pre-commit hooks (lint, type-check, test)
- [ ] Create Docker Compose for local dev (Postgres + local Neon proxy)
- [ ] Write initial README with setup instructions

**Acceptance:** `pnpm install && pnpm dev` starts all services. `pnpm lint && pnpm typecheck && pnpm test` passes with zero errors.

### 1.2 Database Schema & Migrations

- [ ] Define the SQL schema (db/migrations) for Users, Documents, Jurisdictions, DocumentJurisdictions
- [ ] Seed jurisdiction data (all 13 provinces/territories + major municipalities)
- [ ] Create migration scripts
- [ ] Write schema validation tests

**Schema Design:**

```sql
-- Core tables
users (id, email, password_hash, display_name, created_at, updated_at)
documents (id, user_id FK, title, description, file_key, file_type, file_size_bytes,
           original_filename, content_text, tags[], uploaded_at, updated_at)
jurisdictions (id, name, code, level ENUM('federal','provincial','territorial','municipal'),
               parent_id FK self, legal_system ENUM('common_law','civil_law'),
               geo_code, population, created_at)
document_jurisdictions (document_id FK, jurisdiction_id FK, PRIMARY KEY(document_id, jurisdiction_id))
```

**Acceptance:** All migrations run cleanly. Seed script populates 13 provinces/territories + 100+ municipalities. Foreign key constraints enforced. Query for "all documents in British Columbia including municipal sub-jurisdictions" returns correct results.

### 1.3 Authentication System

- [ ] Implement registration endpoint (email + password)
- [ ] Implement login endpoint (returns JWT)
- [ ] Implement token refresh
- [ ] Password hashing with bcrypt (cost factor ≥ 12)
- [ ] Auth middleware for protected routes
- [ ] Rate limiting on auth endpoints (see `07-SECURITY.md`)

**Acceptance:** Registration rejects weak passwords. Login returns valid JWT. Protected routes reject expired/malformed tokens. Rate limit triggers after 10 failed login attempts per IP per 15 minutes.

---

## Phase 2: File Upload & Processing

### 2.1 File Upload API

- [ ] `POST /api/documents` — multipart upload endpoint
- [ ] File type validation (PDF, TXT only; MIME + magic bytes)
- [ ] File size limit enforcement (50 MB max)
- [ ] Virus scanning integration point (ClamAV or placeholder)
- [ ] R2 upload with unique key generation
- [ ] Transactional: file stored + DB record created atomically
- [ ] Return upload progress via chunked transfer or WebSocket

**Acceptance:** Valid PDFs and TXT files upload successfully. Non-PDF/TXT files rejected with 415 status. Files > 50 MB rejected with 413 status. Upload creates both R2 object and database record. If either fails, both roll back.

### 2.2 PDF Text Extraction

- [ ] Integrate pdf-parse or pdf.js for text extraction
- [ ] Store extracted text in `documents.content_text`
- [ ] Handle encrypted/password-protected PDFs gracefully (skip extraction, flag)
- [ ] Handle scanned/image-only PDFs (flag as "no text extracted")
- [ ] Sanitize extracted text (strip control characters, normalize whitespace)

**Acceptance:** Text extracted from standard PDFs matches content. Encrypted PDFs flagged without crashing. Image-only PDFs flagged appropriately. Extracted text contains no null bytes or control characters.

### 2.3 Document Metadata

- [ ] `PATCH /api/documents/:id` — update title, description, tags
- [ ] `GET /api/documents/:id` — retrieve document with jurisdictions
- [ ] `DELETE /api/documents/:id` — soft delete (mark deleted, remove from R2 after 30 days)
- [ ] `GET /api/documents` — list with pagination, filtering, sorting

**Acceptance:** All CRUD operations work. Pagination returns correct pages. Filters by jurisdiction, file type, date range all functional. Soft-deleted documents excluded from listings but recoverable within 30 days.

---

## Phase 3: Jurisdiction Map Interface

### 3.1 Canada Map Component

- [ ] Render SVG map of Canada using D3.js + TopoJSON
- [ ] All 13 provinces/territories as interactive, clickable regions
- [ ] Hover states showing province/territory name and code
- [ ] Click to select/deselect a province (multi-select supported)
- [ ] Selected provinces highlighted with distinct color
- [ ] Federal-level toggle: "Applies to all of Canada"
- [ ] Responsive layout: works on desktop (1024px+) and tablet (768px+)

**Visual Design Requirements:**

- Use a clean, professional color palette
- Unselected regions: light gray (#E5E7EB) with subtle borders
- Hovered region: medium blue (#93C5FD)
- Selected region: strong blue (#2563EB) with white text label
- Federal selection: all regions highlighted in a distinct green (#10B981)
- Quebec distinguished with a subtle indicator (civil law jurisdiction)
- Territories visually distinguished from provinces (dashed border or lighter shade)

**Acceptance:** All 13 regions render correctly with accurate boundaries. Click selection toggles reliably. Multi-select works (e.g., select BC and Alberta simultaneously). Hover tooltip shows full name. Responsive down to 768px width.

### 3.2 Province Drill-Down (Municipal Selection)

- [ ] Clicking a selected province opens a zoomed/detailed view
- [ ] Show municipalities within that province as selectable regions or list
- [ ] For provinces with many municipalities, provide a searchable list alongside the map
- [ ] Support selecting multiple municipalities within a province
- [ ] "Entire Province" toggle (selects provincial level, not individual municipalities)
- [ ] Back button to return to national map view

**Initial Municipality Data (by province, major cities only):**

| Province | Initial Municipalities                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| BC       | Vancouver, Victoria, Surrey, Burnaby, Richmond, Kelowna, Kamloops, Nanaimo, Squamish, Whistler, Prince George, Abbotsford           |
| AB       | Calgary, Edmonton, Red Deer, Lethbridge, Medicine Hat, Grande Prairie, St. Albert, Airdrie                                          |
| SK       | Regina, Saskatoon, Prince Albert, Moose Jaw, Swift Current                                                                          |
| MB       | Winnipeg, Brandon, Thompson, Steinbach, Portage la Prairie                                                                          |
| ON       | Toronto, Ottawa, Mississauga, Brampton, Hamilton, London, Markham, Vaughan, Kitchener, Windsor, Richmond Hill, Oakville, Burlington |
| QC       | Montréal, Québec City, Laval, Gatineau, Longueuil, Sherbrooke, Lévis, Saguenay, Trois-Rivières                                      |
| NB       | Fredericton, Saint John, Moncton, Dieppe, Riverview                                                                                 |
| NS       | Halifax, Cape Breton (Sydney), Dartmouth, Truro, New Glasgow                                                                        |
| PE       | Charlottetown, Summerside, Stratford, Cornwall                                                                                      |
| NL       | St. John's, Mount Pearl, Corner Brook, Conception Bay South, Paradise                                                               |
| YT       | Whitehorse, Dawson City                                                                                                             |
| NT       | Yellowknife, Hay River, Inuvik                                                                                                      |
| NU       | Iqaluit, Rankin Inlet, Arviat                                                                                                       |

**Acceptance:** Drill-down opens for each province. Municipality list is searchable. Multi-select works. "Entire Province" correctly maps to provincial jurisdiction level. Navigation back to national view preserves other selections.

### 3.3 Jurisdiction Selection Summary

- [ ] Sidebar or bottom panel showing current selections
- [ ] Grouped by level: Federal → Provincial → Municipal
- [ ] Remove individual selections via × button
- [ ] Clear all button
- [ ] Selection count badge
- [ ] Validate at least one jurisdiction selected before upload

**Acceptance:** Summary accurately reflects map selections in real time. Removing from summary deselects on map. Attempting to proceed with zero selections shows validation error.

---

## Phase 4: Document Browser

### 4.1 Document List View

- [ ] Paginated list of user's documents
- [ ] Columns: title, file type icon, jurisdictions (chips), upload date, file size
- [ ] Sort by title, date, size
- [ ] Search bar (searches title, description, tags, content text)
- [ ] Jurisdiction filter panel (mirrors map or uses dropdown tree)

### 4.2 Document Detail View

- [ ] Document preview (PDF rendered in-browser, TXT displayed)
- [ ] Metadata display and edit
- [ ] Jurisdiction display with visual breadcrumb (Canada → BC → Vancouver)
- [ ] Download original file button
- [ ] Delete document (with confirmation dialog)

### 4.3 Bulk Operations

- [ ] Select multiple documents via checkboxes
- [ ] Bulk delete
- [ ] Bulk re-assign jurisdictions
- [ ] Bulk export metadata as CSV

**Acceptance:** List renders 1000+ documents without performance degradation. Search returns results within 500ms. Filters combine correctly (e.g., "PDF files in British Columbia uploaded this month"). Bulk operations complete with progress feedback.

---

## Phase 5: Polish & Launch Prep

### 5.1 Error Handling & Edge Cases

- [ ] Global error boundary in React
- [ ] API error responses follow RFC 7807 (Problem Details)
- [ ] Upload retry mechanism for network failures
- [ ] Graceful degradation when R2 is unavailable
- [ ] Handle concurrent uploads (queue with max 3 simultaneous)

### 5.2 Accessibility

- [ ] WCAG 2.1 AA compliance
- [ ] Map component keyboard navigable (arrow keys between regions)
- [ ] Screen reader announcements for map selections
- [ ] Focus management in drill-down transitions
- [ ] Color contrast ratios ≥ 4.5:1

### 5.3 Documentation

- [ ] API documentation (OpenAPI 3.0 spec)
- [ ] User guide with screenshots
- [ ] Developer onboarding guide
- [ ] Architecture decision records (ADRs)

**Acceptance:** Lighthouse accessibility score ≥ 90. All interactive elements reachable via keyboard. Screen reader can navigate upload flow end-to-end.
