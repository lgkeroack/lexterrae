import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { geoCentroid, geoConicConformal, geoPath, select, zoom, zoomIdentity } from 'd3';
import type { ZoomBehavior } from 'd3';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { JurisdictionSearchResult } from '@lexterrae/shared';
import { useJurisdictionStore } from '../../stores/jurisdictionStore';
import { LoadingSpinner } from '../common/LoadingSpinner';

/** Shape properties written by scripts/build-province-maps.mjs. */
interface ShapeProps {
  /** Jurisdiction code; absent for areas with no government of their own. */
  c?: string;
  n: string;
  /** r = regional, m = municipal, i = Indigenous */
  l?: 'r' | 'm' | 'i';
}

type Layer = 'regions' | 'local';
type ProvinceTopology = Topology<{
  regions: GeometryCollection<ShapeProps>;
  local: GeometryCollection<ShapeProps>;
}>;
type Shape = Feature<Polygon | MultiPolygon, ShapeProps>;

const WIDTH = 800;
const MAX_HEIGHT = 560;
const LEVEL_NAMES = { r: 'Regional', m: 'Municipal', i: 'Indigenous' } as const;

// Province map files are static and large: fetch each once per page load
const cache = new Map<string, Promise<ProvinceTopology>>();
function loadMap(code: string): Promise<ProvinceTopology> {
  let request = cache.get(code);
  if (!request) {
    request = fetch(`/maps/${code}.json`).then((res) => {
      if (!res.ok) throw new Error(`Map not available (${res.status})`);
      return res.json() as Promise<ProvinceTopology>;
    });
    request.catch(() => cache.delete(code));
    cache.set(code, request);
  }
  return request;
}

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
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>();

  useEffect(() => {
    let active = true;
    setTopo(null);
    setError(null);
    loadMap(provinceCode)
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

  const { shapes, height, paths } = useMemo(() => {
    if (!topo) return { shapes: [] as Shape[], height: 400, paths: [] as string[] };
    const all = feature(topo, topo.objects.local) as FeatureCollection<
      Polygon | MultiPolygon,
      ShapeProps
    >;
    const current = feature(topo, topo.objects[layer]) as FeatureCollection<
      Polygon | MultiPolygon,
      ShapeProps
    >;
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
    return {
      shapes: current.features,
      height: h,
      paths: current.features.map((f) => path(f) ?? ''),
    };
  }, [topo, layer]);

  // Pan and zoom (a short drag still counts as a click)
  useEffect(() => {
    if (!svgRef.current || !groupRef.current) return;
    const group = select(groupRef.current);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 60])
      .clickDistance(4)
      .on('zoom', (event: { transform: { toString(): string } }) => {
        group.attr('transform', event.transform.toString());
        setHover(null);
      });
    zoomRef.current = behavior;
    const svg = select(svgRef.current).call(behavior);
    svg.call(behavior.transform, zoomIdentity);
    return () => {
      svg.on('.zoom', null);
    };
  }, [topo]);

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
              className={`border px-2.5 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-black disabled:cursor-not-allowed disabled:opacity-40 ${
                layer === value
                  ? 'border-black bg-black text-white'
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
              className="border border-gray-400 p-1.5 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
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
              {shapes.map((shape, i) => {
                const code = shape.properties.c;
                const linked = Boolean(code && itemsByCode.has(code));
                const isSelected = disabled || (code ? selected.has(code) : false);
                const isHover = hover?.shape === shape;
                return (
                  <path
                    key={`${layer}-${i}`}
                    d={paths[i]}
                    fill={
                      !linked ? '#F2F2F2' : isSelected ? '#000000' : isHover ? '#D6D6D6' : '#FFFFFF'
                    }
                    stroke={linked ? '#000000' : '#BDBDBD'}
                    strokeWidth={isHover && linked ? 1.5 : 0.6}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    className={linked && !disabled ? 'cursor-pointer' : undefined}
                    onClick={() => pick(shape)}
                    onMouseMove={(e) => showTooltip(shape, e)}
                  />
                );
              })}
            </g>
          </svg>
        )}

        {hover && (
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap bg-black px-2 py-1 text-xs text-white"
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
