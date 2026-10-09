/**
 * Cleans the committed public/maps/<PROVINCE>.json files in place (see cleanFeatures in
 * map-geometry.mjs) without fetching the source boundaries again. build-province-maps.mjs applies
 * the same cleaning when it builds a map.
 *
 * Usage: node apps/web/scripts/clean-province-maps.mjs [CODE ...]
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';
import { cleanFeatures, fixWinding } from './map-geometry.mjs';
import { HOLE_LIMITS, QUANTIZATION } from './build-province-maps-config.mjs';

const dir = new URL('../public/maps/', import.meta.url);
const codes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (await readdir(dir)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

for (const code of codes) {
  const file = new URL(`${code}.json`, dir);
  const before = await readFile(file, 'utf8');
  const topo = JSON.parse(before);
  const layers = {};
  const totals = { ringsRemoved: 0, holesRemoved: 0, dots: 0, dropped: 0 };
  for (const name of ['regions', 'local']) {
    const { features, stats } = cleanFeatures(
      feature(topo, topo.objects[name]).features,
      HOLE_LIMITS[name],
    );
    layers[name] = { type: 'FeatureCollection', features };
    for (const k of Object.keys(totals)) totals[k] += stats[k];
  }
  const cleaned = topology(layers, QUANTIZATION);
  fixWinding(cleaned);
  const json = JSON.stringify(cleaned);
  await writeFile(file, json);
  console.log(
    `${code}: removed ${totals.ringsRemoved} shapes and ${totals.holesRemoved} holes, ` +
      `${totals.dots} places shown as dots, ${totals.dropped} dropped; ` +
      `${Math.round(before.length / 1024)} → ${Math.round(json.length / 1024)} KB`,
  );
}
