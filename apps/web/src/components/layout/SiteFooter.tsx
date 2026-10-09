import React from 'react';

const WEBSITE = 'https://lgkeroack.com';

/** Footer on every page: who made it, the version and the year. */
export function SiteFooter({ className = '' }: { className?: string }) {
  return (
    <footer
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-black px-4 py-4 text-xs text-gray-600 ${className}`}
    >
      <a
        href={WEBSITE}
        target="_blank"
        rel="noopener noreferrer"
        className="underline-offset-4 hover:text-black hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        another venture by gabs
      </a>
      <span aria-hidden="true">·</span>
      <span>Version {__APP_VERSION__}</span>
      <span aria-hidden="true">·</span>
      <span>© {new Date().getFullYear()}</span>
    </footer>
  );
}
