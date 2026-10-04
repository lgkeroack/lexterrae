import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthLayout } from '../components/layout/AuthLayout';
import { RegisterForm } from '../components/auth/RegisterForm';
import { getRedirectTarget } from '../components/auth/redirect';
import { useDocumentTitle } from '../components/common/useDocumentTitle';
import { useAuthStore } from '../stores/authStore';

export function RegisterPage() {
  useDocumentTitle('Create account');
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status !== 'unauthenticated') {
    return <Navigate to={getRedirectTarget(location.state)} replace />;
  }

  return (
    <AuthLayout>
      <RegisterForm />
    </AuthLayout>
  );
}
