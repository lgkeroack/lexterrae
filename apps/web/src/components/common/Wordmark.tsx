import React from 'react';

/** The app's name as a wordmark, set in Highcrest. */
export function Wordmark({ className = 'text-2xl' }: { className?: string }) {
  return (
    <span className={`font-brand font-normal leading-none text-black ${className}`}>
      Lex terrae
    </span>
  );
}
