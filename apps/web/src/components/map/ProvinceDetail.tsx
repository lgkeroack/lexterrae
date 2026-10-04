import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { useJurisdictionStore } from '../../stores/jurisdictionStore';
import { Button } from '../common/Button';

export function ProvinceDetail() {
  const {
    activeProvince,
    provinces,
    selections,
    setActiveProvince,
    toggleMunicipality,
    toggleEntireProvince,
  } = useJurisdictionStore();

  const [searchQuery, setSearchQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const province = useMemo(
    () => provinces.find((p) => p.code === activeProvince),
    [provinces, activeProvince]
  );

  // Move focus into the drill-down view so keyboard/screen-reader users know where they are.
  useEffect(() => {
    setSearchQuery('');
    headingRef.current?.focus();
  }, [activeProvince]);

  const isEntireProvinceSelected = useMemo(
    () =>
      selections.some(
        (s) =>
          (s.level === 'provincial' || s.level === 'territorial') &&
          s.id === activeProvince
      ),
    [selections, activeProvince]
  );

  const selectedMunicipalityCodes = useMemo(() => {
    const codes = new Set<string>();
    selections.forEach((s) => {
      if (s.level === 'municipal' && s.parentCode === activeProvince) {
        codes.add(s.id);
      }
    });
    return codes;
  }, [selections, activeProvince]);

  const filteredMunicipalities = useMemo(() => {
    if (!province) return [];
    // Accent-insensitive match so "montreal" finds "Montréal"
    const normalize = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const q = normalize(searchQuery.trim());
    return province.municipalities.filter((m) => normalize(m.name).includes(q));
  }, [province, searchQuery]);

  if (!activeProvince || !province) return null;

  const goBack = () => {
    const code = province.code;
    setActiveProvince(null);
    // Return focus to the province's row in the list once the map re-renders
    requestAnimationFrame(() => document.getElementById(`jurisdiction-${code}`)?.focus());
  };

  const kind = province.level === 'territorial' ? 'territory' : 'province';
  const selectedCount = selectedMunicipalityCodes.size;

  return (
    <div className="w-full">
      <div className="mb-4">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to map
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
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

        {/* Municipality search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            aria-label={`Search municipalities in ${province.name}`}
            placeholder="Search municipalities..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            // Enter in this field must not submit the surrounding upload form
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Municipalities list */}
        <fieldset>
          <legend className="sr-only">Municipalities in {province.name}</legend>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {filteredMunicipalities.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">
                {searchQuery
                  ? 'No municipalities match your search.'
                  : 'No municipalities available.'}
              </p>
            ) : (
              filteredMunicipalities.map((muni) => {
                const isChecked =
                  isEntireProvinceSelected ||
                  selectedMunicipalityCodes.has(muni.code);

                return (
                  <label
                    key={muni.code}
                    className={`
                      flex items-center gap-3 rounded-md px-3 py-2 transition-colors
                      ${isEntireProvinceSelected ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}
                      ${isChecked ? 'bg-blue-50' : ''}
                    `}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isEntireProvinceSelected}
                      onChange={() => toggleMunicipality(province.code, muni)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-900">{muni.name}</span>
                  </label>
                );
              })
            )}
          </div>
        </fieldset>

        <p className="mt-3 text-xs text-gray-500" aria-live="polite">
          {isEntireProvinceSelected
            ? `The entire ${kind} is selected, which includes all of its municipalities. Deselect it to choose individual municipalities.`
            : selectedCount > 0
              ? `${selectedCount} municipalit${selectedCount === 1 ? 'y' : 'ies'} selected in ${province.name}.`
              : 'Select one or more municipalities, or the entire ' + kind + '.'}
        </p>

        <div className="mt-4 flex justify-end">
          <Button type="button" size="sm" onClick={goBack}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
