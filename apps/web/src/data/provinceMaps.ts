import type { GeometryCollection, Topology } from 'topojson-specification';

/** Shape properties written by scripts/build-province-maps.mjs. */
export interface ShapeProps {
  /** Jurisdiction code; absent for areas with no government of their own. */
  c?: string;
  n: string;
  /** r = regional, m = municipal, i = Indigenous */
  l?: 'r' | 'm' | 'i';
}

export type ProvinceTopology = Topology<{
  regions: GeometryCollection<ShapeProps>;
  local: GeometryCollection<ShapeProps>;
}>;

// Province map files are static and large: fetch each once per page load
const cache = new Map<string, Promise<ProvinceTopology>>();

export function loadProvinceMap(code: string): Promise<ProvinceTopology> {
  let request = cache.get(code);
  if (!request) {
    request = fetch(`/maps/${code}.json`, { signal: AbortSignal.timeout(30_000) }).then((res) => {
      if (!res.ok) throw new Error(`Map not available (${res.status})`);
      return res.json() as Promise<ProvinceTopology>;
    });
    request.catch(() => cache.delete(code));
    cache.set(code, request);
  }
  return request;
}
