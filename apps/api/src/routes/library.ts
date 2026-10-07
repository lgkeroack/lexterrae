import { Hono } from 'hono';
import { z } from 'zod';
import { fileResponse } from '../lib/download.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import { generalLimiter, searchLimiter } from '../middleware/rate-limit.js';
import { validParams, validQuery } from '../middleware/validate.js';
import * as library from '../services/library.service.js';
import type { AppEnv } from '../types.js';

/** The user-facing side, open to the public: find and download what applies where you are. */
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

const paramsSchema = z.object({ id: z.string().uuid('Document ID must be a valid UUID') });

/** GET /api/library/documents?jurisdictionId=&search=&page= — what applies in a place. */
router.get('/documents', searchLimiter, async (c) => {
  const query = validQuery(c, listSchema);
  c.header('Cache-Control', 'private, no-store');
  return c.json(await library.listLibrary(c.get('deps'), query), 200);
});

/** GET /api/library/documents/:id/download */
router.get('/documents/:id/download', async (c) => {
  const { id } = validParams(c, paramsSchema);
  const file = await library.downloadLibraryDocument(c.get('deps'), c.get('userId') ?? null, id);
  return fileResponse(c, file);
});

export default router;
