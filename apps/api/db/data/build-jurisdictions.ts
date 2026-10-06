/**
 * Builds db/data/jurisdictions.json (regional, municipal and Indigenous jurisdictions) from
 * Statistics Canada's annually updated census subdivision boundary file.
 *
 * Source: Statistics Canada, Census subdivision boundary file (lcsd000a25s_e, January 1, 2025),
 * ArcGIS service at geo.statcan.gc.ca. Contains information licensed under the Open Government
 * Licence – Canada.
 *
 * Usage (re-run when StatCan publishes a new year; the output is committed):
 *   pnpm --filter @lexterrae/api exec tsx db/data/build-jurisdictions.ts
 */
import { writeFile } from 'node:fs/promises';

const SERVICE =
  'https://geo.statcan.gc.ca/geo_wa/rest/services/2025/lcsd000a25s_e/MapServer/0/query';
const SOURCE = 'Statistics Canada, census subdivision boundary file, 2025 (lcsd000a25s_e)';
const PAGE_SIZE = 2000;

interface Csd {
  PRUID: string;
  CDUID: string;
  CDNAME: string;
  CDTYPE: string;
  CSDUID: string;
  CSDNAME: string;
  CSDTYPE: string;
}

const PROVINCE_BY_UID: Record<string, string> = {
  '10': 'NL',
  '11': 'PE',
  '12': 'NS',
  '13': 'NB',
  '24': 'QC',
  '35': 'ON',
  '46': 'MB',
  '47': 'SK',
  '48': 'AB',
  '59': 'BC',
  '60': 'YT',
  '61': 'NT',
  '62': 'NU',
};

/**
 * Census division types that are (or name) an upper-tier government or legal region. Excluded:
 * CDR ("Division No. n", statistical only), REG (statistical regions) and TER (all of Yukon).
 */
const REGIONAL_TYPES: Record<string, string> = {
  CTY: 'County',
  UC: 'United counties',
  RM: 'Regional municipality',
  DM: 'District municipality',
  DIS: 'District',
  RD: 'Regional district',
  MRC: 'Regional county municipality (MRC)',
  TÉ: 'Equivalent territory',
  RCR: 'Regional service commission area',
};

/** Census subdivision types that are incorporated municipalities (or their equivalent). */
const MUNICIPAL_TYPES: Record<string, string> = {
  C: 'City',
  CC: 'Chartered community',
  CG: 'Community government',
  CT: 'Township municipality (canton)',
  CU: 'United townships municipality',
  CV: 'City',
  CY: 'City',
  DM: 'District municipality',
  GR: 'Regional government',
  HAM: 'Hamlet',
  ID: 'Improvement district',
  IM: 'Island municipality',
  LGD: 'Local government district',
  M: 'Municipality',
  MD: 'Municipal district',
  MÉ: 'Municipality',
  MRM: 'Rural municipality',
  MU: 'Municipality',
  NH: 'Northern hamlet',
  NV: 'Northern village',
  PE: 'Parish municipality',
  RCR: 'Rural community',
  RDR: 'Rural district',
  RGM: 'Regional municipality',
  RM: 'Rural municipality',
  RMU: 'Resort municipality',
  RV: 'Resort village',
  SA: 'Special area',
  SET: 'Settlement',
  SM: 'Specialized municipality',
  SV: 'Summer village',
  T: 'Town',
  TP: 'Township',
  TV: 'Town',
  V: 'City (ville)',
  VC: 'Cree village',
  VK: 'Naskapi village',
  VL: 'Village',
  VN: 'Northern village',
};

/** Census subdivision types that are First Nations, Inuit or other Indigenous lands. */
const INDIGENOUS_TYPES: Record<string, string> = {
  IRI: 'Indian reserve',
  'S-É': 'Indian settlement',
  TC: 'Cree reserved lands',
  TI: 'Inuit lands',
  TK: 'Naskapi reserved lands',
  NL: "Nisga'a lands",
  SG: 'Self-government lands',
  IGD: 'Indian government district',
  TAL: "Tla'amin lands",
  TWL: 'Tsawwassen lands',
  TL: 'Teslin lands',
};

/**
 * Not jurisdictions: unorganized areas (NO, SNO), Yukon unincorporated settlements (SÉ), BC
 * regional district electoral areas (RDA) and PEI fire districts (FD). Nova Scotia county
 * municipalities (SC) are split into statistical subdivisions and are merged into one entry each.
 */
const NS_COUNTY_SUBDIVISION = 'SC';

export interface JurisdictionRecord {
  code: string;
  name: string;
  level: 'regional' | 'municipal' | 'indigenous';
  subtype: string;
  /** Code of the parent: a province/territory, or a regional jurisdiction. */
  parent: string;
  province: string;
  /** StatCan geographic code (CDUID or CSDUID). */
  geoCode: string;
}

function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Municipal codes keep the original scheme ("ON-TORONTO"); other levels get a prefix. */
function baseCode(level: JurisdictionRecord['level'], province: string, name: string): string {
  const prefix = level === 'regional' ? 'REG-' : level === 'indigenous' ? 'IND-' : '';
  return `${province}-${prefix}${slug(name)}`;
}

async function fetchAll(): Promise<Csd[]> {
  const rows: Csd[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(SERVICE);
    url.search = new URLSearchParams({
      where: '1=1',
      outFields: 'PRUID,CDUID,CDNAME,CDTYPE,CSDUID,CSDNAME,CSDTYPE',
      returnGeometry: 'false',
      orderByFields: 'CSDUID',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: 'json',
    }).toString();
    let page: { features?: { attributes: Csd }[] } | undefined;
    for (let attempt = 1; attempt <= 8 && !page?.features; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'lexterrae-seed/1.0' } });
        page = (await res.json()) as typeof page;
      } catch {
        // The service intermittently answers with an HTML error page
      }
      if (!page?.features) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
    if (!page?.features) throw new Error(`Could not fetch census subdivisions at offset ${offset}`);
    rows.push(...page.features.map((f) => f.attributes));
    if (page.features.length < PAGE_SIZE) return rows;
  }
}

const SIGNIFICANCE = ['City', 'City (ville)', 'Town', 'Village'];

/** Lower is more significant: used to decide which of several same-named places keeps a code. */
function significance(rec: JurisdictionRecord): number {
  const i = SIGNIFICANCE.indexOf(rec.subtype);
  return i === -1 ? SIGNIFICANCE.length : i;
}

export function buildRecords(rows: Csd[]): JurisdictionRecord[] {
  const records: JurisdictionRecord[] = [];

  // Regional: one per qualifying census division
  const regionalByCd = new Map<string, JurisdictionRecord>();
  for (const r of rows) {
    const subtype = REGIONAL_TYPES[r.CDTYPE];
    const province = PROVINCE_BY_UID[r.PRUID];
    if (!subtype || !province || regionalByCd.has(r.CDUID)) continue;
    const rec: JurisdictionRecord = {
      code: baseCode('regional', province, r.CDNAME),
      name: r.CDNAME.trim(),
      level: 'regional',
      subtype,
      parent: province,
      province,
      geoCode: r.CDUID,
    };
    regionalByCd.set(r.CDUID, rec);
    records.push(rec);
  }

  const parentOf = (r: Csd, province: string) => regionalByCd.get(r.CDUID)?.code ?? province;
  const splitNames = new Set<string>();
  const nsCounties = new Map<string, JurisdictionRecord>();

  for (const r of rows) {
    const province = PROVINCE_BY_UID[r.PRUID];
    if (!province) continue;
    if (r.CSDTYPE === NS_COUNTY_SUBDIVISION) {
      if (!nsCounties.has(r.CDUID)) {
        const name = `Municipality of the County of ${r.CDNAME.trim()}`;
        const rec: JurisdictionRecord = {
          code: baseCode('municipal', province, name),
          name,
          level: 'municipal',
          subtype: 'County municipality',
          parent: parentOf(r, province),
          province,
          geoCode: r.CDUID,
        };
        nsCounties.set(r.CDUID, rec);
        records.push(rec);
      }
      continue;
    }
    const municipal = MUNICIPAL_TYPES[r.CSDTYPE];
    const indigenous = INDIGENOUS_TYPES[r.CSDTYPE];
    if (!municipal && !indigenous) continue;
    const level = municipal ? 'municipal' : 'indigenous';
    // "Sechelt (Part)", "Six Nations (Part) 40": one jurisdiction split across census divisions
    const name = r.CSDNAME.replace(/\s*\(Part\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (name !== r.CSDNAME.trim()) splitNames.add(`${province}|${name}`);
    records.push({
      code: baseCode(level, province, name),
      name,
      level,
      subtype: (municipal ?? indigenous)!,
      parent: parentOf(r, province),
      province,
      geoCode: r.CSDUID,
    });
  }

  // Merge the pieces of a split jurisdiction; one spanning several regions sits under the province
  const merged = new Map<string, JurisdictionRecord>();
  for (const rec of records) {
    const split = splitNames.has(`${rec.province}|${rec.name}`);
    const key = `${rec.level}|${rec.province}|${rec.name}|${rec.subtype}|${split ? '' : rec.parent}`;
    const existing = merged.get(key);
    if (!existing) merged.set(key, rec);
    else if (existing.parent !== rec.parent) existing.parent = rec.province;
  }
  const unique = [...merged.values()];

  // Same code for different places (e.g. the City of Hamilton and Hamilton Township): the most
  // significant one (a city, else a town, else a village) keeps the plain code, which earlier
  // seeds may already use; the others get their StatCan code appended
  const byCode = new Map<string, JurisdictionRecord[]>();
  for (const rec of unique) byCode.set(rec.code, [...(byCode.get(rec.code) ?? []), rec]);
  for (const group of byCode.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((a, b) => significance(a) - significance(b));
    const keeper = significance(ranked[0]!) < significance(ranked[1]!) ? ranked[0] : undefined;
    for (const rec of group) if (rec !== keeper) rec.code = `${rec.code}-${rec.geoCode}`;
  }
  for (const rec of unique) {
    if (rec.code.length > 100) rec.code = `${rec.province}-${rec.geoCode}`;
  }

  const levelOrder = { regional: 0, municipal: 1, indigenous: 2 };
  return unique.sort(
    (a, b) => levelOrder[a.level] - levelOrder[b.level] || a.code.localeCompare(b.code),
  );
}

async function main() {
  const rows = await fetchAll();
  console.log(`Fetched ${rows.length} census subdivisions`);
  const records = buildRecords(rows);
  const counts = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.level] = (acc[r.level] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Jurisdictions:', counts, 'total', records.length);
  const out = new URL('./jurisdictions.json', import.meta.url);
  // One record per line keeps diffs readable when the data is refreshed
  const body = `{"source":${JSON.stringify(SOURCE)},"records":[\n${records
    .map((r) => JSON.stringify(r))
    .join(',\n')}\n]}\n`;
  await writeFile(out, body);
  console.log(`Wrote ${out.pathname}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
