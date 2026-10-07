import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { SiteHeader } from '../components/layout/SiteHeader';
import { useDocumentTitle } from '../components/common/useDocumentTitle';

const sections = [
  {
    to: '/user-facing',
    title: 'User facing',
    description: 'The public side of Lex Terrae.',
    note: 'Pending',
  },
  {
    to: '/documents',
    title: 'Backend',
    description: 'Document management: upload, tag and find laws by jurisdiction.',
  },
];

export function HomePage() {
  useDocumentTitle('Home');
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <h1 className="border-b border-black pb-2 text-3xl font-bold">Home</h1>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                className="group flex h-full flex-col border-2 border-black p-6 hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                <span className="flex items-center justify-between gap-2 text-2xl font-bold">
                  {s.title}
                  <ArrowRight className="h-6 w-6 flex-shrink-0" aria-hidden="true" />
                </span>
                <span className="mt-2 text-sm">{s.description}</span>
                {s.note && (
                  <span className="mt-4 self-start border border-current px-2 py-0.5 text-xs uppercase tracking-wider">
                    {s.note}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
