import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { PasswordInput } from '../common/PasswordInput';
import { useAuthStore } from '../../stores/authStore';
import { getRedirectTarget } from './redirect';
import { GoogleSignIn, googleErrorMessage } from './GoogleSignIn';

export function LoginForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading, error: storeError, clearError } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const errorRef = useRef<HTMLDivElement>(null);
  // Set by the server when Google sign-in fails (/login?error=<reason>)
  const [searchParams] = useSearchParams();
  const googleError = googleErrorMessage(searchParams.get('error'));
  const shownError = storeError ?? googleError;

  // Clear stale errors from a previous visit (e.g. after logging out).
  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (shownError) errorRef.current?.focus();
  }, [shownError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = 'Email is required.';
    if (!password) errors.password = 'Password is required.';
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      document.getElementById(errors.email ? 'login-email' : 'login-password')?.focus();
      return;
    }

    try {
      await login({ email: email.trim(), password });
      navigate(getRedirectTarget(location.state), { replace: true });
    } catch {
      // Error message is set by the store
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate aria-busy={isLoading}>
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Sign in</h2>
        <p className="mt-1 text-sm text-gray-600">
          Enter your credentials to access your documents.
        </p>
      </div>

      {shownError && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 focus:outline-none"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-sm text-red-700">{shownError}</p>
        </div>
      )}

      <Input
        id="login-email"
        label="Email"
        type="email"
        inputMode="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
        }}
        placeholder="you@example.com"
        required
        autoComplete="email"
        autoFocus
        error={fieldErrors.email}
      />

      <PasswordInput
        id="login-password"
        label="Password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
        }}
        placeholder="Enter your password"
        required
        autoComplete="current-password"
        error={fieldErrors.password}
      />

      <Button type="submit" className="w-full" isLoading={isLoading}>
        {isLoading ? 'Signing in…' : 'Sign in'}
      </Button>

      <GoogleSignIn />

      <p className="text-center text-sm text-gray-600">
        Don&apos;t have an account?{' '}
        <Link
          to="/register"
          state={location.state}
          className="rounded font-medium text-blue-700 hover:text-blue-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
