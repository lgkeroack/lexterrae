import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';

// Fetched once per page load; the answer only changes when the server is reconfigured
let providersPromise: Promise<boolean> | null = null;
function isGoogleEnabled(): Promise<boolean> {
  providersPromise ??= api
    .getAuthProviders()
    .then((p) => p.google)
    .catch(() => {
      providersPromise = null;
      return false;
    });
  return providersPromise;
}

/** Messages for /login?error=<reason>, set by the server's Google callback. */
const GOOGLE_ERRORS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  account_exists:
    'An account with this email already exists. Sign in with your email and password instead.',
  unverified_email: 'Your Google email address is not verified, so it cannot be used to sign in.',
  disabled: 'Sign in with Google is not available.',
  failed: 'Google sign-in failed. Please try again.',
};

export function googleErrorMessage(reason: string | null): string | null {
  if (!reason) return null;
  return GOOGLE_ERRORS[reason] ?? GOOGLE_ERRORS['failed']!;
}

/** "Continue with Google", shown only when the server has Google sign-in configured. */
export function GoogleSignIn() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void isGoogleEnabled().then((on) => {
      if (active) setEnabled(on);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-gray-500">
        <span className="h-px flex-1 bg-gray-300" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-gray-300" aria-hidden="true" />
      </div>
      {/* A full-page navigation: the server redirects to Google and back */}
      <a
        href="/api/auth/google/start"
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-400 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <span className="text-base font-bold leading-none" aria-hidden="true">
          G
        </span>
        Continue with Google
      </a>
    </div>
  );
}
