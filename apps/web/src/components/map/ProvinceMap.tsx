import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { geoArea, geoCentroid, geoConicConformal, geoPath, select, zoom, zoomIdentity } from 'd3';
import type { ZoomBehavior } from 'd3';
import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { JurisdictionSearchResult } from '@lexterrae/shared';
import { loadProvinceMap, type ProvinceTopology, type ShapeProps } from '../../data/provinceMaps';
import { useJurisdictionStore } from '../../stores/jurisdictionStore';
import { LoadingSpinner } from '../common/LoadingSpinner';

type Layer = 'regions' | 'local';
type Shape = Feature<Polygon | MultiPolygon, ShapeProps>;

const WIDTH = 800;
const MAX_HEIGHT = 560;
/**
 * Shapes smaller than this on screen (px) are too small to outline: once zoomed in (or when
 * selected) they show as a dot, otherwise they're left out so the map stays clean.
 */
const MIN_VISIBLE_PX = 6;
const DOT_RADIUS_PX = 2.5;
const DOTS_FROM_ZOOM = 2;

const LEVEL_NAMES = { r: 'Regional', m: 'Municipal', i: 'Indigenous' } as const;

interface ProvinceMapProps {
  provinceCode: string;
  provinceName: string;
  /** Everything in the province, from the API (to select a clicked shape). */
  items: JurisdictionSearchResult[];
  /** The whole province is selected, so its parts can't be picked individually. */
  disabled: boolean;
}

/**
 * Zoomable map of one province or territory. Click a region, municipality or Indigenous land
 * to select it; drag to pan, scroll or use the buttons to zoom. The list below the map is the
 * keyboard-accessible way to do the same.
 */
export function ProvinceMap({ provinceCode, provinceName, items, disabled }: ProvinceMapProps) {
  const { selections, toggleJurisdiction } = useJurisdictionStore();
  const [topo, setTopo] = useState<ProvinceTopology | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>('regions');
  const [hover, setHover] = useState<{ shape: Shape; x: number; y: number } | null>(null);
  /** Current zoom, so labels keep the same on-screen size. */
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>();

  useEffect(() => {
    let active = true;
    setTopo(null);
    setError(null);
    loadProvinceMap(provinceCode)
      .then((data) => {
        if (!active) return;
        setTopo(data);
        // Start on regions where the province has regional governments, else municipalities
        const hasRegions = data.objects.regions.geometries.some(
          (g) => (g.properties as ShapeProps | undefined)?.c,
        );
        setLayer(hasRegions ? 'regions' : 'local');
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Map not available');
      });
    return () => {
      active = false;
    };
  }, [provinceCode]);

  const { shapes, height, paths, sizes, labelAnchors } = useMemo(() => {
    if (!topo) {
      return {
        shapes: [] as Shape[],
        height: 400,
        paths: [] as string[],
        sizes: [] as { extent: number; x: number; y: number }[],
        labelAnchors: new Map<string, { name: string; x: number; y: number }>(),
      };
    }
    const all = feature(topo, topo.objects.local) as FeatureCollection<
      Polygon | MultiPolygon,
      ShapeProps
    >;
    const current = feature(topo, topo.objects[layer]) as FeatureCollection<
      Polygon | MultiPolygon,
      ShapeProps
    >;
    // Guard: a ring wound the wrong way would cover the whole globe and wreck the fit
    for (const f of [...all.features, ...current.features]) {
      if (geoArea(f) > 2 * Math.PI) {
        const g = f.geometry;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        for (const rings of polys) rings.forEach((ring) => ring.reverse());
      }
    }
    // Same Lambert conformal conic as the national map, centred on this province
    const [lon] = geoCentroid(all);
    const projection = geoConicConformal()
      .parallels([49, 77])
      .rotate([-lon, 0])
      .fitWidth(WIDTH - 16, all);
    const path = geoPath(projection);
    const [[, y0], [, y1]] = path.bounds(all);
    let h = Math.ceil(y1 - y0 + 16);
    if (h > MAX_HEIGHT) {
      projection.fitExtent(
        [
          [8, 8],
          [WIDTH - 8, MAX_HEIGHT - 8],
        ],
        all,
      );
      h = MAX_HEIGHT;
    } else {
      const [tx, ty] = projection.translate();
      projection.translate([tx + 8, ty - y0 + 8]);
    }
    // Where to label each jurisdiction (either layer): the centre of its largest piece, so an
    // area made of islands or split parts gets one label in a sensible place
    const regions = feature(topo, topo.objects.regions) as FeatureCollection<
      Polygon | MultiPolygon,
      ShapeProps
    >;
    const labelAnchors = new Map<string, { name: string; x: number; y: number }>();
    for (const f of [...regions.features, ...all.features]) {
      const code = f.properties.c;
      if (!code || labelAnchors.has(code)) continue;
      const parts =
        f.geometry.type === 'Polygon'
          ? [f.geometry.coordinates]
          : (f.geometry.coordinates as Polygon['coordinates'][]);
      let best: { area: number; x: number; y: number } | undefined;
      for (const coordinates of parts) {
        const piece = { type: 'Polygon' as const, coordinates };
        const area = path.area(piece);
        if (!best || area > best.area) {
          const [x, y] = path.centroid(piece);
          if (Number.isFinite(x) && Number.isFinite(y)) best = { area, x, y };
        }
      }
      if (best) labelAnchors.set(code, { name: f.properties.n, x: best.x, y: best.y });
    }
    const [cx, cy] = path.centroid(all);
    labelAnchors.set('__province__', { name: '', x: cx, y: cy });

    // Size of each shape on screen at 1× zoom, and where to put its dot when it's too small to see
    const sizes = current.features.map((f) => {
      const [[x0, y0b], [x1, y1b]] = path.bounds(f);
      const anchor = f.properties.c ? labelAnchors.get(f.properties.c) : undefined;
      const [px, py] = anchor ? [anchor.x, anchor.y] : path.centroid(f);
      return { extent: Math.max(x1 - x0, y1b - y0b), x: px, y: py };
    });

    return {
      shapes: current.features,
      height: h,
      paths: current.features.map((f) => path(f) ?? ''),
      sizes,
      labelAnchors,
    };
  }, [topo, layer]);

  // Pan and zoom (a short drag still counts as a click)
  useEffect(() => {
    if (!svgRef.current || !groupRef.current) return;
    const group = select(groupRef.current);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 60])
      // The province can't be panned out of view, so there is always something to come back to
      .translateExtent([
        [0, 0],
        [WIDTH, height],
      ])
      .clickDistance(4)
      .on('zoom', (event: { transform: { k: number; toString(): string } }) => {
        group.attr('transform', event.transform.toString());
        setScale(event.transform.k);
        setHover(null);
      });
    zoomRef.current = behavior;
    const svg = select(svgRef.current).call(behavior);
    svg.call(behavior.transform, zoomIdentity);
    return () => {
      svg.on('.zoom', null);
    };
  }, [topo, height]);

  const zoomBy = (factor: number) => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, factor);
    }
  };
  const resetZoom = () => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current)
        .transition()
        .duration(200)
        .call(zoomRef.current.transform, zoomIdentity);
    }
  };

  const itemsByCode = useMemo(() => new Map(items.map((i) => [i.code, i])), [items]);
  const selected = useMemo(() => new Set(selections.map((s) => s.id)), [selections]);
  const counts = useMemo(() => {
    if (!topo) return { regions: 0, local: 0 };
    return {
      regions: topo.objects.regions.geometries.filter(
        (g) => (g.properties as ShapeProps | undefined)?.c,
      ).length,
      local: topo.objects.local.geometries.filter(
        (g) => (g.properties as ShapeProps | undefined)?.c,
      ).length,
    };
  }, [topo]);

  const pick = (shape: Shape) => {
    const item = shape.properties.c ? itemsByCode.get(shape.properties.c) : undefined;
    if (item && !disabled) toggleJurisdiction(item);
  };

  const showTooltip = (shape: Shape, e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setHover({ shape, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  if (error) {
    return <p className="py-2 text-sm text-gray-500">The map of {provinceName} is unavailable.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Map layer">
          {(
            [
              ['regions', `Regions${counts.regions ? ` (${counts.regions})` : ''}`],
              ['local', 'Municipalities & Indigenous lands'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={layer === value}
              onClick={() => setLayer(value)}
              disabled={value === 'regions' && topo !== null && counts.regions === 0}
              className={`border px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                layer === value
                  ? 'border-accent bg-accent text-white'
                  : 'border-gray-400 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[
            { label: 'Zoom in', icon: Plus, onClick: () => zoomBy(2) },
            { label: 'Zoom out', icon: Minus, onClick: () => zoomBy(0.5) },
            { label: 'Reset zoom', icon: RotateCcw, onClick: resetZoom },
          ].map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              aria-label={label}
              title={label}
              className="border border-gray-400 p-1.5 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="relative overflow-hidden border border-gray-300 bg-white">
        {!topo ? (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-gray-500">
            <LoadingSpinner size="sm" />
            Loading the map of {provinceName}…
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${height}`}
            className="block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
            role="img"
            aria-label={`Map of ${provinceName}. Click an area to select it; drag to pan and scroll to zoom. The list below offers the same choices by keyboard.`}
            onMouseLeave={() => setHover(null)}
          >
            <g ref={groupRef}>
              {(() => {
                const fillOf = (linked: boolean, isSelected: boolean, isHover: boolean) =>
                  !linked
                    ? '#F2F2F2'
                    : isSelected
                      ? isHover
                        ? 'rgba(10, 54, 120, 0.5)'
                        : 'rgba(10, 54, 120, 0.3)'
                      : isHover
                        ? '#D6D6D6'
                        : '#FFFFFF';
                const outlines: React.ReactNode[] = [];
                const dots: React.ReactNode[] = [];
                // Largest first, so a small enclave is drawn on top of the area around it
                const order = shapes
                  .map((_, i) => i)
                  .sort((a, b) => sizes[b]!.extent - sizes[a]!.extent);
                order.forEach((i) => {
                  const shape = shapes[i]!;
                  const code = shape.properties.c;
                  const linked = Boolean(code && itemsByCode.has(code));
                  const isSelected = disabled || (code ? selected.has(code) : false);
                  const isHover = hover?.shape === shape;
                  const common = {
                    stroke: linked ? '#000000' : '#BDBDBD',
                    strokeWidth: (isHover || isSelected) && linked ? 1.2 : 0.6,
                    vectorEffect: 'non-scaling-stroke' as const,
                    className: linked && !disabled ? 'cursor-pointer' : undefined,
                    onClick: () => pick(shape),
                    onMouseMove: (e: React.MouseEvent) => showTooltip(shape, e),
                  };
                  const size = sizes[i]!;
                  if (size.extent * scale >= MIN_VISIBLE_PX) {
                    outlines.push(
                      <path
                        key={`${layer}-${i}`}
                        d={paths[i]}
                        // Translucent selection keeps the borders inside a selected area visible
                        fill={fillOf(linked, isSelected, isHover)}
                        strokeLinejoin="round"
                        {...common}
                      />,
                    );
                  } else if (linked && (isSelected || scale >= DOTS_FROM_ZOOM)) {
                    // Too small to outline at this zoom: a dot, drawn on top so it stays clickable
                    dots.push(
                      <circle
                        key={`${layer}-${i}`}
                        cx={size.x}
                        cy={size.y}
                        r={DOT_RADIUS_PX / scale}
                        fill={isSelected ? '#0A3678' : isHover ? '#D6D6D6' : '#FFFFFF'}
                        {...common}
                      />,
                    );
                  }
                  // Unselectable specks (no jurisdiction) are left out until they're big enough
                });
                return (
                  <>
                    {outlines}
                    {dots}
                  </>
                );
              })()}

              {/* Names of the selected areas (or the province when all of it is selected) */}
              <g aria-hidden="true" className="pointer-events-none select-none">
                {(disabled
                  ? [{ ...labelAnchors.get('__province__')!, name: provinceName, code: 'all' }]
                  : [...selected]
                      .map((code) => ({ ...labelAnchors.get(code), code }))
                      .filter((a): a is { name: string; x: number; y: number; code: string } =>
                        Boolean(a.name),
                      )
                ).map((a) => (
                  <text
                    key={a.code}
                    x={a.x}
                    y={a.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={(disabled ? 18 : 12) / scale}
                    fontWeight={600}
                    fill="#000000"
                    stroke="#FFFFFF"
                    strokeWidth={3 / scale}
                    paintOrder="stroke"
                  >
                    {a.name}
                  </text>
                ))}
              </g>
            </g>
          </svg>
        )}

        {hover && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap bg-accent px-2 py-1 text-xs text-white"
            style={{ left: hover.x, top: hover.y - 12, transform: 'translate(-50%, -100%)' }}
            aria-hidden="true"
          >
            <span className="font-medium">{hover.shape.properties.n}</span>
            <span className="block text-gray-300">
              {hover.shape.properties.c && itemsByCode.has(hover.shape.properties.c)
                ? `${
                    itemsByCode.get(hover.shape.properties.c)?.subtype ??
                    LEVEL_NAMES[hover.shape.properties.l ?? 'm']
                  } · ${
                    disabled
                      ? 'included'
                      : selected.has(hover.shape.properties.c)
                        ? 'selected (click to remove)'
                        : 'click to select'
                  }`
                : 'No local government'}
            </span>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Grey areas have no government of their own (unorganized territory and similar). Boundaries:
        Statistics Canada, 2025.
      </p>
    </div>
  );
}
