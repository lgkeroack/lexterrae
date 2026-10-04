import React from 'react';
import { X } from 'lucide-react';
import type { JurisdictionLevel } from '@lexterrae/shared';

interface BadgeProps {
  label: string;
  level?: JurisdictionLevel;
  onRemove?: () => void;
  className?: string;
}

const levelColors: Record<JurisdictionLevel, string> = {
  federal: 'bg-green-100 text-green-800 border-green-200',
  provincial: 'bg-blue-100 text-blue-800 border-blue-200',
  territorial: 'bg-blue-100 text-blue-800 border-blue-200',
  municipal: 'bg-gray-100 text-gray-800 border-gray-200',
};

export function Badge({ label, level, onRemove, className = '' }: BadgeProps) {
  const colorClass = level
    ? levelColors[level]
    : 'bg-gray-100 text-gray-800 border-gray-200';

  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5
        text-xs font-medium ${colorClass} ${className}
      `.trim()}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 inline-flex items-center rounded-full p-0.5
            hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label={`Remove ${label}`}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
