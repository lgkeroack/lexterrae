import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthLayout } from '../components/layout/AuthLayout';
import { LoginForm } from '../components/auth/LoginForm';
import { getRedirectTarget } from '../components/auth/redirect';
import { useDocumentTitle } from '../components/common/useDocumentTitle';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  useDocumentTitle('Sign in');
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  // Already signed in (or a session is being restored) → skip the form.
  if (status !== 'unauthenticated') {
    return <Navigate to={getRedirectTarget(location.state)} replace />;
  }

  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
}
