import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { JURISDICTION_LEVELS, type JurisdictionLevel } from '@lexterrae/shared';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rate-limit.js';
import { validJson, validParams, validQuery } from '../middleware/validate.js';
import * as jurisdictions from '../services/jurisdiction.service.js';
import type { AppEnv } from '../types.js';

const router = new Hono<AppEnv>();

// Public reference data: limited per IP (per user when signed in)
router.use('*', generalLimiter);

const levelSchema = z.enum(JURISDICTION_LEVELS as [JurisdictionLevel, ...JurisdictionLevel[]], {
  errorMap: () => ({ message: `Level must be one of: ${JURISDICTION_LEVELS.join(', ')}` }),
});

const paramsSchema = z.object({ id: z.string().uuid('Jurisdiction ID must be a valid UUID') });

const searchSchema = z.object({
  q: z
    .string({ required_error: 'A search term (q) is required' })
    .trim()
    .min(2, 'Search for at least 2 characters')
    .max(100),
  level: levelSchema.optional(),
  within: z.string().uuid('within must be a jurisdiction UUID').optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const descendantsSchema = z.object({ level: levelSchema.optional() });

const createSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(200, 'Name must be 200 characters or fewer'),
  level: levelSchema,
  parentId: z.string().uuid('parentId must be a jurisdiction UUID').optional(),
  subtype: z
    .string()
    .trim()
    .max(80, 'Type must be 80 characters or fewer')
    .optional()
    .transform((v) => v || undefined),
});

/** Responses that include the user's own jurisdictions must not be shared by caches. */
function cacheFor(c: Context<AppEnv>) {
  c.header('Cache-Control', c.get('userId') ? 'private, no-store' : 'public, max-age=300');
}

/** GET /api/jurisdictions — the full official hierarchy. */
router.get('/', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ data: await jurisdictions.getJurisdictionTree(c.get('deps')) }, 200);
});

/** GET /api/jurisdictions/top-level — Canada and the provinces and territories. */
router.get('/top-level', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ data: await jurisdictions.getTopLevel(c.get('deps')) }, 200);
});

/** GET /api/jurisdictions/provinces — provinces/territories with their municipalities. */
router.get('/provinces', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ data: await jurisdictions.getProvinces(c.get('deps')) }, 200);
});

/** GET /api/jurisdictions/search?q=&level=&within=&limit= — search every level by name. */
router.get('/search', optionalAuthenticate, async (c) => {
  const { q, level, within, limit } = validQuery(c, searchSchema);
  const data = await jurisdictions.searchJurisdictions(c.get('deps'), c.get('userId'), {
    q,
    level,
    within,
    limit,
  });
  cacheFor(c);
  return c.json({ data }, 200);
});

/** POST /api/jurisdictions — add a jurisdiction (visible only to the signed-in user). */
router.post('/', authenticate, async (c) => {
  const input = await validJson(c, createSchema);
  const data = await jurisdictions.createJurisdiction(c.get('deps'), c.get('userId'), input);
  return c.json({ data }, 201);
});

/** DELETE /api/jurisdictions/:id — delete a jurisdiction the user added (if unused). */
router.delete('/:id', authenticate, async (c) => {
  const { id } = validParams(c, paramsSchema);
  await jurisdictions.deleteCustomJurisdiction(c.get('deps'), c.get('userId'), id);
  return c.body(null, 204);
});

/** GET /api/jurisdictions/:id/descendants?level= — everything inside a jurisdiction. */
router.get('/:id/descendants', optionalAuthenticate, async (c) => {
  const { id } = validParams(c, paramsSchema);
  const { level } = validQuery(c, descendantsSchema);
  const data = await jurisdictions.getDescendants(c.get('deps'), c.get('userId'), id, level);
  cacheFor(c);
  return c.json({ data }, 200);
});

/** GET /api/jurisdictions/:id — one jurisdiction with its parent and children. */
router.get('/:id', optionalAuthenticate, async (c) => {
  const { id } = validParams(c, paramsSchema);
  const data = await jurisdictions.getJurisdictionById(c.get('deps'), id, c.get('userId'));
  cacheFor(c);
  return c.json({ data }, 200);
});

export default router;
