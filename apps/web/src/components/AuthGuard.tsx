import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from './common/LoadingSpinner';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, isLoading, refreshToken } = useAuthStore();
  const navigate = useNavigate();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isAuthenticated && !isLoading && !attempted.current) {
      attempted.current = true;
      refreshToken().then(() => {
        // Check state after refresh attempt
        const state = useAuthStore.getState();
        if (!state.isAuthenticated) {
          navigate('/login', { replace: true });
        }
      });
    }
  }, [isAuthenticated, isLoading, refreshToken, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
