/**
 * Simplified SVG path data for the Canada jurisdiction map.
 * Each province/territory has an approximate outline path and a label anchor.
 * Codes match the jurisdiction `code` column seeded by the API (apps/api/db/seed.ts).
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

// SVG viewBox is 0 0 870 520
export const MAP_VIEWBOX = { width: 870, height: 520 };

export const PROVINCE_MAP_DATA: ProvinceMapData[] = [
  // Territories (north)
  {
    code: 'YT',
    name: 'Yukon',
    path: 'M80,30 L160,30 L160,180 L140,200 L80,200 Z',
    center: [120, 115],
    level: 'territorial',
    legalSystem: 'common_law',
  },
  {
    code: 'NT',
    name: 'Northwest Territories',
    path: 'M165,30 L370,30 L400,80 L380,140 L350,180 L300,210 L250,200 L200,210 L165,200 L165,180 Z',
    center: [280, 120],
    level: 'territorial',
    legalSystem: 'common_law',
  },
  {
    code: 'NU',
    name: 'Nunavut',
    path: 'M375,30 L580,30 L620,60 L650,30 L700,50 L680,100 L620,130 L660,170 L630,210 L570,190 L530,220 L480,200 L450,230 L405,200 L385,140 L405,80 Z',
    center: [540, 130],
    level: 'territorial',
    legalSystem: 'common_law',
  },
  // Western provinces
  {
    code: 'BC',
    name: 'British Columbia',
    path: 'M50,205 L80,205 L140,205 L155,210 L160,260 L170,290 L150,340 L130,380 L100,420 L70,440 L50,410 L40,360 L45,300 Z',
    center: [105, 320],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  {
    code: 'AB',
    name: 'Alberta',
    path: 'M160,210 L250,210 L250,420 L160,420 L150,340 L170,290 L160,260 Z',
    center: [205, 320],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  {
    code: 'SK',
    name: 'Saskatchewan',
    path: 'M255,215 L350,215 L350,420 L255,420 Z',
    center: [302, 320],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  {
    code: 'MB',
    name: 'Manitoba',
    path: 'M355,215 L450,215 L460,250 L445,300 L455,350 L450,420 L355,420 Z',
    center: [405, 320],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  // Central provinces
  {
    code: 'ON',
    name: 'Ontario',
    path: 'M455,215 L530,225 L560,250 L580,300 L590,350 L600,400 L620,450 L600,480 L560,500 L520,490 L490,470 L470,440 L455,420 Z',
    center: [525, 370],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  {
    code: 'QC',
    name: 'Quebec',
    path: 'M565,200 L630,215 L680,180 L720,200 L740,250 L730,300 L710,350 L690,390 L660,420 L630,450 L605,470 L565,500 L560,460 L575,420 L585,380 L595,350 L585,300 L565,250 Z',
    center: [650, 330],
    level: 'provincial',
    legalSystem: 'civil_law',
  },
  // Atlantic provinces
  {
    code: 'NL',
    name: 'Newfoundland and Labrador',
    path: 'M725,200 L780,180 L800,200 L790,250 L770,280 L745,260 L725,240 Z M760,300 L810,290 L830,310 L820,350 L790,370 L760,350 Z',
    center: [785, 320],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  {
    code: 'NB',
    name: 'New Brunswick',
    path: 'M680,420 L720,410 L740,430 L730,465 L700,475 L680,460 Z',
    center: [710, 443],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  {
    code: 'NS',
    name: 'Nova Scotia',
    path: 'M720,470 L740,465 L780,470 L800,485 L790,500 L760,505 L730,495 Z',
    center: [760, 487],
    level: 'provincial',
    legalSystem: 'common_law',
  },
  {
    code: 'PE',
    name: 'Prince Edward Island',
    path: 'M745,440 L775,435 L780,448 L750,452 Z',
    center: [762, 444],
    level: 'provincial',
    legalSystem: 'common_law',
  },
];
