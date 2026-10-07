import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAccessStore } from '../stores/accessStore';
import { SiteHeader } from '../components/layout/SiteHeader';
import { useDocumentTitle } from '../components/common/useDocumentTitle';

export function UserFacingPage() {
  useDocumentTitle('User facing');
  const { role, status, load } = useAccessStore();
  useEffect(() => {
    if (status === 'idle') void load();
  }, [status, load]);

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        {/* Home is only for users with backend access; everyone else starts here */}
        {role && (
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm underline underline-offset-4 hover:no-underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Home
          </Link>
        )}
        <h1 className="border-b border-black pb-2 text-3xl font-bold">User facing</h1>
        <p className="mt-6 text-lg italic">
          Pending. This part of Lex Terrae has not been built yet.
        </p>
      </main>
    </div>
  );
}
