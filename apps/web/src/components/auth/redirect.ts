const DEFAULT_ROUTE = '/documents';
const AUTH_ROUTES = ['/login', '/register'];

interface FromState {
  from?: { pathname?: string; search?: string; hash?: string };
}

/**
 * Where to send the user after login/registration: the protected route they
 * originally requested (stored by AuthGuard in location.state), else /documents.
 */
export function getRedirectTarget(state: unknown): string {
  const from = (state as FromState | null)?.from;
  const pathname = from?.pathname;
  // Only allow same-app absolute paths; never bounce back to an auth page.
  if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//')) return DEFAULT_ROUTE;
  if (AUTH_ROUTES.includes(pathname) || pathname === '/') return DEFAULT_ROUTE;
  return `${pathname}${from.search ?? ''}${from.hash ?? ''}`;
}
