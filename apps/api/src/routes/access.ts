import { Hono } from 'hono';
import { z } from 'zod';
import { BACKEND_ROLES, type BackendRole } from '@lexterrae/shared';
import { requireAdmin } from '../middleware/access.js';
import { authenticate } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rate-limit.js';
import { validJson, validParams } from '../middleware/validate.js';
import * as access from '../services/access.service.js';
import { audit } from '../services/audit.service.js';
import type { AppEnv } from '../types.js';

const router = new Hono<AppEnv>();

router.use('*', authenticate, generalLimiter);

const grantSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Must be a valid email address'),
  role: z
    .enum(BACKEND_ROLES as [BackendRole, ...BackendRole[]], {
      errorMap: () => ({ message: `Role must be one of: ${BACKEND_ROLES.join(', ')}` }),
    })
    .default('member'),
});

const paramsSchema = z.object({ userId: z.string().uuid('User ID must be a valid UUID') });

/** GET /api/access — the signed-in user's backend role (null when not authorized). */
router.get('/', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  return c.json({ role: await access.getBackendRole(c.get('deps'), c.get('userId')) }, 200);
});

/** GET /api/access/users — everyone with backend access (admins only). */
router.get('/users', requireAdmin, async (c) => {
  c.header('Cache-Control', 'private, no-store');
  return c.json({ data: await access.listAuthorizedUsers(c.get('deps')) }, 200);
});

/** POST /api/access/users — authorize an existing account, or change its role (admins only). */
router.post('/users', requireAdmin, async (c) => {
  const { email, role } = await validJson(c, grantSchema);
  const deps = c.get('deps');
  const data = await access.grantAccess(deps, c.get('userId'), email, role);
  audit(deps, {
    actorUserId: c.get('userId'),
    action: 'access.grant',
    resourceType: 'user',
    resourceId: data.userId,
    changes: { role },
    outcome: 'success',
  });
  return c.json({ data }, 201);
});

/** DELETE /api/access/users/:userId — remove a user's backend access (admins only). */
router.delete('/users/:userId', requireAdmin, async (c) => {
  const { userId } = validParams(c, paramsSchema);
  const deps = c.get('deps');
  await access.revokeAccess(deps, c.get('userId'), userId);
  audit(deps, {
    actorUserId: c.get('userId'),
    action: 'access.revoke',
    resourceType: 'user',
    resourceId: userId,
    outcome: 'success',
  });
  return c.body(null, 204);
});

export default router;
