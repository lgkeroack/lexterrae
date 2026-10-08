import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderOpen, LogIn, LogOut } from 'lucide-react';
import { useAccessStore } from '../../stores/accessStore';
import { useAuthStore } from '../../stores/authStore';
import { useUndoStore } from '../../stores/undoStore';

const linkClass =
  'inline-flex flex-shrink-0 items-center gap-2 px-2 py-1 text-sm underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** Top bar for pages outside the backend: logo home, Backend for authorized users, sign in or out. */
export function SiteHeader() {
  const email = useAuthStore((s) => s.user?.email);
  const isSignedIn = useAuthStore((s) => s.status === 'authenticated');
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const hasBackend = useAccessStore((s) => s.role !== null);

  return (
    <header className="flex h-16 items-center gap-4 border-b-4 border-double border-black px-4 sm:px-6">
      <Link
        to="/"
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
        {isSignedIn && hasBackend && (
          <Link to="/documents" className={linkClass}>
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Backend
          </Link>
        )}
        {isSignedIn && email && (
          <span className="hidden truncate text-sm text-gray-600 sm:block" title={email}>
            {email}
          </span>
        )}
        {isSignedIn ? (
          <button
            type="button"
            onClick={() => {
              // The public page stays available after signing out
              navigate('/', { replace: true });
              useUndoStore.getState().dismiss();
              logout();
            }}
            className={linkClass}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        ) : (
          <Link to="/login" className={linkClass}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
