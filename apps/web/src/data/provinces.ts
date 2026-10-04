import type { ProvinceData, LegalSystem } from '@lexterrae/shared';

/**
 * Static fallback list of provinces/territories and their municipalities.
 *
 * The authoritative list (with database UUIDs) is loaded from GET /api/jurisdictions;
 * this list is only used to render the picker before/if that request fails.
 * Names mirror apps/api/prisma/seed.ts, and codes are derived with the same rule the
 * seed uses so that local codes line up with the API's `code` column.
 */

/** Code of the federal jurisdiction ("Canada") in the seed data. */
export const FEDERAL_CODE = 'CA';

/** Same derivation as `municipalityCode()` in apps/api/prisma/seed.ts. */
export function municipalityCode(provinceCode: string, cityName: string): string {
  const slug = cityName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${provinceCode}-${slug}`;
}

function province(
  name: string,
  code: string,
  level: ProvinceData['level'],
  legalSystem: LegalSystem,
  municipalities: string[],
): ProvinceData {
  return {
    name,
    code,
    level,
    legalSystem,
    municipalities: municipalities.map((m) => ({ name: m, code: municipalityCode(code, m) })),
  };
}

export const PROVINCES: ProvinceData[] = [
  province('Alberta', 'AB', 'provincial', 'common_law', [
    'Calgary', 'Edmonton', 'Red Deer', 'Lethbridge', 'Medicine Hat', 'Grande Prairie', 'St. Albert', 'Airdrie',
  ]),
  province('British Columbia', 'BC', 'provincial', 'common_law', [
    'Vancouver', 'Victoria', 'Surrey', 'Burnaby', 'Richmond', 'Kelowna', 'Kamloops', 'Nanaimo',
    'Squamish', 'Whistler', 'Prince George', 'Abbotsford',
  ]),
  province('Manitoba', 'MB', 'provincial', 'common_law', [
    'Winnipeg', 'Brandon', 'Thompson', 'Steinbach', 'Portage la Prairie',
  ]),
  province('New Brunswick', 'NB', 'provincial', 'common_law', [
    'Fredericton', 'Saint John', 'Moncton', 'Dieppe', 'Riverview',
  ]),
  province('Newfoundland and Labrador', 'NL', 'provincial', 'common_law', [
    "St. John's", 'Mount Pearl', 'Corner Brook', 'Conception Bay South', 'Paradise',
  ]),
  province('Nova Scotia', 'NS', 'provincial', 'common_law', [
    'Halifax', 'Cape Breton', 'Dartmouth', 'Truro', 'New Glasgow',
  ]),
  province('Ontario', 'ON', 'provincial', 'common_law', [
    'Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton', 'London', 'Markham', 'Vaughan',
    'Kitchener', 'Windsor', 'Richmond Hill', 'Oakville', 'Burlington',
  ]),
  province('Prince Edward Island', 'PE', 'provincial', 'common_law', [
    'Charlottetown', 'Summerside', 'Stratford', 'Cornwall',
  ]),
  province('Quebec', 'QC', 'provincial', 'civil_law', [
    'Montréal', 'Québec City', 'Laval', 'Gatineau', 'Longueuil', 'Sherbrooke', 'Lévis', 'Saguenay',
    'Trois-Rivières',
  ]),
  province('Saskatchewan', 'SK', 'provincial', 'common_law', [
    'Regina', 'Saskatoon', 'Prince Albert', 'Moose Jaw', 'Swift Current',
  ]),
  province('Northwest Territories', 'NT', 'territorial', 'common_law', [
    'Yellowknife', 'Hay River', 'Inuvik',
  ]),
  province('Nunavut', 'NU', 'territorial', 'common_law', ['Iqaluit', 'Rankin Inlet', 'Arviat']),
  province('Yukon', 'YT', 'territorial', 'common_law', ['Whitehorse', 'Dawson City']),
];
