import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Check, ChevronRight, Landmark } from 'lucide-react';
import { useJurisdictionStore } from '../../stores/jurisdictionStore';
import { PROVINCE_MAP_DATA, MAP_VIEWBOX } from '../../data/map-paths';

// Monochrome map: black = entire province selected, grey = some municipalities.
// Keyboard focus is shown by a heavier outline rather than a colour.
const COLORS = {
  unselected: '#FFFFFF',
  hover: '#D6D6D6',
  selected: '#000000',
  partial: '#8A8A8A',
  stroke: '#000000',
  strokeSelected: '#000000',
  focus: '#000000',
  civilLaw: '#EFEFEF',
  water: '#FFFFFF',
};

type ProvinceState = 'selected' | 'partial' | 'none';

interface TooltipState {
  code: string;
  x: number;
  y: number;
}

/** Checkbox that supports the "mixed" (some municipalities selected) state. */
function TriStateCheckbox({
  id,
  state,
  onChange,
}: {
  id: string;
  state: ProvinceState;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'partial';
  }, [state]);
  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={state === 'selected'}
      aria-checked={state === 'partial' ? 'mixed' : state === 'selected'}
      onChange={onChange}
      className="h-4 w-4 flex-shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
    />
  );
}

export function JurisdictionMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  /** What clicking a province does: select all of it, or open its own map to pick parts. */
  const [clickMode, setClickMode] = useState<'select' | 'zoom'>('select');

  const {
    provinces,
    selections,
    isFederalSelected,
    activeProvince,
    toggleFederal,
    toggleProvince,
    setActiveProvince,
  } = useJurisdictionStore();

  /** Selection state per province/territory code. */
  const stateByCode = useMemo(() => {
    const map = new Map<string, ProvinceState>();
    for (const s of selections) {
      if (s.level === 'provincial' || s.level === 'territorial') map.set(s.id, 'selected');
    }
    for (const s of selections) {
      if (s.parentCode && !map.has(s.parentCode)) map.set(s.parentCode, 'partial');
    }
    return map;
  }, [selections]);

  const municipalCountByCode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of selections) {
      if (s.parentCode) {
        counts.set(s.parentCode, (counts.get(s.parentCode) ?? 0) + 1);
      }
    }
    return counts;
  }, [selections]);

  const getState = useCallback(
    (code: string): ProvinceState => stateByCode.get(code) ?? 'none',
    [stateByCode],
  );

  const nameByCode = useMemo(() => {
    const m = new Map<string, string>();
    PROVINCE_MAP_DATA.forEach((p) => m.set(p.code, p.name));
    provinces.forEach((p) => m.set(p.code, p.name));
    return m;
  }, [provinces]);

  /** Positions the tooltip relative to the map container, clamped so it never overflows. */
  const placeTooltip = useCallback((code: string, clientX?: number, clientY?: number) => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;
    const cRect = container.getBoundingClientRect();
    let x: number;
    let y: number;
    if (clientX !== undefined && clientY !== undefined) {
      x = clientX - cRect.left;
      y = clientY - cRect.top;
    } else {
      // Keyboard focus: anchor at the province's label position
      const prov = PROVINCE_MAP_DATA.find((p) => p.code === code);
      const sRect = svg.getBoundingClientRect();
      if (!prov) return;
      const scale = Math.min(sRect.width / MAP_VIEWBOX.width, sRect.height / MAP_VIEWBOX.height);
      const offsetX = (sRect.width - MAP_VIEWBOX.width * scale) / 2;
      const offsetY = (sRect.height - MAP_VIEWBOX.height * scale) / 2;
      x = sRect.left - cRect.left + offsetX + prov.center[0] * scale;
      y = sRect.top - cRect.top + offsetY + prov.center[1] * scale;
    }
    const margin = 90;
    x = Math.max(margin, Math.min(cRect.width - margin, x));
    y = Math.max(40, y);
    setTooltip({ code, x, y });
  }, []);

  // Hide a stale tooltip when the map is resized (positions would be wrong)
  useEffect(() => {
    const onResize = () => setTooltip(null);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const activate = useCallback(
    (code: string) => (clickMode === 'zoom' ? setActiveProvince(code) : toggleProvince(code)),
    [clickMode, setActiveProvince, toggleProvince],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, code: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(code);
      }
    },
    [activate],
  );

  const describeState = (code: string): string => {
    const state = getState(code);
    if (state === 'selected') return 'Entire jurisdiction selected';
    if (state === 'partial') {
      const n = municipalCountByCode.get(code) ?? 0;
      return `${n} selected inside`;
    }
    return clickMode === 'zoom' ? 'Click to zoom in' : 'Not selected';
  };

  if (activeProvince) return null;

  return (
    <div className="w-full space-y-4">
      {/* Federal toggle */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <button
          type="button"
          aria-pressed={isFederalSelected}
          onClick={toggleFederal}
          className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
            isFederalSelected
              ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
              : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
          }`}
        >
          {isFederalSelected ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Landmark className="h-4 w-4" aria-hidden="true" />
          )}
          Federal (applies to all of Canada)
        </button>
        <span className="text-xs text-gray-500">
          {isFederalSelected
            ? 'Federal law selected. You can also add provinces, regions, municipalities or Indigenous lands.'
            : 'Use for federal statutes such as the Criminal Code.'}
        </span>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 text-xs"
        role="group"
        aria-label="Clicking a province"
      >
        <span className="text-gray-600">Clicking a province:</span>
        {(
          [
            ['select', 'Selects all of it'],
            ['zoom', 'Zooms in to pick regions and municipalities'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={clickMode === mode}
            onClick={() => setClickMode(mode)}
            className={`border px-2.5 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${
              clickMode === mode
                ? 'border-black bg-black text-white'
                : 'border-gray-400 hover:bg-gray-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Map */}
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden rounded-lg border bg-white ${
          isFederalSelected ? 'border-green-500 ring-2 ring-green-200' : 'border-gray-200'
        }`}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
          className="block h-auto w-full"
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="Map of Canada. Select provinces and territories."
          onMouseLeave={() => {
            setHovered(null);
            setTooltip(null);
          }}
        >
          <rect width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill={COLORS.water} />

          {PROVINCE_MAP_DATA.map((prov) => {
            const state = getState(prov.code);
            const isHover = hovered === prov.code;
            const isFocus = focused === prov.code;
            const isQC = prov.legalSystem === 'civil_law';
            const fill =
              state === 'selected'
                ? COLORS.selected
                : state === 'partial'
                  ? COLORS.partial
                  : isHover || isFocus
                    ? COLORS.hover
                    : isQC
                      ? COLORS.civilLaw
                      : COLORS.unselected;
            const name = nameByCode.get(prov.code) ?? prov.name;

            return (
              <g
                key={prov.code}
                role="checkbox"
                tabIndex={0}
                aria-checked={state === 'partial' ? 'mixed' : state === 'selected'}
                aria-label={`${name} (${prov.level === 'territorial' ? 'territory' : 'province'}). ${describeState(prov.code)}.`}
                className="cursor-pointer outline-none"
                onClick={() => activate(prov.code)}
                onKeyDown={(e) => handleKeyDown(e, prov.code)}
                onMouseMove={(e) => {
                  setHovered(prov.code);
                  placeTooltip(prov.code, e.clientX, e.clientY);
                }}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => {
                  setFocused(prov.code);
                  placeTooltip(prov.code);
                }}
                onBlur={() => {
                  setFocused(null);
                  setTooltip(null);
                }}
              >
                <path
                  d={prov.path}
                  fill={fill}
                  stroke={
                    isFocus
                      ? COLORS.focus
                      : state === 'selected'
                        ? COLORS.strokeSelected
                        : COLORS.stroke
                  }
                  strokeWidth={isFocus ? 5 : state === 'selected' ? 2 : 1}
                  strokeDasharray={prov.level === 'territorial' && !isFocus ? '5,3' : undefined}
                  strokeLinejoin="round"
                  className="transition-colors duration-150"
                />
                <text
                  x={prov.center[0]}
                  y={prov.center[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none select-none"
                  fontSize={prov.code === 'PE' ? 11 : 15}
                  fontWeight={600}
                  fill={state === 'selected' || state === 'partial' ? '#FFFFFF' : '#000000'}
                  // Halo in the province's own colour keeps labels legible over coastlines
                  stroke={fill}
                  strokeWidth={3}
                  paintOrder="stroke"
                  aria-hidden="true"
                >
                  {prov.code}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y - 12, transform: 'translate(-50%, -100%)' }}
            aria-hidden="true"
          >
            <span className="font-medium">{nameByCode.get(tooltip.code)}</span>
            <span className="block text-gray-300">{describeState(tooltip.code)}</span>
          </div>
        )}
      </div>

      {/* Legend */}
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-600" aria-label="Map legend">
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm border"
            style={{ background: COLORS.unselected, borderColor: COLORS.stroke }}
          />
          Not selected
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm border"
            style={{ background: COLORS.selected, borderColor: COLORS.strokeSelected }}
          />
          Entire province/territory
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm border"
            style={{ background: COLORS.partial, borderColor: COLORS.stroke }}
          />
          Part selected
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm border border-dashed"
            style={{ background: COLORS.unselected, borderColor: COLORS.stroke }}
          />
          Territory
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm border"
            style={{ background: COLORS.civilLaw, borderColor: COLORS.stroke }}
          />
          Civil law (Quebec)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border-2 border-green-500 bg-white" />
          Federal selected
        </li>
      </ul>

      <p className="text-xs text-gray-500">
        Click a province or territory (or Tab to it and press Enter/Space) to select all of it. To
        pick a region, municipality or First Nation, search above or use{' '}
        <span className="font-medium">Browse</span> in the list below.
      </p>

      {/* Non-map alternative */}
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-gray-900">
          Provinces and territories
        </legend>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {provinces.map((p) => {
            const state = getState(p.code);
            const muniCount = municipalCountByCode.get(p.code) ?? 0;
            const inputId = `jurisdiction-${p.code}`;
            return (
              <li
                key={p.code}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                  state !== 'none' ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <TriStateCheckbox
                  id={inputId}
                  state={state}
                  onChange={() => toggleProvince(p.code)}
                />
                <label
                  htmlFor={inputId}
                  className="min-w-0 flex-1 cursor-pointer truncate text-sm text-gray-900"
                >
                  {p.name}
                  {p.level === 'territorial' && (
                    <span className="ml-1 text-xs text-gray-400">(territory)</span>
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => setActiveProvince(p.code)}
                  aria-label={`Browse regions, municipalities and Indigenous lands in ${p.name}${muniCount ? ` (${muniCount} selected)` : ''}`}
                  className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Browse{muniCount > 0 ? ` (${muniCount})` : ''}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </div>
  );
}
