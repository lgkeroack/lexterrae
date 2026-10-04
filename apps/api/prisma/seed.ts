import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

async function upsertJurisdiction(data: {
  name: string;
  code: string;
  level: string;
  parentId?: string | null;
  legalSystem: string;
  geoCode?: string | null;
  population?: number | null;
}) {
  return prisma.jurisdiction.upsert({
    where: { code: data.code },
    update: {
      name: data.name,
      level: data.level,
      parentId: data.parentId ?? null,
      legalSystem: data.legalSystem,
      geoCode: data.geoCode ?? null,
      population: data.population ?? null,
    },
    create: {
      name: data.name,
      code: data.code,
      level: data.level,
      parentId: data.parentId ?? null,
      legalSystem: data.legalSystem,
      geoCode: data.geoCode ?? null,
      population: data.population ?? null,
    },
  });
}

/**
 * Builds a stable ASCII code for a municipality, e.g. "QC-MONTREAL", "NL-ST_JOHNS".
 * Accents are stripped and any non-alphanumeric run becomes a single underscore.
 */
function municipalityCode(provinceCode: string, cityName: string): string {
  const slug = cityName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${provinceCode}-${slug}`;
}

/** Code format produced by earlier versions of this seed (kept so re-seeding renames instead of duplicating). */
function legacyMunicipalityCode(provinceCode: string, cityName: string): string {
  return `${provinceCode}-${cityName.toUpperCase().replace(/\s+/g, '_').replace(/['']/g, '_')}`;
}

export async function main() {
  console.log('Seeding Canadian jurisdictions...');

  // ─── Federal ──────────────────────────────────────────────────────────────────
  const federal = await upsertJurisdiction({
    name: 'Canada',
    code: 'CA',
    level: 'federal',
    legalSystem: 'bijural',
    geoCode: 'CA',
  });
  console.log(`  Federal: ${federal.name} (${federal.code})`);

  // ─── Provinces & Territories ──────────────────────────────────────────────────
  const provincesAndTerritories: {
    name: string;
    code: string;
    level: 'provincial' | 'territorial';
    legalSystem: 'common_law' | 'civil_law';
    municipalities: string[];
  }[] = [
    {
      name: 'British Columbia',
      code: 'BC',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Vancouver',
        'Victoria',
        'Surrey',
        'Burnaby',
        'Richmond',
        'Kelowna',
        'Kamloops',
        'Nanaimo',
        'Squamish',
        'Whistler',
        'Prince George',
        'Abbotsford',
      ],
    },
    {
      name: 'Alberta',
      code: 'AB',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Calgary',
        'Edmonton',
        'Red Deer',
        'Lethbridge',
        'Medicine Hat',
        'Grande Prairie',
        'St. Albert',
        'Airdrie',
      ],
    },
    {
      name: 'Saskatchewan',
      code: 'SK',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Regina',
        'Saskatoon',
        'Prince Albert',
        'Moose Jaw',
        'Swift Current',
      ],
    },
    {
      name: 'Manitoba',
      code: 'MB',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Winnipeg',
        'Brandon',
        'Thompson',
        'Steinbach',
        'Portage la Prairie',
      ],
    },
    {
      name: 'Ontario',
      code: 'ON',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Toronto',
        'Ottawa',
        'Mississauga',
        'Brampton',
        'Hamilton',
        'London',
        'Markham',
        'Vaughan',
        'Kitchener',
        'Windsor',
        'Richmond Hill',
        'Oakville',
        'Burlington',
      ],
    },
    {
      name: 'Quebec',
      code: 'QC',
      level: 'provincial',
      legalSystem: 'civil_law',
      municipalities: [
        'Montréal',
        'Québec City',
        'Laval',
        'Gatineau',
        'Longueuil',
        'Sherbrooke',
        'Lévis',
        'Saguenay',
        'Trois-Rivières',
      ],
    },
    {
      name: 'New Brunswick',
      code: 'NB',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Fredericton',
        'Saint John',
        'Moncton',
        'Dieppe',
        'Riverview',
      ],
    },
    {
      name: 'Nova Scotia',
      code: 'NS',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Halifax',
        'Cape Breton',
        'Dartmouth',
        'Truro',
        'New Glasgow',
      ],
    },
    {
      name: 'Prince Edward Island',
      code: 'PE',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        'Charlottetown',
        'Summerside',
        'Stratford',
        'Cornwall',
      ],
    },
    {
      name: 'Newfoundland and Labrador',
      code: 'NL',
      level: 'provincial',
      legalSystem: 'common_law',
      municipalities: [
        "St. John's",
        'Mount Pearl',
        'Corner Brook',
        'Conception Bay South',
        'Paradise',
      ],
    },
    {
      name: 'Yukon',
      code: 'YT',
      level: 'territorial',
      legalSystem: 'common_law',
      municipalities: [
        'Whitehorse',
        'Dawson City',
      ],
    },
    {
      name: 'Northwest Territories',
      code: 'NT',
      level: 'territorial',
      legalSystem: 'common_law',
      municipalities: [
        'Yellowknife',
        'Hay River',
        'Inuvik',
      ],
    },
    {
      name: 'Nunavut',
      code: 'NU',
      level: 'territorial',
      legalSystem: 'common_law',
      municipalities: [
        'Iqaluit',
        'Rankin Inlet',
        'Arviat',
      ],
    },
  ];

  for (const pt of provincesAndTerritories) {
    // Upsert the province / territory
    const parent = await upsertJurisdiction({
      name: pt.name,
      code: pt.code,
      level: pt.level,
      parentId: federal.id,
      legalSystem: pt.legalSystem,
      geoCode: `CA-${pt.code}`,
    });
    console.log(`  ${pt.level === 'provincial' ? 'Province' : 'Territory'}: ${parent.name} (${parent.code})`);

    // Upsert each municipality within this province / territory
    for (const cityName of pt.municipalities) {
      const code = municipalityCode(pt.code, cityName);
      const legacyCode = legacyMunicipalityCode(pt.code, cityName);
      if (legacyCode !== code) {
        await prisma.jurisdiction.updateMany({ where: { code: legacyCode }, data: { code } });
      }
      const municipality = await upsertJurisdiction({
        name: cityName,
        code,
        level: 'municipal',
        parentId: parent.id,
        legalSystem: pt.legalSystem,
      });
      console.log(`    Municipality: ${municipality.name} (${municipality.code})`);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────────
  const totalCount = await prisma.jurisdiction.count();
  console.log(`\nSeeding complete. Total jurisdictions: ${totalCount}`);

  // Invalidate the cached jurisdiction tree so the API serves fresh data (best effort).
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    await redis.del('jurisdictions:tree');
    console.log('Cleared cached jurisdiction tree.');
  } catch {
    console.warn('Could not clear jurisdiction tree cache (Redis unavailable); it expires within 24h.');
  } finally {
    redis.disconnect();
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
