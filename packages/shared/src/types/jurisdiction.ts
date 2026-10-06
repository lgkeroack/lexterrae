export type JurisdictionLevel =
  | 'federal'
  | 'provincial'
  | 'territorial'
  | 'regional'
  | 'municipal'
  | 'indigenous';

/** Every level, broadest first. */
export const JURISDICTION_LEVELS: readonly JurisdictionLevel[] = [
  'federal',
  'provincial',
  'territorial',
  'regional',
  'municipal',
  'indigenous',
];

export const JURISDICTION_LEVEL_LABELS: Record<JurisdictionLevel, string> = {
  federal: 'Federal',
  provincial: 'Provincial',
  territorial: 'Territorial',
  regional: 'Regional',
  municipal: 'Municipal',
  indigenous: 'Indigenous',
};

export type LegalSystem = 'common_law' | 'civil_law' | 'bijural';

export interface Jurisdiction {
  id: string;
  name: string;
  code: string;
  level: JurisdictionLevel;
  /** Kind within the level, e.g. "Regional district", "Township", "Indian reserve". */
  subtype: string | null;
  parentId: string | null;
  legalSystem: LegalSystem;
  geoCode: string | null;
  population: number | null;
  createdAt: string;
  /** Added by the signed-in user (only they can see it), not part of the official list. */
  isCustom: boolean;
}

export interface JurisdictionTreeNode extends Jurisdiction {
  children: JurisdictionTreeNode[];
}

/** An ancestor shown for context, e.g. the regional district and province of a village. */
export interface JurisdictionPathItem {
  id: string;
  name: string;
  code: string;
  level: JurisdictionLevel;
}

/** A jurisdiction with its ancestors (broadest first, excluding Canada). */
export interface JurisdictionSearchResult {
  id: string;
  name: string;
  code: string;
  level: JurisdictionLevel;
  subtype: string | null;
  parentId: string | null;
  isCustom: boolean;
  path: JurisdictionPathItem[];
}

/** GET /api/jurisdictions/top-level: Canada and the provinces and territories. */
export interface TopLevelJurisdictions {
  federal: { id: string; name: string; code: string };
  provinces: {
    id: string;
    name: string;
    code: string;
    level: 'provincial' | 'territorial';
    legalSystem: LegalSystem;
  }[];
}

/** POST /api/jurisdictions body: adds a jurisdiction visible only to the signed-in user. */
export interface CreateJurisdictionRequest {
  name: string;
  level: JurisdictionLevel;
  /** Required for every level except federal. */
  parentId?: string;
  subtype?: string;
}

/** Shape returned by GET /api/jurisdictions/provinces (wrapped in { data }). */
export interface ProvinceData {
  id?: string;
  name: string;
  code: string;
  level: 'provincial' | 'territorial';
  legalSystem: LegalSystem;
  municipalities: MunicipalityData[];
}

export interface MunicipalityData {
  id?: string;
  name: string;
  code: string;
}
