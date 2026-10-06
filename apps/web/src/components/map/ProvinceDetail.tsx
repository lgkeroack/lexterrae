import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { JURISDICTION_LEVEL_LABELS, type JurisdictionLevel } from '@lexterrae/shared';
import { useJurisdictionStore } from '../../stores/jurisdictionStore';
import { Button } from '../common/Button';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { AddJurisdictionDialog } from './AddJurisdictionDialog';
import { ProvinceMap } from './ProvinceMap';

type LevelFilter = 'all' | Extract<JurisdictionLevel, 'regional' | 'municipal' | 'indigenous'>;

const FILTERS: LevelFilter[] = ['all', 'regional', 'municipal', 'indigenous'];

/** Rows rendered at once; a search narrows the rest (Quebec alone has over 1,200). */
const MAX_ROWS = 250;

// Accent-insensitive match so "montreal" finds "Montréal"
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function ProvinceDetail() {
  const {
    activeProvince,
    provinces,
    contents,
    selections,
    setActiveProvince,
    toggleJurisdiction,
    toggleEntireProvince,
    loadProvinceContents,
  } = useJurisdictionStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [isAdding, setIsAdding] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const province = useMemo(
    () => provinces.find((p) => p.code === activeProvince),
    [provinces, activeProvince],
  );
  const loaded = activeProvince ? contents[activeProvince] : undefined;

  // Move focus into the drill-down view so keyboard/screen-reader users know where they are.
  useEffect(() => {
    setSearchQuery('');
    setFilter('all');
    headingRef.current?.focus();
  }, [activeProvince]);

  const isEntireProvinceSelected = selections.some(
    (s) => (s.level === 'provincial' || s.level === 'territorial') && s.id === activeProvince,
  );
  const selectedCodes = useMemo(() => new Set(selections.map((s) => s.id)), [selections]);
  const selectedCount = selections.filter((s) => s.parentCode === activeProvince).length;

  const counts = useMemo(() => {
    const c: Record<LevelFilter, number> = { all: 0, regional: 0, municipal: 0, indigenous: 0 };
    for (const item of loaded?.items ?? []) {
      c.all++;
      if (item.level in c) c[item.level as LevelFilter]++;
    }
    return c;
  }, [loaded]);

  const filtered = useMemo(() => {
    const q = normalize(searchQuery.trim());
    return (loaded?.items ?? []).filter(
      (item) =>
        (filter === 'all' || item.level === filter) &&
        (!q ||
          normalize(
            `${item.name} ${item.subtype ?? ''} ${item.path.map((p) => p.name).join(' ')}`,
          ).includes(q)),
    );
  }, [loaded, filter, searchQuery]);

  if (!activeProvince || !province) return null;

  const goBack = () => {
    const code = province.code;
    setActiveProvince(null);
    // Return focus to the province's row in the list once the map re-renders
    requestAnimationFrame(() => document.getElementById(`jurisdiction-${code}`)?.focus());
  };

  const kind = province.level === 'territorial' ? 'territory' : 'province';

  return (
    <div className="w-full">
      <div className="mb-4">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1 px-2 py-1 text-sm text-gray-700 hover:underline focus:outline-none focus:ring-2 focus:ring-black"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to map
        </button>
      </div>

      <div className="border border-gray-300 bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3
              ref={headingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-gray-900 focus:outline-none"
            >
              {province.name}
            </h3>
            <p className="text-sm text-gray-500">
              {kind === 'territory' ? 'Territory' : 'Province'} &middot;{' '}
              {province.legalSystem === 'civil_law' ? 'Civil Law' : 'Common Law'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a jurisdiction
            </Button>
            <Button
              type="button"
              variant={isEntireProvinceSelected ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={isEntireProvinceSelected}
              onClick={() => toggleEntireProvince(province.code)}
            >
              {isEntireProvinceSelected ? `Entire ${kind} selected` : `Select entire ${kind}`}
            </Button>
          </div>
        </div>

        <div className="mb-4">
          <ProvinceMap
            provinceCode={province.code}
            provinceName={province.name}
            items={loaded?.status === 'loaded' ? loaded.items : []}
            disabled={isEntireProvinceSelected}
          />
        </div>

        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Show level">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`border px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${
                filter === f
                  ? 'border-black bg-black text-white'
                  : 'border-gray-400 hover:bg-gray-100'
              }`}
            >
              {f === 'all' ? 'All' : JURISDICTION_LEVEL_LABELS[f]}
              {loaded?.status === 'loaded' && ` (${counts[f]})`}
            </button>
          ))}
        </div>

        <div className="relative mb-3">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label={`Filter jurisdictions in ${province.name}`}
            placeholder={`Filter ${province.name} by name, type or region…`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            // Enter in this field must not submit the surrounding upload form
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            className="w-full border border-gray-500 py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <fieldset>
          <legend className="sr-only">Jurisdictions in {province.name}</legend>
          <div className="max-h-80 overflow-y-auto">
            {!loaded || loaded.status === 'loading' ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
                <LoadingSpinner size="sm" />
                Loading jurisdictions in {province.name}…
              </div>
            ) : loaded.status === 'error' ? (
              <div className="space-y-2 py-4 text-center text-sm">
                <p className="font-bold italic">{loaded.error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadProvinceContents(province.code, true)}
                >
                  Try again
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">
                {searchQuery ? 'Nothing matches your filter.' : 'Nothing listed at this level.'}{' '}
                <button
                  type="button"
                  onClick={() => setIsAdding(true)}
                  className="underline underline-offset-4"
                >
                  Add a jurisdiction
                </button>
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filtered.slice(0, MAX_ROWS).map((item) => {
                  const isChecked = isEntireProvinceSelected || selectedCodes.has(item.code);
                  // Regions (and their regions) between the province and this item
                  const within = item.path
                    .filter((p) => p.code !== province.code)
                    .map((p) => p.name)
                    .join(', ');
                  return (
                    <li key={item.id}>
                      <label
                        className={`flex items-start gap-3 px-3 py-2 transition-colors ${
                          isEntireProvinceSelected
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer hover:bg-gray-50'
                        } ${isChecked ? 'bg-gray-100' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isEntireProvinceSelected}
                          onChange={() => toggleJurisdiction(item)}
                          className="mt-1 h-4 w-4 flex-shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-900">
                            {item.name}
                            {item.isCustom && (
                              <span className="ml-2 text-xs italic text-gray-500">
                                added by you
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-gray-500">
                            {[item.subtype ?? JURISDICTION_LEVEL_LABELS[item.level], within]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {filtered.length > MAX_ROWS && (
            <p className="mt-2 text-xs text-gray-500">
              Showing {MAX_ROWS} of {filtered.length.toLocaleString()}. Type to narrow the list.
            </p>
          )}
        </fieldset>

        <p className="mt-3 text-xs text-gray-500" aria-live="polite">
          {isEntireProvinceSelected
            ? `The entire ${kind} is selected, which includes everything in it. Deselect it to choose individual jurisdictions.`
            : selectedCount > 0
              ? `${selectedCount} selected in ${province.name}.`
              : `Select regions, municipalities or Indigenous lands, or the entire ${kind}.`}
        </p>

        <div className="mt-4 flex justify-end">
          <Button type="button" size="sm" onClick={goBack}>
            Done
          </Button>
        </div>
      </div>

      <AddJurisdictionDialog
        isOpen={isAdding}
        onClose={() => setIsAdding(false)}
        initialName={searchQuery.trim()}
        initialProvinceCode={province.code}
      />
    </div>
  );
}
