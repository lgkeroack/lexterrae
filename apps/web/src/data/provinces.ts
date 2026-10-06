import type { LegalSystem } from '@lexterrae/shared';

/** Code of the federal jurisdiction ("Canada") in the seed data. */
export const FEDERAL_CODE = 'CA';

export interface ProvinceInfo {
  /** Database UUID; set once GET /api/jurisdictions/top-level has loaded. */
  id?: string;
  name: string;
  code: string;
  level: 'provincial' | 'territorial';
  legalSystem: LegalSystem;
}

/**
 * Static list of provinces and territories, used to render the picker before (or if) the
 * authoritative list with database UUIDs loads. Mirrors apps/api/db/seed.ts.
 */
export const PROVINCES: ProvinceInfo[] = [
  { name: 'Alberta', code: 'AB', level: 'provincial', legalSystem: 'common_law' },
  { name: 'British Columbia', code: 'BC', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Manitoba', code: 'MB', level: 'provincial', legalSystem: 'common_law' },
  { name: 'New Brunswick', code: 'NB', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Newfoundland and Labrador', code: 'NL', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Nova Scotia', code: 'NS', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Ontario', code: 'ON', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Prince Edward Island', code: 'PE', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Quebec', code: 'QC', level: 'provincial', legalSystem: 'civil_law' },
  { name: 'Saskatchewan', code: 'SK', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Northwest Territories', code: 'NT', level: 'territorial', legalSystem: 'common_law' },
  { name: 'Nunavut', code: 'NU', level: 'territorial', legalSystem: 'common_law' },
  { name: 'Yukon', code: 'YT', level: 'territorial', legalSystem: 'common_law' },
];
