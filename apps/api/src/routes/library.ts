import { Hono } from 'hono';
import { z } from 'zod';
import { optionalAuthenticate } from '../middleware/auth.js';
import { generalLimiter, searchLimiter } from '../middleware/rate-limit.js';
import { validJson, validQuery } from '../middleware/validate.js';
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

const jurisdictionIdSchema = z
  .string({ required_error: 'Choose a location (jurisdictionId)' })
  .uuid('jurisdictionId must be a jurisdiction UUID');

const contentsSchema = z.object({ jurisdictionId: jurisdictionIdSchema });

const packageSchema = z.object({
  jurisdictionId: jurisdictionIdSchema,
  documentIds: z
    .array(z.string().uuid('documentIds must be document UUIDs'))
    .min(1, 'Choose at least one document')
    .max(500)
    .optional(),
});

/**
 * GET /api/library/package/contents?jurisdictionId= — the documents an AI package for
 * the place can hold, with their sizes, so the page can estimate it and let people narrow it.
 */
router.get('/package/contents', searchLimiter, async (c) => {
  const { jurisdictionId } = validQuery(c, contentsSchema);
  c.header('Cache-Control', 'private, no-store');
  return c.json(await library.getPackageContents(c.get('deps'), jurisdictionId), 200);
});

/**
 * POST /api/library/package { jurisdictionId, documentIds? } — a Markdown file for AI
 * assistants holding the documents that apply in the place (or the chosen ones), built from the
 * backend's current contents.
 */
router.post('/package', searchLimiter, async (c) => {
  const input = await validJson(c, packageSchema);
  const { filename, body } = await library.buildLibraryPackage(c.get('deps'), input);
  return c.body(body, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store',
  });
});

export default router;
