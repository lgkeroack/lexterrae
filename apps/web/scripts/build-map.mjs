/**
 * Builds src/data/map-paths.ts: SVG outlines of the provinces and territories, projected and
 * simplified from Statistics Canada's 2021 cartographic boundary file (lpr_000b21s_e).
 * Contains information licensed under the Open Government Licence – Canada.
 *
 * Usage (the output is committed): node apps/web/scripts/build-map.mjs
 */
import { writeFile } from 'node:fs/promises';
import { geoConicConformal, geoPath, geoArea } from 'd3';

const SERVICE =
  'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0/query';

const WIDTH = 870;
/** Degrees: vertices closer than this are dropped by the server (about 3 km). */
const SIMPLIFY = 0.03;
/** Islands smaller than this share of their jurisdiction's area are left out, except for PE. */
const MIN_ISLAND_SHARE = 0.0015;
/** Coordinates are rounded to this many decimals in the SVG paths. */
const PRECISION = 1;

const PROVINCES = {
  10: ['NL', 'Newfoundland and Labrador', 'provincial', 'common_law'],
  11: ['PE', 'Prince Edward Island', 'provincial', 'common_law'],
  12: ['NS', 'Nova Scotia', 'provincial', 'common_law'],
  13: ['NB', 'New Brunswick', 'provincial', 'common_law'],
  24: ['QC', 'Quebec', 'provincial', 'civil_law'],
  35: ['ON', 'Ontario', 'provincial', 'common_law'],
  46: ['MB', 'Manitoba', 'provincial', 'common_law'],
  47: ['SK', 'Saskatchewan', 'provincial', 'common_law'],
  48: ['AB', 'Alberta', 'provincial', 'common_law'],
  59: ['BC', 'British Columbia', 'provincial', 'common_law'],
  60: ['YT', 'Yukon', 'territorial', 'common_law'],
  61: ['NT', 'Northwest Territories', 'territorial', 'common_law'],
  62: ['NU', 'Nunavut', 'territorial', 'common_law'],
};

/** Hand-placed label positions (longitude, latitude) where the centroid reads badly. */
const LABEL_AT = {
  NU: [-92, 66],
  NT: [-120, 64],
  NL: [-61, 53.5],
  QC: [-72, 51.5],
  ON: [-86, 50.5],
  BC: [-124, 54.5],
  PE: [-63.2, 46.95],
  NS: [-63.6, 45.0],
  NB: [-66.4, 46.6],
};

async function fetchProvinces() {
  const url = new URL(SERVICE);
  url.search = new URLSearchParams({
    where: '1=1',
    outFields: 'PRUID',
    outSR: '4326',
    maxAllowableOffset: String(SIMPLIFY),
    geometryPrecision: '3',
    f: 'geojson',
  }).toString();
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'lexterrae-map/1.0' } });
      const data = await res.json();
      if (data.features?.length) return data;
    } catch {
      // The service intermittently answers with an HTML error page
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error('Could not fetch province boundaries');
}

/**
 * d3 expects the opposite ring winding to RFC 7946 GeoJSON: a polygon read the "wrong" way round
 * covers the whole globe except itself, so reverse any polygon larger than a hemisphere.
 */
function rewind(coords) {
  return geoArea({ type: 'Polygon', coordinates: coords }) > 2 * Math.PI
    ? coords.map((ring) => [...ring].reverse())
    : coords;
}

/** Keeps the polygons of a (multi)polygon that are not negligible slivers or islets. */
function dropIslets(feature, code) {
  const g = feature.geometry;
  if (g.type === 'Polygon') {
    return { ...feature, geometry: { type: 'Polygon', coordinates: rewind(g.coordinates) } };
  }
  const parts = g.coordinates.map(rewind).map((coords) => ({
    coords,
    area: geoArea({ type: 'Polygon', coordinates: coords }),
  }));
  const total = parts.reduce((sum, p) => sum + p.area, 0);
  const kept = parts.filter((p) => code === 'PE' || p.area / total >= MIN_ISLAND_SHARE);
  return { ...feature, geometry: { type: 'MultiPolygon', coordinates: kept.map((p) => p.coords) } };
}

function roundPath(d) {
  return d.replace(/-?\d+\.\d+/g, (n) => Number(n).toFixed(PRECISION).replace(/\.0$/, ''));
}

const geojson = await fetchProvinces();
const features = geojson.features.map((f) => {
  const meta = PROVINCES[String(f.properties.PRUID)];
  if (!meta) throw new Error(`Unknown PRUID ${f.properties.PRUID}`);
  return dropIslets(f, meta[0]);
});

// Statistics Canada's Lambert conformal conic for national maps
const projection = geoConicConformal()
  .parallels([49, 77])
  .rotate([91.866667, 0])
  .center([0, 63.390675]);
// Mainland and southern islands frame the map; the far Arctic archipelago is allowed to crop less
projection.fitWidth(WIDTH - 20, { type: 'FeatureCollection', features });
const path = geoPath(projection);
const [[, y0], [, y1]] = path.bounds({ type: 'FeatureCollection', features });
const [tx, ty] = projection.translate();
projection.translate([tx + 10, ty - y0 + 10]);
const height = Math.ceil(y1 - y0 + 20);

const entries = features
  .map((f) => {
    const [code, name, level, legalSystem] = PROVINCES[String(f.properties.PRUID)];
    const at = LABEL_AT[code];
    const center = (at ? projection(at) : path.centroid(f)).map((v) => Math.round(v));
    return { code, name, path: roundPath(path(f)), center, level, legalSystem };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const body = `/**
 * SVG outlines of the provinces and territories for the jurisdiction map.
 *
 * GENERATED by apps/web/scripts/build-map.mjs from Statistics Canada's 2021 cartographic
 * boundary file (Open Government Licence – Canada), simplified and projected with the Lambert
 * conformal conic used for national maps. Do not edit by hand.
 */
export interface ProvinceMapData {
  code: string;
  name: string;
  path: string;
  /** Label anchor in SVG user units */
  center: [number, number];
  level: 'provincial' | 'territorial';
  legalSystem: 'common_law' | 'civil_law';
}

export const MAP_VIEWBOX = { width: ${WIDTH}, height: ${height} };

export const PROVINCE_MAP_DATA: ProvinceMapData[] = [
${entries
  .map(
    (e) =>
      `  {\n    code: '${e.code}',\n    name: '${e.name}',\n    center: [${e.center.join(', ')}],\n    level: '${e.level}',\n    legalSystem: '${e.legalSystem}',\n    path: '${e.path}',\n  },`,
  )
  .join('\n')}
];
`;

const out = new URL('../src/data/map-paths.ts', import.meta.url);
await writeFile(out, body);
console.log(
  `Wrote ${out.pathname}: ${entries.length} jurisdictions, viewBox ${WIDTH}×${height}, ` +
    `${Math.round(body.length / 1024)} KB`,
);
