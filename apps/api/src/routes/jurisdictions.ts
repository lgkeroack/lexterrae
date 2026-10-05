import { Router, type Request, type Response, type NextFunction } from 'express';
import { jurisdictionService } from '../services/jurisdiction.service.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { generalLimiter } from '../lib/rate-limit.js';

const router: ReturnType<typeof Router> = Router();

// Public reference data: limited per IP
router.use(generalLimiter);

const jurisdictionParamsSchema = z.object({
  id: z.string().uuid('Jurisdiction ID must be a valid UUID'),
});

/**
 * GET /api/jurisdictions
 * Returns the full jurisdiction hierarchy tree.
 * Federal -> Provincial -> Municipal, cached in Redis for 24 hours.
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tree = await jurisdictionService.getJurisdictionTree();
    res.status(200).json({ data: tree });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jurisdictions/provinces
 * Returns provinces/territories with their municipalities (shared `ProvinceData` shape).
 * Must be registered before "/:id".
 */
router.get('/provinces', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const provinces = await jurisdictionService.getProvinces();
    res.status(200).json({ data: provinces });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jurisdictions/:id
 * Returns a single jurisdiction by ID, including parent and children.
 */
router.get(
  '/:id',
  validate({ params: jurisdictionParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jurisdiction = await jurisdictionService.getJurisdictionById(
        req.params['id'] as string,
      );
      res.status(200).json({ data: jurisdiction });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
