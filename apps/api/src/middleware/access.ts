import type { MiddlewareHandler } from 'hono';
import { ForbiddenError } from '../lib/errors.js';
import { getBackendRole } from '../services/access.service.js';
import type { AppEnv } from '../types.js';

/** After `authenticate`: only users authorized for the backend (members and admins). */
export const requireBackendAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const role = await getBackendRole(c.get('deps'), c.get('userId'));
  if (!role) throw new ForbiddenError('Your account is not authorized to use the backend.');
  c.set('backendRole', role);
  await next();
};

/** After `authenticate`: only backend admins. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const role = await getBackendRole(c.get('deps'), c.get('userId'));
  if (role !== 'admin') throw new ForbiddenError('Only admins can manage backend users.');
  c.set('backendRole', role);
  await next();
};
