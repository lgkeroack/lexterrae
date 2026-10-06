import { describe, expect, it } from 'vitest';
import { buildRecords } from './build-jurisdictions.js';

function csd(
  CSDUID: string,
  CSDNAME: string,
  CSDTYPE: string,
  CDUID: string,
  CDNAME: string,
  CDTYPE: string,
) {
  return { PRUID: CSDUID.slice(0, 2), CDUID, CDNAME, CDTYPE, CSDUID, CSDNAME, CSDTYPE };
}

describe('buildRecords', () => {
  const records = buildRecords([
    // Ontario: a region with a city, a single-tier city in a statistical division, a reserve
    csd('3521005', 'Mississauga', 'CY', '3521', 'Peel', 'RM'),
    csd('3525005', 'Hamilton', 'CY', '3525', 'Hamilton', 'CDR'),
    csd('3514019', 'Hamilton', 'TP', '3514', 'Northumberland', 'CTY'),
    csd('3528052', 'New Credit (Part) 40A', 'IRI', '3528', 'Haldimand-Norfolk', 'CDR'),
    // Not jurisdictions: unorganized area, BC electoral area
    csd('3554094', 'Timiskaming, Unorganized, West Part', 'NO', '3554', 'Timiskaming', 'DIS'),
    csd('5901017', 'East Kootenay A', 'RDA', '5901', 'East Kootenay', 'RD'),
    // Nova Scotia county municipality split into statistical subdivisions
    csd('1205001', 'Annapolis, Subd. A', 'SC', '1205', 'Annapolis', 'CTY'),
    csd('1205002', 'Annapolis, Subd. B', 'SC', '1205', 'Annapolis', 'CTY'),
    // One Indian government district split across divisions
    csd('5929022', 'Sechelt (Part)', 'IGD', '5929', 'Sunshine Coast', 'RD'),
    csd('5931020', 'Sechelt (Part)', 'IGD', '5931', 'Squamish-Lillooet', 'RD'),
  ]);
  const byCode = new Map(records.map((r) => [r.code, r]));

  it('puts municipalities under their regional government, else the province', () => {
    expect(byCode.get('ON-MISSISSAUGA')).toMatchObject({
      level: 'municipal',
      subtype: 'City',
      parent: 'ON-REG-PEEL',
    });
    expect(byCode.get('ON-REG-PEEL')).toMatchObject({ level: 'regional', parent: 'ON' });
    // Statistical census divisions ("CDR") are not jurisdictions
    expect(byCode.has('ON-REG-HAMILTON')).toBe(false);
  });

  it('lets the city keep the plain code when names collide', () => {
    expect(byCode.get('ON-HAMILTON')).toMatchObject({ subtype: 'City', parent: 'ON' });
    expect(byCode.get('ON-HAMILTON-3514019')).toMatchObject({
      subtype: 'Township',
      parent: 'ON-REG-NORTHUMBERLAND',
    });
  });

  it('classifies Indigenous lands and merges split entries', () => {
    expect(byCode.get('ON-IND-NEW_CREDIT_40A')).toMatchObject({
      name: 'New Credit 40A',
      level: 'indigenous',
      subtype: 'Indian reserve',
      parent: 'ON',
    });
    // "Sechelt (Part)" in two regional districts is one jurisdiction, placed under the province
    expect(records.filter((r) => r.name === 'Sechelt')).toEqual([
      expect.objectContaining({ code: 'BC-IND-SECHELT', parent: 'BC' }),
    ]);
  });

  it('merges Nova Scotia county subdivisions into one county municipality', () => {
    const counties = records.filter((r) => r.subtype === 'County municipality');
    expect(counties).toEqual([
      expect.objectContaining({
        name: 'Municipality of the County of Annapolis',
        parent: 'NS-REG-ANNAPOLIS',
      }),
    ]);
  });

  it('leaves out areas without a government of their own', () => {
    expect(records.some((r) => r.name.includes('Unorganized'))).toBe(false);
    expect(records.some((r) => r.name === 'East Kootenay A')).toBe(false);
    expect(byCode.get('ON-REG-TIMISKAMING')).toMatchObject({ subtype: 'District' });
  });
});
