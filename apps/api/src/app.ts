import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import healthRoutes from './routes/health.js';
import jurisdictionRoutes from './routes/jurisdictions.js';
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
api.route('/documents', documentRoutes);
api.route('/jurisdictions', jurisdictionRoutes);

// Unknown /api routes: JSON 404 (must not fall through to the static-assets fallback below)
api.all('*', (c) => notFoundHandler(c));
api.onError(errorHandler);

app.route('/api', api);

// Everything else is the single-page app. Normally the assets layer answers these before the
// Worker runs (run_worker_first only covers /api/*); this is a fallback.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));
