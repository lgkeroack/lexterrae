import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useUndoStore } from '../../stores/undoStore';

/** How long the notice stays up after the last action (it stays while hovered or focused). */
const VISIBLE_MS = 12_000;

/** "Selected Peel · Undo": the way back from the most recent change, on every page. */
export function UndoToast() {
  const { current, isUndoing, error, undo, dismiss } = useUndoStore();
  const [paused, setPaused] = React.useState(false);

  useEffect(() => {
    if (!current || paused || isUndoing || error) return;
    const timer = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, paused, isUndoing, error, dismiss]);

  if (!current) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-lg items-center gap-3 border-2 border-black bg-white px-4 py-3 text-sm sm:inset-x-auto sm:right-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="min-w-0 flex-1">
        {error ? <span className="font-bold italic">{error}</span> : current.message}
      </span>
      <button
        type="button"
        onClick={() => void undo()}
        disabled={isUndoing}
        className="flex-shrink-0 border border-black px-3 py-1 font-semibold hover:bg-black hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:opacity-50"
      >
        {isUndoing ? 'Undoing…' : error ? 'Try again' : 'Undo'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 p-1 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
