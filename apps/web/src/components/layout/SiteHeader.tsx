import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAccessStore } from '../../stores/accessStore';
import { useAuthStore } from '../../stores/authStore';
import { useUndoStore } from '../../stores/undoStore';

/** Top bar for pages outside the backend (home, user facing): logo home and sign out. */
export function SiteHeader() {
  const email = useAuthStore((s) => s.user?.email);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  // Without backend access there is no home page: the logo leads to user facing
  const home = useAccessStore((s) => (s.role ? '/' : '/user-facing'));

  return (
    <header className="flex h-16 items-center gap-4 border-b-4 border-double border-black px-4 sm:px-6">
      <Link
        to={home}
        className="flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-2xl font-bold leading-none" aria-hidden="true">
          §
        </span>
        <span className="text-xl font-bold tracking-wide text-black [font-variant-caps:small-caps]">
          Lex Terrae
        </span>
      </Link>
      <div className="ml-auto flex min-w-0 items-center gap-4">
        {email && (
          <span className="hidden truncate text-sm text-gray-600 sm:block" title={email}>
            {email}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            navigate('/login', { replace: true });
            useUndoStore.getState().dismiss();
            logout();
          }}
          className="inline-flex flex-shrink-0 items-center gap-2 px-2 py-1 text-sm underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Log out
        </button>
      </div>
    </header>
  );
}
