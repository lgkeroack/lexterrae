/**
 * Builds public/maps/<PROVINCE>.json: a TopoJSON map of each province/territory with two
 * layers, `regions` (counties, regional districts, MRCs, …) and `local` (municipalities and
 * Indigenous lands). Each shape carries the code of its jurisdiction (from
 * apps/api/db/data/jurisdictions.json) so a click selects it; shapes without one (unorganized
 * areas, electoral areas, statistical divisions) are drawn but not selectable.
 *
 * Sources (Open Government Licence – Canada): Statistics Canada's 2025 census subdivision
 * boundaries (the same release as the jurisdiction list), clipped to the coastline from the
 * 2021 cartographic province boundaries.
 *
 * Usage (the output is committed): node apps/web/scripts/build-province-maps.mjs [CODE ...]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { geoArea } from 'd3';
import polygonClipping from 'polygon-clipping';
import { topology } from 'topojson-server';
import { HOLE_LIMITS, QUANTIZATION, SIMPLIFY } from './build-province-maps-config.mjs';
import { cleanFeatures, fixWinding, multi, rewind } from './map-geometry.mjs';

const CSD_SERVICE =
  'https://geo.statcan.gc.ca/geo_wa/rest/services/2025/lcsd000a25s_e/MapServer/0/query';
const LAND_SERVICE =
  'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0/query';

const PROVINCES = {
  NL: '10',
  PE: '11',
  NS: '12',
  NB: '13',
  QC: '24',
  ON: '35',
  MB: '46',
  SK: '47',
  AB: '48',
  BC: '59',
  YT: '60',
  NT: '61',
  NU: '62',
};

/** Islands smaller than this share of the province's land are left out. */
const MIN_ISLAND_SHARE = 0.00005;
const PAGE_SIZE = 250;

async function query(service, params) {
  const url = new URL(service);
  url.search = new URLSearchParams({ outSR: '4326', f: 'geojson', ...params }).toString();
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      // The service sometimes stalls a connection: give up and retry
      const res = await fetch(url, {
        headers: { 'User-Agent': 'lexterrae-map/1.0' },
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json();
      if (Array.isArray(data.features)) return data.features;
    } catch {
      // The service intermittently answers with an HTML error page
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error(`Query failed: ${url}`);
}

async function fetchSubdivisions(pruid, simplify) {
  const all = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await query(CSD_SERVICE, {
      where: `PRUID='${pruid}'`,
      outFields: 'CDUID,CDNAME,CSDUID,CSDNAME,CSDTYPE',
      orderByFields: 'CSDUID',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      maxAllowableOffset: String(simplify),
      geometryPrecision: '4',
    });
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

/** Polygon coordinates as a MultiPolygon coordinate array. */
const normalize = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*\(Part\)/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const LEVEL_KEY = { regional: 'r', municipal: 'm', indigenous: 'i' };

async function buildProvince(code, records) {
  const pruid = PROVINCES[code];
  const simplify = SIMPLIFY;
  const [subdivisions, [land]] = await Promise.all([
    fetchSubdivisions(pruid, simplify),
    query(LAND_SERVICE, {
      where: `PRUID='${pruid}'`,
      outFields: 'PRUID',
      maxAllowableOffset: String(simplify),
      geometryPrecision: '4',
    }),
  ]);
  // Bounding boxes, so each area is clipped only against the coastline polygons near it
  const bbox = (polys) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polys) {
      for (const [x, y] of poly[0]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return [x0, y0, x1, y1];
  };
  const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const landAll = multi(land.geometry).map((poly) => ({
    poly,
    area: geoArea({ type: 'Polygon', coordinates: rewind([poly])[0] }),
  }));
  const landTotal = landAll.reduce((sum, l) => sum + l.area, 0);
  const landPolys = landAll
    .filter((l) => l.area / landTotal >= MIN_ISLAND_SHARE)
    .map(({ poly }) => ({ poly, box: bbox([poly]) }));
  console.log(`${code}: fetched ${subdivisions.length} subdivisions, clipping…`);

  // Jurisdiction codes by StatCan geographic code, and by name for merged "(Part)" places
  const mine = records.filter((r) => r.province === code);
  const byGeo = new Map(mine.map((r) => [`${r.level}|${r.geoCode}`, r]));
  const byName = new Map(
    mine.filter((r) => r.level !== 'regional').map((r) => [normalize(r.name), r]),
  );

  const local = [];
  const regionParts = new Map();
  for (const f of subdivisions) {
    const p = f.properties;
    let clipped;
    try {
      const own = multi(f.geometry);
      const box = bbox(own);
      const near = landPolys.filter((l) => overlaps(box, l.box)).map((l) => l.poly);
      clipped = near.length ? polygonClipping.intersection(own, near) : [];
    } catch {
      clipped = multi(f.geometry);
    }
    if (clipped.length === 0) continue;

    const rec =
      byGeo.get(`municipal|${p.CSDUID}`) ??
      byGeo.get(`indigenous|${p.CSDUID}`) ??
      (p.CSDTYPE === 'SC' ? byGeo.get(`municipal|${p.CDUID}`) : undefined) ??
      (/\(Part\)/i.test(p.CSDNAME) ? byName.get(normalize(p.CSDNAME)) : undefined);
    local.push({
      type: 'Feature',
      properties: rec
        ? { c: rec.code, n: rec.name, l: LEVEL_KEY[rec.level] }
        : { n: p.CSDNAME.replace(/\s*\(Part\)/i, '') },
      geometry: { type: 'MultiPolygon', coordinates: rewind(clipped) },
    });
    regionParts.set(p.CDUID, [...(regionParts.get(p.CDUID) ?? []), ...clipped]);
  }

  const regions = [];
  for (const [cduid, parts] of regionParts) {
    const rec = byGeo.get(`regional|${cduid}`);
    const name =
      rec?.name ?? subdivisions.find((f) => f.properties.CDUID === cduid)?.properties.CDNAME;
    let merged;
    try {
      merged = polygonClipping.union(...parts.map((p) => [p]));
    } catch {
      merged = parts;
    }
    regions.push({
      type: 'Feature',
      properties: rec ? { c: rec.code, n: rec.name, l: 'r' } : { n: name },
      geometry: { type: 'MultiPolygon', coordinates: rewind(merged) },
    });
  }

  // Drop the triangles, slivers and specks simplification leaves (see map-geometry.mjs)
  const topo = topology(
    {
      regions: {
        type: 'FeatureCollection',
        features: cleanFeatures(regions, HOLE_LIMITS.regions).features,
      },
      local: {
        type: 'FeatureCollection',
        features: cleanFeatures(local, HOLE_LIMITS.local).features,
      },
    },
    QUANTIZATION,
  );
  fixWinding(topo);
  const json = JSON.stringify(topo);
  const out = new URL(`../public/maps/${code}.json`, import.meta.url);
  await writeFile(out, json);
  const linked = local.filter((f) => f.properties.c).length;
  console.log(
    `${code}: ${regions.length} regions, ${local.length} local areas ` +
      `(${linked} linked to jurisdictions), ${Math.round(json.length / 1024)} KB`,
  );
}

const records = JSON.parse(
  await readFile(new URL('../../api/db/data/jurisdictions.json', import.meta.url), 'utf8'),
).records;
await mkdir(new URL('../public/maps/', import.meta.url), { recursive: true });
const codes = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PROVINCES);
for (const code of codes) await buildProvince(code, records);
