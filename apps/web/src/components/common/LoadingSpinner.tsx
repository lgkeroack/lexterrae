import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Accessible label announced to screen readers. */
  label?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  // Note: Tailwind has no `border-3` by default; `border-4` keeps the lg spinner visible.
  lg: 'h-12 w-12 border-4',
};

export function LoadingSpinner({
  size = 'md',
  className = '',
  label = 'Loading',
}: LoadingSpinnerProps) {
  return (
    <div role="status" className={`inline-flex ${className}`.trim()}>
      <div
        className={`animate-spin rounded-full border-accent border-t-transparent ${sizeClasses[size]}`}
        aria-hidden="true"
      />
      <span className="sr-only">{label}…</span>
    </div>
  );
}
