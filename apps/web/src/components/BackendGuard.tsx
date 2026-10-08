import React, { useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAccessStore } from '../stores/accessStore';
import { LoadingSpinner } from './common/LoadingSpinner';

/** After AuthGuard: only users an admin has authorized may continue; others go to user facing. */
export function BackendGuard({ children }: { children: React.ReactNode }) {
  const { role, status, error, load } = useAccessStore();

  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="lg" label="Checking your access" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <AccessMessage title="Could not check your access">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 border border-black px-4 py-2 text-sm hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Try again
        </button>
      </AccessMessage>
    );
  }
  // Not enabled for the backend: straight to the user-facing side
  if (!role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Inside BackendGuard: only admins. */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const role = useAccessStore((s) => s.role);
  if (role === 'admin') return <>{children}</>;
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-bold">Admins only</h1>
      <p className="mt-2 text-sm">Only admins can manage who has access to the backend.</p>
      <Link to="/" className="mt-6 inline-block text-sm underline underline-offset-4">
        Back to the home page
      </Link>
    </div>
  );
}

function AccessMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div role="alert" className="max-w-md border border-black p-8 text-center text-sm">
        <ShieldAlert className="mx-auto mb-4 h-10 w-10" aria-hidden="true" />
        <h1 className="mb-2 text-xl font-bold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
