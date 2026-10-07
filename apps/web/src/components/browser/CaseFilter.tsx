import React, { useEffect, useId, useState } from 'react';
import { Scale, Search, X } from 'lucide-react';
import { JURISDICTION_LEVEL_LABELS, type JurisdictionSearchResult } from '@lexterrae/shared';
import { api, getErrorMessage } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { describePath } from '../../stores/jurisdictionStore';

interface CaseFilterProps {
  /** Display name of the chosen place, e.g. "Squamish, Squamish-Lillooet, British Columbia". */
  caseIn: string | undefined;
  isActive: boolean;
  onChange: (place: { id: string; label: string } | null) => void;
}

/**
 * "Applies to a case in…": choose a place to see every document that applies there. That is the
 * documents for the place itself and for every jurisdiction it is part of (its region, province
 * or territory, and Canada), but not documents for places inside it or anywhere else.
 */
export function CaseFilter({ caseIn, isActive, onChange }: CaseFilterProps) {
  const [isPicking, setIsPicking] = useState(false);
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);
  const [results, setResults] = useState<JurisdictionSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    api
      .searchJurisdictions(debounced, { limit: 8 }, controller.signal)
      .then((data) => {
        setResults(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(err, 'Search failed.'));
      });
    return () => controller.abort();
  }, [debounced]);

  const choose = (r: JurisdictionSearchResult) => {
    const where = describePath(r);
    onChange({ id: r.id, label: where ? `${r.name}, ${where}` : r.name });
    setIsPicking(false);
    setQuery('');
  };

  if (isActive) {
    return (
      <div className="flex flex-col gap-2 border border-black px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
        <p>
          <Scale className="mr-1.5 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
          Showing what applies to a case in <strong>{caseIn ?? 'the chosen place'}</strong>: its own
          documents and those of every jurisdiction it is part of (its region, province or
          territory, and Canada). Documents for places inside it or elsewhere are left out.
        </p>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="inline-flex flex-shrink-0 items-center gap-1 self-start border border-black px-2.5 py-1 text-xs hover:bg-black hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Show all documents
        </button>
      </div>
    );
  }

  if (!isPicking) {
    return (
      <button
        type="button"
        onClick={() => setIsPicking(true)}
        className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
      >
        <Scale className="h-4 w-4" aria-hidden="true" />
        What applies to a case in…?
      </button>
    );
  }

  return (
    <div className="space-y-2 border border-gray-300 p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Where is the case?
        </label>
        <button
          type="button"
          onClick={() => {
            setIsPicking(false);
            setQuery('');
          }}
          className="text-xs underline underline-offset-4 hover:no-underline"
        >
          Cancel
        </button>
      </div>
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsPicking(false);
          }}
          placeholder="A municipality, region, province or First Nation… e.g. Squamish"
          autoFocus
          className="w-full border border-gray-500 py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>
      {error && <p className="text-sm font-bold italic">{error}</p>}
      {results.length > 0 && (
        <ul className="divide-y divide-gray-200 border border-gray-200">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => choose(r)}
                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black"
              >
                <span>
                  {r.name}
                  <span className="ml-2 text-xs text-gray-500">
                    {[r.subtype, describePath(r)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="text-xs uppercase tracking-wider text-gray-500">
                  {JURISDICTION_LEVEL_LABELS[r.level]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
