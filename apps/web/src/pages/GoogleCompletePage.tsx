import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useDocumentTitle } from '../components/common/useDocumentTitle';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';

/** Landing page after Google sign-in: trades the new refresh cookie for a session. */
export function GoogleCompletePage() {
  useDocumentTitle('Signing in');
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const started = useRef(false);

  useEffect(() => {
    // Refresh tokens are single-use, so never run this twice (e.g. StrictMode)
    if (started.current) return;
    started.current = true;
    api
      .completeGoogleSignIn()
      .then((auth) => {
        setAuth(auth);
        navigate('/documents', { replace: true });
      })
      .catch(() => navigate('/login?error=failed', { replace: true }));
  }, [navigate, setAuth]);

  return (
    <main className="flex min-h-screen items-center justify-center" aria-busy="true">
      <LoadingSpinner size="lg" />
      <span className="sr-only">Signing you in…</span>
    </main>
  );
}
