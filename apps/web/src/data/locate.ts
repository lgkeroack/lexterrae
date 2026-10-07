import { feature } from 'topojson-client';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import { loadProvinceMap, type ShapeProps } from './provinceMaps';

/** Bounding boxes [west, south, east, north] of each province map (public/maps/*.json). */
const BOUNDS: Record<string, [number, number, number, number]> = {
  AB: [-120.01, 48.99, -109.99, 60.01],
  BC: [-139.06, 48.3, -114.05, 60.01],
  MB: [-102.01, 48.99, -88.97, 60.01],
  NB: [-69.06, 44.59, -63.77, 48.08],
  NL: [-67.82, 46.6, -52.61, 60.38],
  NS: [-66.4, 43.4, -59.67, 47.23],
  NT: [-136.47, 59.99, -101.99, 78.77],
  NU: [-120.69, 51.9, -61.09, 83.12],
  ON: [-95.16, 41.9, -74.34, 56.87],
  PE: [-64.42, 45.94, -61.97, 47.06],
  QC: [-79.77, 44.99, -57.1, 62.59],
  SK: [-110.01, 48.99, -101.36, 60.01],
  YT: [-141.02, 59.99, -123.78, 69.65],
};

type Shape = Feature<Polygon | MultiPolygon, ShapeProps>;

/** Even-odd ray casting over every ring (holes included), in plain longitude/latitude. */
function ringsContain(rings: Position[][], [x, y]: [number, number]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function shapeContains(shape: Shape, point: [number, number]): boolean {
  const { geometry } = shape;
  if (geometry.type === 'Polygon') return ringsContain(geometry.coordinates, point);
  return geometry.coordinates.some((polygon) => ringsContain(polygon, point));
}

/**
 * The jurisdiction codes for a point, most specific first (e.g. BC-SQUAMISH,
 * BC-SQUAMISH_LILLOOET, BC), or null when it is not in a mapped part of Canada. Uses the same
 * map files as the backend (about 1 km precision), so nothing leaves the browser.
 */
export async function codesAt(longitude: number, latitude: number): Promise<string[] | null> {
  const point: [number, number] = [longitude, latitude];
  const candidates = Object.entries(BOUNDS).filter(
    ([, [w, s, e, n]]) => longitude >= w && longitude <= e && latitude >= s && latitude <= n,
  );
  for (const [province] of candidates) {
    const topo = await loadProvinceMap(province);
    const find = (layer: 'local' | 'regions') =>
      (feature(topo, topo.objects[layer]) as unknown as { features: Shape[] }).features.find((f) =>
        shapeContains(f, point),
      );
    const local = find('local');
    const region = find('regions');
    if (!local && !region) continue; // in the box, but not in this province
    return [local?.properties.c, region?.properties.c, province].filter((c): c is string =>
      Boolean(c),
    );
  }
  return null;
}
