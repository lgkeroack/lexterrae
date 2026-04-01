import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { AuthLayout } from '../components/layout/AuthLayout';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { api } from '../services/api';
import { useAuthStore } from '../stores/authStore';

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(`Google authentication failed: ${errorParam}`);
      return;
    }

    if (!code) {
      setError('No authorization code received from Google');
      return;
    }

    const redirectUri = `${window.location.origin}/auth/callback`;

    api
      .googleCallback(code, redirectUri)
      .then((response) => {
        setAuth(response);
        navigate('/documents', { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      });
  }, [searchParams, navigate, setAuth]);

  if (error) {
    return (
      <AuthLayout>
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-500" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Back to Sign In
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="flex flex-col items-center gap-3 py-8">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-gray-500">Completing sign in...</p>
      </div>
    </AuthLayout>
  );
}
