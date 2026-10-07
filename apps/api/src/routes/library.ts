import { Hono } from 'hono';
import { z } from 'zod';
import { optionalAuthenticate } from '../middleware/auth.js';
import { generalLimiter, searchLimiter } from '../middleware/rate-limit.js';
import { validQuery } from '../middleware/validate.js';
import * as library from '../services/library.service.js';
import type { AppEnv } from '../types.js';

/**
 * The user-facing side, open to the public: find what applies where you are. Files themselves
 * are not downloadable here, only through the backend.
 */
const router = new Hono<AppEnv>();

// Public; limited per IP (per user when signed in)
router.use('*', optionalAuthenticate, generalLimiter);

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const listSchema = z.object({
  jurisdictionId: z
    .string({ required_error: 'Choose a location (jurisdictionId)' })
    .uuid('jurisdictionId must be a jurisdiction UUID'),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10_000).default(1)),
  pageSize: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100).default(25)),
});

/** GET /api/library/documents?jurisdictionId=&search=&page= — what applies in a place. */
router.get('/documents', searchLimiter, async (c) => {
  const query = validQuery(c, listSchema);
  c.header('Cache-Control', 'private, no-store');
  return c.json(await library.listLibrary(c.get('deps'), query), 200);
});

const packageSchema = z.object({
  jurisdictionId: z
    .string({ required_error: 'Choose a location (jurisdictionId)' })
    .uuid('jurisdictionId must be a jurisdiction UUID'),
});

/**
 * GET /api/library/package?jurisdictionId= — a Markdown file for AI assistants holding every
 * document that applies in the place, built from the backend's current contents.
 */
router.get('/package', searchLimiter, async (c) => {
  const { jurisdictionId } = validQuery(c, packageSchema);
  const { filename, body } = await library.buildLibraryPackage(c.get('deps'), jurisdictionId);
  return c.body(body, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store',
  });
});

export default router;
