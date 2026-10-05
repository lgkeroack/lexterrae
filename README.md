# Lex Terrae

Organize and find Canadian legal documents by jurisdiction — federal, provincial/territorial and
municipal — with an interactive map for tagging uploads.

## Architecture

One **Cloudflare Worker** serves everything on a single origin:

- `/*` — the React web app (`apps/web`), deployed as Workers static assets
- `/api/*` — the API (`apps/api`, [Hono](https://hono.dev)), plus a Cron Trigger for maintenance

| Concern        | Service                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| Database       | [Neon](https://neon.tech) Postgres via `@neondatabase/serverless` (plain SQL, no ORM)   |
| File storage   | Cloudflare R2 (`BUCKET` binding)                                                        |
| Rate limiting  | Workers Rate Limiting (per minute) + Postgres counters (longer windows)                 |
| Sessions       | Short-lived JWT access tokens + rotating refresh token in an httpOnly cookie            |
| Scheduled jobs | Cron Trigger every 6 h: purge documents deleted > 30 days ago, clean up tokens/counters |

```
apps/
  web/        React 18 + Vite + Tailwind + Zustand
  api/        Cloudflare Worker (Hono)
    src/          routes, services, middleware, validators
    db/           SQL migrations, migration runner, seed
    wrangler.jsonc
packages/
  shared/     Types and constants shared by web and API
docs/         Product, security and engineering specifications
```

## Local development

Requirements: Node.js 22+, pnpm 10+, Docker.

```bash
pnpm install

# Postgres + a local Neon proxy, so the app uses the same Neon driver as production
docker compose up -d

cp apps/api/.env.example apps/api/.env            # used by db:migrate / db:seed
cp apps/api/.dev.vars.example apps/api/.dev.vars  # used by wrangler dev (set JWT_SECRET)

pnpm db:migrate
pnpm db:seed

pnpm dev
```

`pnpm dev` starts the Worker (`wrangler dev`, http://localhost:8787) and the Vite dev server
(http://localhost:5173, proxies `/api` to the Worker). Open http://localhost:5173. R2 and the rate
limiters are simulated locally by Wrangler.

Instead of Docker you can point `DATABASE_URL` (in both files) at a
[Neon branch](https://neon.tech/docs/introduction/branching) and remove `NEON_LOCAL_PROXY`.

| Command           | What it does                                                 |
| ----------------- | ------------------------------------------------------------ |
| `pnpm dev`        | Worker + web dev servers                                     |
| `pnpm typecheck`  | TypeScript across all packages                               |
| `pnpm test`       | Unit tests (Vitest)                                          |
| `pnpm build`      | Build the web app and bundle the Worker (dry run, no deploy) |
| `pnpm db:migrate` | Apply pending SQL migrations from `apps/api/db/migrations`   |
| `pnpm db:seed`    | Seed/refresh the Canadian jurisdiction list (idempotent)     |
| `pnpm deploy`     | Build the web app and deploy the Worker                      |

## Deploying to Cloudflare + Neon

Requires a Cloudflare account on the **Workers Paid** plan (password hashing and PDF text
extraction exceed the Free plan's CPU limit) and a Neon project.

1. **Neon** — create a project (Postgres 17) and copy two connection strings from _Connect_:
   the **pooled** one (host contains `-pooler`) for the Worker, and the **direct** one for
   migrations.

2. **Database schema and seed data** (direct connection string):

   ```bash
   DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' pnpm db:migrate
   DATABASE_URL='postgresql://…neon.tech/neondb?sslmode=require' pnpm db:seed
   ```

3. **Cloudflare resources and secrets** (from `apps/api`):

   ```bash
   cd apps/api
   npx wrangler login
   npx wrangler r2 bucket create lexterrae-uploads
   npx wrangler secret put DATABASE_URL   # Neon pooled connection string
   npx wrangler secret put JWT_SECRET     # e.g. output of: openssl rand -base64 48
   ```

4. **Deploy:** `pnpm deploy` from the repository root. The app is served at
   `https://lexterrae.<your-subdomain>.workers.dev`; add a custom domain under the Worker's
   _Settings → Domains & Routes_ (or `routes` in `wrangler.jsonc`).

5. **Continuous deployment** (optional): `.github/workflows/deploy.yml` migrates and deploys on
   every push to `main`. Add these repository secrets: `CLOUDFLARE_API_TOKEN` (_Edit Cloudflare
   Workers_ template), `CLOUDFLARE_ACCOUNT_ID`, and `NEON_DATABASE_URL` (direct connection string).

Check a deployment with `curl https://<your-domain>/api/health`, follow logs with
`npx wrangler tail`, and roll back with `npx wrangler rollback`.

## Documentation

- [Project overview](docs/01-PROJECT-OVERVIEW.md)
- [Task checklist](docs/02-TASK-CHECKLIST.md)
- [Code quality](docs/03-CODE-QUALITY.md)
- [Debugging guide](docs/04-DEBUGGING-GUIDE.md)
- [Optimization](docs/05-OPTIMIZATION.md)
- [Audit-ready code](docs/06-AUDIT-READY-CODE.md)
- [Security](docs/07-SECURITY.md)
