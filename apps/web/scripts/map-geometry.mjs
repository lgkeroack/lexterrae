/**
 * Geometry helpers shared by build-province-maps.mjs and clean-province-maps.mjs.
 */
import { geoArea } from 'd3';
import { feature as toGeoJSON } from 'topojson-client';

export function multi(geometry) {
  if (!geometry) return [];
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

/** d3 expects the opposite ring winding to RFC 7946; flip any polygon that covers the globe. */
export function rewind(polygons) {
  return polygons.map((coords) =>
    geoArea({ type: 'Polygon', coordinates: coords }) > 2 * Math.PI
      ? coords.map((ring) => [...ring].reverse())
      : coords,
  );
}

/**
 * Quantization can flip the orientation of tiny rings. Enforce d3's convention ring by ring, in
 * arc-index form: an outer ring encloses less than a hemisphere, a hole more (reversing a ring
 * means reversing its arc list and complementing each index).
 */
export function fixWinding(topo) {
  const hemisphere = 2 * Math.PI;
  for (const object of Object.values(topo.objects)) {
    for (const geometry of object.geometries) {
      const polygons =
        geometry.type === 'Polygon'
          ? [geometry.arcs]
          : geometry.type === 'MultiPolygon'
            ? geometry.arcs
            : [];
      for (const rings of polygons) {
        rings.forEach((ring, i) => {
          const area = geoArea(toGeoJSON(topo, { type: 'Polygon', arcs: [ring] }));
          const isHole = i > 0;
          if (isHole ? area < hemisphere : area > hemisphere) {
            rings[i] = [...ring].reverse().map((arc) => ~arc);
          }
        });
      }
    }
  }
}

// ─── Cleaning up what 1 km simplification leaves behind ──────────────────────

/** Rings smaller than this are specks at map scale (km²). */
const MIN_RING_KM2 = 0.5;
/** Three-point rings (triangles) smaller than this are simplification debris (km²). */
const MIN_TRIANGLE_KM2 = 5;
/** Below this compactness (4πA/P²; a circle is 1) a small ring is a hairline sliver. */
const MIN_COMPACTNESS = 0.04;
const SLIVER_MAX_KM2 = 25;
/** Places too small to draw are shown as a dot of this radius range (km). */
const DOT_RADIUS_KM = [0.4, 0.9];

const KM_PER_DEG_LAT = 110.57;
const kmPerDegLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Area (km², winding-independent), perimeter (km) and distinct points of a lon/lat ring. */
function measure(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = kmPerDegLon(lat0);
  let twice = 0;
  let perimeter = 0;
  for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = ring[i - 1];
    const [x2, y2] = ring[i];
    twice += x1 * kx * y2 * KM_PER_DEG_LAT - x2 * kx * y1 * KM_PER_DEG_LAT;
    perimeter += Math.hypot((x2 - x1) * kx, (y2 - y1) * KM_PER_DEG_LAT);
  }
  const area = Math.abs(twice) / 2;
  return {
    area,
    perimeter,
    distinct: new Set(ring.map((p) => `${p[0]},${p[1]}`)).size,
    compactness: perimeter ? (4 * Math.PI * area) / (perimeter * perimeter) : 0,
  };
}

/** A turn sharper than this (degrees) where the outline doubles back on itself is a spike. */
const SPIKE_DEGREES = 12;

/**
 * Removes spikes: points where the outline goes out and comes straight back (clipping and
 * simplification leave these as hairlines sticking out of a border). Repeats until none remain.
 */
function despike(ring) {
  let pts = ring.slice(0, -1); // open ring
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const kx = kmPerDegLon(lat0);
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const v1 = [(a[0] - b[0]) * kx, (a[1] - b[1]) * KM_PER_DEG_LAT];
      const v2 = [(c[0] - b[0]) * kx, (c[1] - b[1]) * KM_PER_DEG_LAT];
      const l1 = Math.hypot(...v1);
      const l2 = Math.hypot(...v2);
      const duplicate = l1 === 0;
      const angle =
        l1 && l2
          ? (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)))) *
              180) /
            Math.PI
          : 180;
      if ((duplicate || angle < SPIKE_DEGREES) && pts.length - (i - next.length) > 3) {
        changed = true;
        continue;
      }
      next.push(b);
    }
    pts = next;
  }
  return [...pts, pts[0]];
}

function isDebris(ring) {
  const m = measure(ring);
  return (
    m.distinct < 3 ||
    m.area < MIN_RING_KM2 ||
    (m.distinct === 3 && m.area < MIN_TRIANGLE_KM2) ||
    (m.compactness < MIN_COMPACTNESS && m.area < SLIVER_MAX_KM2)
  );
}

/** A small round polygon (lon/lat) around a point. */
function dot([lon, lat], radiusKm, sides = 16) {
  const ring = [];
  for (let i = 0; i <= sides; i++) {
    const t = (2 * Math.PI * (i % sides)) / sides;
    ring.push([
      lon + (radiusKm * Math.cos(t)) / kmPerDegLon(lat),
      lat + (radiusKm * Math.sin(t)) / KM_PER_DEG_LAT,
    ]);
  }
  return [ring];
}

/**
 * Removes the triangles, hairline slivers and specks that simplification and coastline clipping
 * leave behind (they draw as stray lines and triangles). A selectable place (with a jurisdiction
 * code) left with nothing to draw becomes a small dot at its location, so it can still be found
 * and clicked; anything else left empty is dropped. Holes smaller than `minHoleKm2` are filled:
 * in merged regions they are gaps between simplified neighbours, not real holes.
 */
export function cleanFeatures(features, { minHoleKm2 = MIN_RING_KM2 } = {}) {
  const stats = { ringsRemoved: 0, holesRemoved: 0, dots: 0, dropped: 0 };
  const out = [];
  for (const f of features) {
    const polygons = multi(f.geometry);
    const kept = [];
    for (const [rawOuter, ...rawHoles] of polygons) {
      const outer = despike(rawOuter);
      const holes = rawHoles.map(despike);
      if (isDebris(outer)) {
        stats.ringsRemoved++;
        continue;
      }
      const goodHoles = holes.filter((h) => !isDebris(h) && measure(h).area >= minHoleKm2);
      stats.holesRemoved += holes.length - goodHoles.length;
      kept.push([outer, ...goodHoles]);
    }
    if (kept.length) {
      out.push({ ...f, geometry: { type: 'MultiPolygon', coordinates: rewind(kept) } });
      continue;
    }
    if (!f.properties.c || polygons.length === 0) {
      stats.dropped++;
      continue;
    }
    // Centre of the largest piece; dot sized to the place's area, within limits
    const pieces = polygons.map(([outer]) => ({ outer, m: measure(outer) }));
    stats.dots++;
    const largest = pieces.reduce((a, b) => (b.m.area > a.m.area ? b : a));
    const total = pieces.reduce((s, p) => s + p.m.area, 0);
    const centre = [
      largest.outer.reduce((s, p) => s + p[0], 0) / largest.outer.length,
      largest.outer.reduce((s, p) => s + p[1], 0) / largest.outer.length,
    ];
    const radius = Math.min(
      DOT_RADIUS_KM[1],
      Math.max(DOT_RADIUS_KM[0], Math.sqrt(total / Math.PI)),
    );
    out.push({
      ...f,
      geometry: { type: 'MultiPolygon', coordinates: rewind([dot(centre, radius)]) },
    });
  }
  return { features: out, stats };
}
