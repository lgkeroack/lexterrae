import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from './common/LoadingSpinner';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const status = useAuthStore((s) => s.status);
  const initialize = useAuthStore((s) => s.initialize);
  const location = useLocation();

  useEffect(() => {
    if (status === 'checking') void initialize();
  }, [status, initialize]);

  if (status === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="lg" label="Restoring your session" />
      </div>
    );
  }

  // The public start at user facing; the backend's sign-in is linked from its header
  if (status === 'unauthenticated' && location.pathname === '/') {
    return <Navigate to="/user-facing" replace />;
  }

  if (status === 'unauthenticated') {
    // Remember where the user was headed so login can send them back.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
