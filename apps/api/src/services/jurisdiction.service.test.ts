import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../types.js';
import {
  clearJurisdictionCache,
  createJurisdiction,
  deleteCustomJurisdiction,
  getDescendants,
  getSelfAndDescendantIds,
  normalizeName,
  searchJurisdictions,
} from './jurisdiction.service.js';

interface FakeRow {
  id: string;
  name: string;
  code: string;
  level: string;
  subtype: string | null;
  parentId: string | null;
  legalSystem: string;
  geoCode: null;
  population: null;
  createdAt: string;
  isCustom: boolean;
  createdBy?: string;
}

function row(
  id: string,
  name: string,
  level: string,
  parentId: string | null,
  subtype: string | null = null,
  createdBy?: string,
): FakeRow {
  return {
    id,
    name,
    code: id.toUpperCase(),
    level,
    subtype,
    parentId,
    legalSystem: 'common_law',
    geoCode: null,
    population: null,
    createdAt: '2026-01-01T00:00:00Z',
    isCustom: Boolean(createdBy),
    createdBy,
  };
}

const official = [
  row('ca', 'Canada', 'federal', null),
  row('on', 'Ontario', 'provincial', 'ca'),
  row('qc', 'Quebec', 'provincial', 'ca'),
  row('peel', 'Peel', 'regional', 'on', 'Regional municipality'),
  row('mississauga', 'Mississauga', 'municipal', 'peel', 'City'),
  // Same name: the township (listed first, numbered code) must not outrank the city
  {
    ...row('hamilton-twp', 'Hamilton', 'municipal', 'on', 'Township'),
    code: 'ON-HAMILTON-3514019',
  },
  { ...row('hamilton-city', 'Hamilton', 'municipal', 'on', 'City'), code: 'ON-HAMILTON' },
  row('stjerome', 'Saint-Jérôme', 'municipal', 'qc', 'City (ville)'),
  row('new-credit', 'New Credit 40A', 'indigenous', 'on', 'Indian reserve'),
];

/** Fake Neon client: answers the queries the service makes from in-memory rows. */
function fakeDeps(custom: FakeRow[] = []) {
  const inserted: unknown[][] = [];
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (text.includes('WHERE created_by IS NULL')) return official;
    if (text.includes('WHERE created_by = $1')) {
      return custom.filter((r) => r.createdBy === params[0]);
    }
    if (text.startsWith('INSERT')) {
      inserted.push(params);
      const [name, code, level, subtype, parentId] = params as (string | null)[];
      return [{ ...row('new-id', name!, level!, parentId!, subtype, 'u1'), code }];
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  const deps = {
    sql: { query },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Deps;
  return { deps, inserted };
}

beforeEach(() => clearJurisdictionCache());

describe('normalizeName', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeName('Saint-Jérôme')).toBe('saint jerome');
    expect(normalizeName("St. John's")).toBe('st john s');
  });
});

describe('searchJurisdictions', () => {
  it('finds names regardless of accents and gives each result its path', async () => {
    const { deps } = fakeDeps();
    const [first] = await searchJurisdictions(deps, undefined, { q: 'saint jerome', limit: 10 });
    expect(first).toMatchObject({ name: 'Saint-Jérôme', path: [{ code: 'QC' }] });
  });

  it('ranks exact names first, then by level, and matches ancestor names', async () => {
    const { deps } = fakeDeps();
    const results = await searchJurisdictions(deps, undefined, { q: 'peel', limit: 10 });
    expect(results.map((r) => r.name)).toEqual(['Peel']);

    const inPeel = await searchJurisdictions(deps, undefined, { q: 'mississauga peel', limit: 10 });
    expect(inPeel[0]).toMatchObject({
      name: 'Mississauga',
      path: [{ name: 'Ontario' }, { name: 'Peel' }],
    });
  });

  it('filters by level and by containing jurisdiction', async () => {
    const { deps } = fakeDeps();
    const towns = await searchJurisdictions(deps, undefined, {
      q: 'hamilton',
      level: 'municipal',
      within: 'on',
      limit: 10,
    });
    expect(towns.map((r) => r.subtype)).toEqual(['City', 'Township']);
    await expect(
      searchJurisdictions(deps, undefined, { q: 'hamilton', within: 'qc', limit: 10 }),
    ).resolves.toEqual([]);
  });

  it("shows a user's own jurisdictions only to them", async () => {
    const custom = [row('mine', 'Credit Valley Conservation', 'regional', 'on', null, 'u1')];
    const { deps } = fakeDeps(custom);
    const forOwner = await searchJurisdictions(deps, 'u1', { q: 'credit valley', limit: 10 });
    expect(forOwner.map((r) => [r.name, r.isCustom])).toEqual([
      ['Credit Valley Conservation', true],
    ]);
    await expect(
      searchJurisdictions(deps, 'u2', { q: 'credit valley', limit: 10 }),
    ).resolves.toEqual([]);
    await expect(
      searchJurisdictions(deps, undefined, { q: 'credit valley', limit: 10 }),
    ).resolves.toEqual([]);
  });
});

describe('getDescendants / getSelfAndDescendantIds', () => {
  it('returns everything inside a province, including nested levels', async () => {
    const { deps } = fakeDeps();
    const inside = await getDescendants(deps, undefined, 'on');
    expect(inside.map((r) => r.id).sort()).toEqual(
      ['hamilton-city', 'hamilton-twp', 'mississauga', 'new-credit', 'peel'].sort(),
    );
    await expect(getSelfAndDescendantIds(deps, 'peel')).resolves.toEqual(['peel', 'mississauga']);
  });
});

describe('createJurisdiction', () => {
  it('adds a private jurisdiction under a visible parent', async () => {
    const { deps, inserted } = fakeDeps();
    const created = await createJurisdiction(deps, 'u1', {
      name: 'Credit Valley Conservation',
      level: 'regional',
      parentId: 'on',
      subtype: 'Conservation authority',
    });
    expect(created).toMatchObject({ isCustom: true, path: [{ code: 'ON' }] });
    const [name, code, level, subtype, parentId, legal, owner] = inserted[0]!;
    expect([name, level, subtype, parentId, legal, owner]).toEqual([
      'Credit Valley Conservation',
      'regional',
      'Conservation authority',
      'on',
      'common_law',
      'u1',
    ]);
    expect(code).toMatch(/^X-/);
  });

  it('places new provinces under Canada and rejects impossible nesting', async () => {
    const { deps, inserted } = fakeDeps();
    await createJurisdiction(deps, 'u1', { name: 'New Province', level: 'provincial' });
    expect(inserted[0]![4]).toBe('ca');

    await expect(
      createJurisdiction(deps, 'u1', { name: 'Town', level: 'municipal', parentId: 'ca' }),
    ).rejects.toThrow(/must be inside/);
    await expect(
      createJurisdiction(deps, 'u1', { name: 'Town', level: 'municipal' }),
    ).rejects.toThrow(/must be inside/);
    await expect(
      createJurisdiction(deps, 'u1', { name: 'Agency', level: 'federal', parentId: 'on' }),
    ).rejects.toThrow(/cannot have a parent/);
  });

  it("rejects duplicates and another user's jurisdiction as parent", async () => {
    const custom = [row('theirs', 'Their Region', 'regional', 'on', null, 'u2')];
    const { deps } = fakeDeps(custom);
    await expect(
      createJurisdiction(deps, 'u1', { name: 'mississauga', level: 'municipal', parentId: 'peel' }),
    ).rejects.toThrow(/already exists in Peel/);
    await expect(
      createJurisdiction(deps, 'u1', { name: 'Town', level: 'municipal', parentId: 'theirs' }),
    ).rejects.toThrow(/parent jurisdiction was not found/);
  });
});

describe('deleteCustomJurisdiction', () => {
  function depsWith(row: { name: string; documents: number; children: number } | undefined) {
    const query = vi.fn(async (text: string) =>
      text.startsWith('SELECT') ? (row ? [row] : []) : [],
    );
    return { deps: { sql: { query }, log: { info: vi.fn() } } as unknown as Deps, query };
  }

  it("deletes the user's own unused jurisdiction", async () => {
    const { deps, query } = depsWith({ name: 'Mine', documents: 0, children: 0 });
    await deleteCustomJurisdiction(deps, 'u1', 'j1');
    expect(query).toHaveBeenLastCalledWith(expect.stringMatching(/^DELETE/), ['j1', 'u1']);
  });

  it('refuses one that is in use, has children, or is not theirs', async () => {
    await expect(
      deleteCustomJurisdiction(
        depsWith({ name: 'Mine', documents: 2, children: 0 }).deps,
        'u1',
        'j1',
      ),
    ).rejects.toThrow(/used by 2 documents/);
    await expect(
      deleteCustomJurisdiction(
        depsWith({ name: 'Mine', documents: 0, children: 1 }).deps,
        'u1',
        'j1',
      ),
    ).rejects.toThrow(/inside it/);
    await expect(deleteCustomJurisdiction(depsWith(undefined).deps, 'u2', 'j1')).rejects.toThrow(
      /not found/,
    );
  });
});
