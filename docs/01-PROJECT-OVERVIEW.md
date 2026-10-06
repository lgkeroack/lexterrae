# Lex Terrae — Canadian Jurisdiction Document Management Platform

## Project Overview

Lex Terrae is a web application that enables users to upload, organize, and manage PDF and text documents categorized by Canadian legal jurisdictions. Documents can be tagged to specific jurisdictional levels — Federal, Provincial/Territorial, or Municipal — with a visual, interactive map-based selection interface that reflects Canada's constitutional division of powers.

---

## Core Concept

Canada's legal system operates on three tiers of governance, each with distinct legislative authority derived from the Constitution Act, 1867:

1. **Federal** — Laws enacted by Parliament (Criminal Code, Immigration, Defence, etc.)
2. **Provincial / Territorial** — Laws enacted by provincial legislatures or territorial governments (Healthcare, Education, Property, Natural Resources, etc.)
3. **Municipal** — Bylaws and regulations enacted by municipalities under delegated provincial authority (Zoning, Property Tax, Business Licenses, Local Bylaws, etc.)

Lex Terrae mirrors this structure. When uploading a document, users visually select the jurisdiction(s) it applies to using an interactive map of Canada, drilling down from province to municipality as needed.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Upload Panel │ │ Jurisdiction │ │  Document    │  │
│  │  (Drag/Drop) │ │  Map Picker  │ │  Browser     │  │
│  └─────────────┘ └──────────────┘ └──────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS (same origin)
┌──────────────────────┴──────────────────────────────┐
│     Cloudflare Worker  (Hono, apps/api)              │
│  /api/*  → Auth · Documents · Jurisdictions · Health │
│  /*      → static web app (Workers static assets)    │
│  Cron    → retention purge, token/rate-limit cleanup │
└───────┬───────────────────┬─────────────────┬───────┘
        │                   │                 │
┌───────┴────────┐ ┌────────┴───────┐ ┌───────┴────────┐
│ Neon Postgres  │ │ Cloudflare R2  │ │ Workers Rate   │
│ (serverless    │ │ (uploaded      │ │ Limiting       │
│  driver)       │ │  files)        │ │ (per minute)   │
└────────────────┘ └────────────────┘ └────────────────┘
```

---

## Tech Stack

| Layer             | Technology                                                                | Rationale                                                   |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Frontend          | React 18 + TypeScript                                                     | Component-based, strong typing, ecosystem                   |
| Styling           | Tailwind CSS                                                              | Utility-first, rapid prototyping                            |
| Map Visualization | D3.js + TopoJSON                                                          | SVG-based interactive maps, Canadian geo data               |
| State Management  | Zustand                                                                   | Lightweight, minimal boilerplate                            |
| Hosting           | Cloudflare Workers (static assets + API in one Worker)                    | Global edge, one deploy, same-origin API                    |
| Backend           | Hono on Workers                                                           | Small, Workers-native HTTP framework                        |
| Database          | Neon Postgres via `@neondatabase/serverless` (plain SQL)                  | Serverless Postgres over HTTP/WebSocket, branching          |
| File Storage      | Cloudflare R2                                                             | S3-compatible object storage bound to the Worker            |
| Sessions & limits | Postgres (`revoked_tokens`, `rate_limit_buckets`) + Workers Rate Limiting | No separate cache service to run                            |
| Auth              | JWT (`jose`, HS256) + bcrypt (`bcryptjs`)                                 | Short-lived access tokens, httpOnly rotating refresh cookie |
| Testing           | Vitest + Playwright                                                       | Unit + E2E testing                                          |
| CI/CD             | GitHub Actions + Wrangler                                                 | Typecheck/test on PRs, migrate + deploy on main             |

---

## Canadian Jurisdiction Data Model

### Federal Level

- Applies to all of Canada

### Provincial / Territorial Level (13 jurisdictions)

| Provinces (10)            | Territories (3)       |
| ------------------------- | --------------------- |
| British Columbia          | Yukon                 |
| Alberta                   | Northwest Territories |
| Saskatchewan              | Nunavut               |
| Manitoba                  |                       |
| Ontario                   |                       |
| Quebec                    |                       |
| New Brunswick             |                       |
| Nova Scotia               |                       |
| Prince Edward Island      |                       |
| Newfoundland and Labrador |                       |

### Municipal Level

- Each province/territory contains municipalities (cities, towns, villages, counties, regional districts, etc.)
- Municipal boundaries and naming conventions vary by province
- Initial release: major municipalities per province (population > 10,000)
- Future: comprehensive municipal data via Statistics Canada census subdivisions

### Legal System Notes

- Quebec operates under **civil law** (Code civil du Québec); all other provinces/territories use **common law**
- Indigenous self-governance jurisdictions exist but are out of initial scope
- Municipal authority is delegated from provincial governments, not constitutionally entrenched

---

## Document File Structure

```
lexterrae/
├── apps/
│   ├── web/                    # React frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── upload/     # Upload panel components
│   │   │   │   ├── map/        # Jurisdiction map components
│   │   │   │   ├── browser/    # Document browser components
│   │   │   │   ├── common/     # Shared UI components
│   │   │   │   └── layout/     # App shell, navigation
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── stores/         # Zustand state stores
│   │   │   ├── services/       # API client services
│   │   │   ├── types/          # TypeScript type definitions
│   │   │   ├── utils/          # Utility functions
│   │   │   ├── data/           # Static jurisdiction data
│   │   │   │   ├── canada-topo.json
│   │   │   │   ├── provinces.ts
│   │   │   │   └── municipalities.ts
│   │   │   └── App.tsx
│   │   └── public/
│   └── api/                    # Cloudflare Worker (Hono)
│       ├── src/
│       │   ├── routes/         # auth, documents, jurisdictions, health
│       │   ├── services/       # business logic (plain SQL on Neon, R2)
│       │   ├── middleware/     # request context, auth, rate limits, errors
│       │   ├── validators/     # Zod schemas
│       │   ├── lib/            # db, logger, tokens, errors
│       │   └── index.ts        # Worker entry: fetch + scheduled
│       ├── db/
│       │   ├── migrations/     # SQL migrations (applied by db/migrate.ts)
│       │   ├── migrate.ts
│       │   └── seed.ts         # Canadian jurisdictions
│       └── wrangler.jsonc      # bindings: R2, rate limiters, assets, cron
├── packages/
│   └── shared/                 # Shared types and constants
├── docs/                       # These specification files
└── docker-compose.yml          # Local Postgres + Neon proxy
```

---

## Key User Flows

### 1. Document Upload

1. User navigates to Upload page
2. Drags/drops or selects PDF/TXT files
3. Interactive Canada map renders — user clicks province(s)
4. If municipal-level, province zooms in to show municipalities
5. User selects one or more jurisdictions
6. User adds optional metadata (title, description, tags, document date)
7. Upload begins with progress indicator
8. Server validates file, extracts text (if PDF), stores file and metadata
9. Document appears in the user's library

### 2. Document Browsing

1. User sees all documents in a filterable list/grid
2. Filter by jurisdiction level (Federal / Provincial / Municipal)
3. Filter by specific province or municipality
4. Search by document title, content, or tags
5. Click to preview or download

---

## Related Documents

| Document                 | Description                                   |
| ------------------------ | --------------------------------------------- |
| `02-TASK-CHECKLIST.md`   | Full task breakdown with acceptance criteria  |
| `03-CODE-QUALITY.md`     | Linting, formatting, code review standards    |
| `04-DEBUGGING-GUIDE.md`  | Debugging strategies and logging standards    |
| `05-OPTIMIZATION.md`     | Performance optimization guidelines           |
| `06-AUDIT-READY-CODE.md` | Code generation standards for audit readiness |
| `07-SECURITY.md`         | Security requirements and threat model        |
