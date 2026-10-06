/**
 * Seeds the official Canadian jurisdiction hierarchy (idempotent: safe to re-run).
 *
 *   Canada → 13 provinces and territories → regional (counties, regional districts, MRCs, …)
 *   → municipal, plus Indigenous lands (reserves, settlements, self-government lands).
 *
 * Everything below the provinces comes from db/data/jurisdictions.json, built from Statistics
 * Canada's census subdivision boundary file by db/data/build-jurisdictions.ts. User-added
 * jurisdictions (created_by set) are never touched.
 *
 * Usage: pnpm --filter @lexterrae/api db:seed
 */
import { readFile } from 'node:fs/promises';
import { sql } from './connect.js';
import type { JurisdictionRecord } from './data/build-jurisdictions.js';

const PROVINCES: {
  name: string;
  code: string;
  level: 'provincial' | 'territorial';
  legalSystem: 'common_law' | 'civil_law';
}[] = [
  { name: 'British Columbia', code: 'BC', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Alberta', code: 'AB', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Saskatchewan', code: 'SK', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Manitoba', code: 'MB', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Ontario', code: 'ON', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Quebec', code: 'QC', level: 'provincial', legalSystem: 'civil_law' },
  { name: 'New Brunswick', code: 'NB', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Nova Scotia', code: 'NS', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Prince Edward Island', code: 'PE', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Newfoundland and Labrador', code: 'NL', level: 'provincial', legalSystem: 'common_law' },
  { name: 'Yukon', code: 'YT', level: 'territorial', legalSystem: 'common_law' },
  { name: 'Northwest Territories', code: 'NT', level: 'territorial', legalSystem: 'common_law' },
  { name: 'Nunavut', code: 'NU', level: 'territorial', legalSystem: 'common_law' },
];

const BATCH_SIZE = 1000;

/** Official rows only: a user-added jurisdiction can never be overwritten by the seed. */
const UPSERT_CONFLICT = `
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    level = EXCLUDED.level,
    subtype = EXCLUDED.subtype,
    parent_id = EXCLUDED.parent_id,
    legal_system = EXCLUDED.legal_system,
    geo_code = EXCLUDED.geo_code
  WHERE jurisdictions.created_by IS NULL`;

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bcity\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function upsertRecords(records: JurisdictionRecord[], legalByProvince: Map<string, string>) {
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    // Parents are resolved by code in SQL: regional rows are upserted before their children
    await sql.query(
      `INSERT INTO jurisdictions (name, code, level, subtype, parent_id, legal_system, geo_code)
       SELECT d.name, d.code, d.level, d.subtype, p.id, d.legal_system, d.geo_code
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
         AS d(name, code, level, subtype, parent_code, legal_system, geo_code)
       JOIN jurisdictions p ON p.code = d.parent_code AND p.created_by IS NULL
       ${UPSERT_CONFLICT}`,
      [
        batch.map((r) => r.name),
        batch.map((r) => r.code),
        batch.map((r) => r.level),
        batch.map((r) => r.subtype),
        batch.map((r) => r.parent),
        batch.map((r) => legalByProvince.get(r.province) ?? 'common_law'),
        batch.map((r) => r.geoCode),
      ],
    );
  }
}

/**
 * Official rows below the provinces that the dataset no longer lists (e.g. the hand-picked
 * "Dartmouth" from earlier seeds). Documents tagged with one move to the official jurisdiction of
 * the same name in the same province when there is one; unreferenced rows are removed.
 */
async function retireStaleRows(codes: Set<string>) {
  const rows = (await sql`
    SELECT j.id, j.code, j.name, j.level,
           (SELECT pr.code FROM jurisdictions pr WHERE pr.id = j.parent_id) AS parent_code
    FROM jurisdictions j
    WHERE j.created_by IS NULL AND j.level IN ('regional', 'municipal', 'indigenous')`) as {
    id: string;
    code: string;
    name: string;
    level: string;
    parent_code: string | null;
  }[];
  const stale = rows.filter((r) => !codes.has(r.code));
  if (stale.length === 0) return;

  const current = rows.filter((r) => codes.has(r.code));
  for (const old of stale) {
    const province = old.code.split('-')[0];
    const candidates = current.filter(
      (c) =>
        c.level === old.level &&
        c.code.startsWith(`${province}-`) &&
        normalize(c.name) === normalize(old.name),
    );
    // Prefer the place that kept a plain code (e.g. the city over a same-named township)
    const replacement =
      candidates.length === 1 ? candidates[0] : candidates.find((c) => !/-\d{4,}$/.test(c.code));
    let moved = 0;
    if (replacement) {
      const movedRows = await sql`
        INSERT INTO document_jurisdictions (document_id, jurisdiction_id)
        SELECT document_id, ${replacement.id}::uuid FROM document_jurisdictions
        WHERE jurisdiction_id = ${old.id}::uuid
        ON CONFLICT DO NOTHING
        RETURNING document_id`;
      moved = movedRows.length;
      await sql`DELETE FROM document_jurisdictions WHERE jurisdiction_id = ${old.id}::uuid`;
    }
    const [{ in_use: inUse }] = (await sql`
      SELECT EXISTS (SELECT 1 FROM document_jurisdictions WHERE jurisdiction_id = ${old.id}::uuid)
        AS in_use`) as [{ in_use: boolean }];
    if (inUse) {
      console.log(`  Kept ${old.code} (not in the dataset, but documents use it)`);
    } else {
      await sql`UPDATE jurisdictions SET parent_id = NULL WHERE parent_id = ${old.id}::uuid`;
      await sql`DELETE FROM jurisdictions WHERE id = ${old.id}::uuid`;
      console.log(
        `  Retired ${old.code}${moved ? ` (${moved} document(s) moved to ${replacement!.code})` : ''}`,
      );
    }
  }
}

async function main() {
  console.log('Seeding Canadian jurisdictions...');

  const [federal] = (await sql`
    INSERT INTO jurisdictions (name, code, level, subtype, legal_system, geo_code)
    VALUES ('Canada', 'CA', 'federal', 'Federal', 'bijural', 'CA')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level,
      subtype = EXCLUDED.subtype, legal_system = EXCLUDED.legal_system
    RETURNING id`) as [{ id: string }];

  for (const p of PROVINCES) {
    await sql`
      INSERT INTO jurisdictions (name, code, level, subtype, parent_id, legal_system, geo_code)
      VALUES (${p.name}, ${p.code}, ${p.level},
              ${p.level === 'provincial' ? 'Province' : 'Territory'}, ${federal.id},
              ${p.legalSystem}, ${`CA-${p.code}`})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level,
        subtype = EXCLUDED.subtype, parent_id = EXCLUDED.parent_id,
        legal_system = EXCLUDED.legal_system, geo_code = EXCLUDED.geo_code`;
  }
  console.log(`  Federal and ${PROVINCES.length} provinces and territories`);

  const data = JSON.parse(
    await readFile(new URL('./data/jurisdictions.json', import.meta.url), 'utf8'),
  ) as { source: string; records: JurisdictionRecord[] };
  const legalByProvince = new Map(PROVINCES.map((p) => [p.code, p.legalSystem]));

  for (const level of ['regional', 'municipal', 'indigenous'] as const) {
    const records = data.records.filter((r) => r.level === level);
    await upsertRecords(records, legalByProvince);
    console.log(`  ${level}: ${records.length}`);
  }
  await retireStaleRows(new Set(data.records.map((r) => r.code)));

  const [{ count }] = (await sql`
    SELECT count(*)::int AS count FROM jurisdictions WHERE created_by IS NULL`) as [
    { count: number },
  ];
  console.log(`\nSource: ${data.source}`);
  console.log(`Seeding complete. Total jurisdictions: ${count}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
