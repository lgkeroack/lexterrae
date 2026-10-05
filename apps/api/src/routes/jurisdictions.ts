import { Hono } from 'hono';
import { z } from 'zod';
import { generalLimiter } from '../middleware/rate-limit.js';
import { validParams } from '../middleware/validate.js';
import * as jurisdictions from '../services/jurisdiction.service.js';
import type { AppEnv } from '../types.js';

const router = new Hono<AppEnv>();

// Public reference data: limited per IP
router.use('*', generalLimiter);

const paramsSchema = z.object({ id: z.string().uuid('Jurisdiction ID must be a valid UUID') });

/** GET /api/jurisdictions — the full hierarchy. */
router.get('/', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ data: await jurisdictions.getJurisdictionTree(c.get('deps')) }, 200);
});

/** GET /api/jurisdictions/provinces — provinces/territories with municipalities. */
router.get('/provinces', async (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ data: await jurisdictions.getProvinces(c.get('deps')) }, 200);
});

/** GET /api/jurisdictions/:id — one jurisdiction with its parent and children. */
router.get('/:id', async (c) => {
  const { id } = validParams(c, paramsSchema);
  return c.json({ data: await jurisdictions.getJurisdictionById(c.get('deps'), id) }, 200);
});

export default router;
