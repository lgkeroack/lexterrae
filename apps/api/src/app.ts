import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import accessRoutes from './routes/access.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import healthRoutes from './routes/health.js';
import jurisdictionRoutes from './routes/jurisdictions.js';
import libraryRoutes from './routes/library.js';
import type { AppEnv } from './types.js';

export const app = new Hono<AppEnv>();

// The web app is served from the same origin (Workers static assets), so no CORS is needed.
const api = new Hono<AppEnv>();

api.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: 'same-origin',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }),
);
api.use('*', requestContext);

api.route('/health', healthRoutes);
api.route('/auth', authRoutes);
api.route('/access', accessRoutes);
api.route('/documents', documentRoutes);
api.route('/jurisdictions', jurisdictionRoutes);
api.route('/library', libraryRoutes);

// Unknown /api routes: JSON 404 (must not fall through to the static-assets fallback below)
api.all('*', (c) => notFoundHandler(c));
api.onError(errorHandler);

app.route('/api', api);

// Fingerprinted build output (wrangler.jsonc routes /assets/* through the Worker). A missing
// chunk — e.g. an old tab after a deploy — must be a real 404: the SPA fallback HTML would
// otherwise be cached as that chunk's content.
app.get('/assets/*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status === 304) return res; // revalidation of a cached file that still exists
  const isFallback = res.headers.get('content-type')?.startsWith('text/html');
  if (!res.ok || isFallback) {
    return c.text('Not found', 404, { 'Cache-Control': 'no-store' });
  }
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(res.body, { status: res.status, headers });
});

// Everything else is the single-page app. Normally the assets layer answers these before the
// Worker runs (run_worker_first only covers /api/* and /assets/*); this is a fallback.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
