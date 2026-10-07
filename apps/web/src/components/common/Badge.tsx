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
  federal: 'bg-accent text-white border-black',
  provincial: 'bg-white text-black border-black',
  territorial: 'bg-white text-black border-black border-dashed',
  regional: 'bg-white text-black border-gray-500',
  municipal: 'bg-white text-gray-700 border-gray-400',
  indigenous: 'bg-white text-black border-gray-500 border-dotted',
};

export function Badge({ label, level, onRemove, className = '' }: BadgeProps) {
  const colorClass = level ? levelColors[level] : 'bg-white text-black border-black';

  return (
    <span
      className={`
        inline-flex items-center gap-1 border px-2 py-0.5
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
          className="ml-0.5 inline-flex items-center p-0.5
            hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-current"
          aria-label={`Remove ${label}`}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
