import React from 'react';

/** A small on/off switch with a visible label. */
export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Accessible name when the visible label alone is ambiguous (e.g. which document). */
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={description}
      onClick={() => onChange(!checked)}
      className="inline-flex flex-shrink-0 items-center gap-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className={`relative inline-block h-4 w-7 rounded-full border transition-colors ${
          checked ? 'border-accent bg-accent' : 'border-gray-400 bg-gray-200'
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow-none transition-[left] ${
            checked ? 'left-[0.875rem]' : 'left-0.5'
          }`}
        />
      </span>
      <span className={checked ? 'text-black' : 'text-gray-600'}>{label}</span>
    </button>
  );
}
