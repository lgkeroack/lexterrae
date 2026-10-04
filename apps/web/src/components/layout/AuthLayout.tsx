import React from 'react';
import { MapPin } from 'lucide-react';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8 sm:py-12">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-6 text-center sm:mb-8">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600">
            <MapPin className="h-7 w-7 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Lex Terrae</h1>
          <p className="mt-1 text-sm text-gray-600">Canadian Legal Document Management</p>
        </div>

        {/* Card */}
        <div className="rounded-lg bg-white p-6 shadow-md sm:p-8">{children}</div>
      </div>
    </main>
  );
}
