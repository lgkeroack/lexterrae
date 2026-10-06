import React from 'react';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 py-8 sm:py-12">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-6 text-center sm:mb-8">
          <div
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center border-2 border-black text-3xl font-bold leading-none"
            aria-hidden="true"
          >
            §
          </div>
          <h1 className="text-3xl font-bold tracking-wide text-black">Lex Terrae</h1>
          <p className="mx-auto mt-2 max-w-xs border-y border-black py-1 text-sm italic text-black">
            Canadian Legal Document Management
          </p>
        </div>

        {/* Card */}
        <div className="border border-black bg-white p-6 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
