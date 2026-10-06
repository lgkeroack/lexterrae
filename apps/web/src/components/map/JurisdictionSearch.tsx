import React, { useEffect, useId, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { JURISDICTION_LEVEL_LABELS, type JurisdictionSearchResult } from '@lexterrae/shared';
import { api, getErrorMessage } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { describePath, provinceOf, useJurisdictionStore } from '../../stores/jurisdictionStore';
import { AddJurisdictionDialog } from './AddJurisdictionDialog';

const MIN_QUERY = 2;

/** Search every jurisdiction in Canada by name and add it to the document's selections. */
export function JurisdictionSearch() {
  const { selections, toggleJurisdiction, deleteCustomJurisdiction } = useJurisdictionStore();
  const removeCustom = async (item: JurisdictionSearchResult) => {
    setError(null);
    try {
      await deleteCustomJurisdiction(item);
      setResults((rs) => rs.filter((r) => r.id !== item.id));
    } catch (err) {
      setError(getErrorMessage(err, `Could not delete ${item.name}.`));
      setStatus('error');
    }
  };
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);
  const [results, setResults] = useState<JurisdictionSearchResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const inputId = useId();
  const resultsId = useId();

  useEffect(() => {
    if (debounced.length < MIN_QUERY) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    api
      .searchJurisdictions(debounced, { limit: 12 }, controller.signal)
      .then((data) => {
        setResults(data);
        setStatus('done');
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(getErrorMessage(err, 'Search failed.'));
        setStatus('error');
      });
    return () => controller.abort();
  }, [debounced]);

  const selectedCodes = new Set(selections.map((s) => s.id));
  const selectedProvinces = new Set(
    selections
      .filter((s) => s.level === 'provincial' || s.level === 'territorial')
      .map((s) => s.id),
  );

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-900">
        Search all jurisdictions
      </label>
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
          // Enter here must not submit the surrounding upload form
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
          placeholder="City, county, regional district, First Nation… e.g. Peel, Saint-Jérôme, Musqueam"
          aria-describedby={`${resultsId}-status`}
          className="w-full border border-gray-500 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>

      <p id={`${resultsId}-status`} className="sr-only" aria-live="polite">
        {status === 'done' ? `${results.length} results` : ''}
      </p>

      {status === 'error' && <p className="text-sm font-bold italic">{error}</p>}

      {debounced.length >= MIN_QUERY && status !== 'error' && (
        <div className="border border-gray-300">
          {status === 'loading' && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-600">No jurisdictions match “{debounced}”.</p>
          ) : (
            <ul id={resultsId} className="max-h-72 divide-y divide-gray-200 overflow-y-auto">
              {results.map((r) => {
                const province = provinceOf(r);
                const included =
                  province !== null &&
                  province.code !== r.code &&
                  selectedProvinces.has(province.code);
                const selected = selectedCodes.has(r.code);
                const where = describePath(r);
                return (
                  <li key={r.id} className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => toggleJurisdiction(r)}
                      disabled={included}
                      aria-pressed={selected || included}
                      className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2 text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black disabled:cursor-not-allowed disabled:hover:bg-white"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center border ${
                          selected || included
                            ? 'border-black bg-black text-white'
                            : 'border-gray-500'
                        }`}
                        aria-hidden="true"
                      >
                        {(selected || included) && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-black">
                          {r.name}
                          {r.isCustom && (
                            <span className="ml-2 text-xs italic text-gray-500">added by you</span>
                          )}
                        </span>
                        <span className="block text-xs text-gray-600">
                          {[r.subtype ?? JURISDICTION_LEVEL_LABELS[r.level], where]
                            .filter(Boolean)
                            .join(' · ')}
                          {included && ` · included (all of ${province!.name} is selected)`}
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-xs uppercase tracking-wider text-gray-500">
                        {JURISDICTION_LEVEL_LABELS[r.level]}
                      </span>
                    </button>
                    {r.isCustom && (
                      <button
                        type="button"
                        onClick={() => void removeCustom(r)}
                        aria-label={`Delete ${r.name} (added by you)`}
                        className="flex-shrink-0 border-l border-gray-200 px-3 text-xs hover:bg-black hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black"
                      >
                        Delete
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-gray-300 px-3 py-2">
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="inline-flex items-center gap-1 text-sm underline underline-offset-4 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Can&apos;t find it? Add “{debounced}” as a new jurisdiction
            </button>
          </div>
        </div>
      )}

      <AddJurisdictionDialog
        isOpen={isAdding}
        onClose={() => setIsAdding(false)}
        initialName={debounced}
        onCreated={() => setQuery('')}
      />
    </div>
  );
}
