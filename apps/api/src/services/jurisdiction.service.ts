import type {
  JurisdictionLevel,
  JurisdictionPathItem,
  JurisdictionSearchResult,
} from '@lexterrae/shared';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import type { Deps } from '../types.js';

export interface JurisdictionNode {
  id: string;
  name: string;
  code: string;
  level: string;
  subtype: string | null;
  parentId: string | null;
  legalSystem: string;
  geoCode: string | null;
  population: number | null;
  createdAt: string;
  isCustom: boolean;
  children: JurisdictionNode[];
}

type Row = Omit<JurisdictionNode, 'children'>;

export interface JurisdictionRef {
  id: string;
  name: string;
  code: string;
  level: string;
}

/** Codes the data build disambiguated with a StatCan number, e.g. "ON-HAMILTON-3514019". */
const NUMBERED_CODE = /-\d{4,}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEVEL_ORDER: Record<string, number> = {
  federal: 0,
  provincial: 1,
  territorial: 2,
  regional: 3,
  municipal: 4,
  indigenous: 5,
};

/** Which levels a jurisdiction of each level may sit under. */
const ALLOWED_PARENT_LEVELS: Record<JurisdictionLevel, readonly string[]> = {
  federal: [],
  provincial: ['federal'],
  territorial: ['federal'],
  regional: ['provincial', 'territorial'],
  municipal: ['provincial', 'territorial', 'regional'],
  indigenous: ['provincial', 'territorial', 'regional'],
};

/** Each user may add this many jurisdictions of their own. */
export const MAX_CUSTOM_JURISDICTIONS = 500;

const JURISDICTION_COLUMNS = `id, name, code, level, subtype, parent_id AS "parentId",
  legal_system AS "legalSystem", geo_code AS "geoCode", population, created_at AS "createdAt",
  (created_by IS NOT NULL) AS "isCustom"`;

/** Lowercase, accents and punctuation removed: "Saint-Jérôme" → "saint jerome". */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Indexed extends Row {
  norm: string;
}

class JurisdictionIndex {
  readonly byId = new Map<string, Indexed>();
  readonly byCode = new Map<string, Indexed>();
  readonly children = new Map<string, Indexed[]>();

  constructor(readonly rows: Indexed[]) {
    for (const r of rows) {
      this.byId.set(r.id, r);
      this.byCode.set(r.code, r);
    }
    for (const r of rows) {
      if (r.parentId) this.children.set(r.parentId, [...(this.children.get(r.parentId) ?? []), r]);
    }
  }
}

/** The official list (user-added rows excluded) changes only when the seed runs: cache it. */
const CACHE_TTL_MS = 5 * 60 * 1000;
let officialCache: { at: number; index: JurisdictionIndex } | undefined;

/** Drops the cached official list (tests, or after re-seeding in a long-lived process). */
export function clearJurisdictionCache(): void {
  officialCache = undefined;
}

function indexRows(rows: Row[]): Indexed[] {
  return rows.map((r) => ({ ...r, norm: normalizeName(r.name) }));
}

async function officialIndex(deps: Deps): Promise<JurisdictionIndex> {
  if (officialCache && Date.now() - officialCache.at < CACHE_TTL_MS) return officialCache.index;
  const rows = (await deps.sql.query(
    `SELECT ${JURISDICTION_COLUMNS} FROM jurisdictions WHERE created_by IS NULL ORDER BY name`,
  )) as Row[];
  const index = new JurisdictionIndex(indexRows(rows));
  officialCache = { at: Date.now(), index };
  return index;
}

/** Official jurisdictions plus the user's own (if signed in). */
class VisibleJurisdictions {
  private readonly customChildren = new Map<string, Indexed[]>();
  private readonly customById = new Map<string, Indexed>();

  constructor(
    readonly official: JurisdictionIndex,
    readonly custom: Indexed[],
  ) {
    for (const r of custom) {
      this.customById.set(r.id, r);
      if (r.parentId) {
        this.customChildren.set(r.parentId, [...(this.customChildren.get(r.parentId) ?? []), r]);
      }
    }
  }

  get(id: string): Indexed | undefined {
    return this.customById.get(id) ?? this.official.byId.get(id);
  }

  childrenOf(id: string): Indexed[] {
    return [...(this.official.children.get(id) ?? []), ...(this.customChildren.get(id) ?? [])];
  }

  *all(): Iterable<Indexed> {
    yield* this.official.rows;
    yield* this.custom;
  }

  /** Ancestors, broadest first, excluding Canada (it is implied). */
  path(row: Row): JurisdictionPathItem[] {
    const path: JurisdictionPathItem[] = [];
    const seen = new Set<string>();
    let parent = row.parentId ? this.get(row.parentId) : undefined;
    while (parent && !seen.has(parent.id) && parent.level !== 'federal') {
      seen.add(parent.id);
      path.unshift({
        id: parent.id,
        name: parent.name,
        code: parent.code,
        level: parent.level as JurisdictionLevel,
      });
      parent = parent.parentId ? this.get(parent.parentId) : undefined;
    }
    return path;
  }

  toResult(row: Row): JurisdictionSearchResult {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      level: row.level as JurisdictionLevel,
      subtype: row.subtype,
      parentId: row.parentId,
      isCustom: row.isCustom,
      path: this.path(row),
    };
  }

  /** The jurisdiction and everything below it. */
  selfAndDescendants(id: string): Indexed[] {
    const result: Indexed[] = [];
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const row = this.get(current);
      if (row) result.push(row);
      stack.push(...this.childrenOf(current).map((c) => c.id));
    }
    return result;
  }
}

async function visibleTo(deps: Deps, userId: string | undefined): Promise<VisibleJurisdictions> {
  const official = await officialIndex(deps);
  const custom = userId
    ? indexRows(
        (await deps.sql.query(
          `SELECT ${JURISDICTION_COLUMNS} FROM jurisdictions WHERE created_by = $1 ORDER BY name`,
          [userId],
        )) as Row[],
      )
    : [];
  return new VisibleJurisdictions(official, custom);
}

function byLevelThenName(a: Row, b: Row): number {
  return (
    (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99) || a.name.localeCompare(b.name)
  );
}

/** Full official hierarchy, siblings ordered by level then name. */
export async function getJurisdictionTree(deps: Deps): Promise<JurisdictionNode[]> {
  const index = await officialIndex(deps);
  const nodes = new Map<string, JurisdictionNode>();
  for (const { norm: _norm, ...row } of [...index.rows].sort(byLevelThenName)) {
    nodes.set(row.id, { ...row, children: [] });
  }
  const roots: JurisdictionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Canada and the provinces and territories (what the upload map needs). */
export async function getTopLevel(deps: Deps) {
  const index = await officialIndex(deps);
  const federal = index.rows.find((r) => r.level === 'federal');
  if (!federal) throw new NotFoundError('No jurisdictions are configured');
  return {
    federal: { id: federal.id, name: federal.name, code: federal.code },
    provinces: index.rows
      .filter((r) => r.level === 'provincial' || r.level === 'territorial')
      .sort(byLevelThenName)
      .map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        level: r.level,
        legalSystem: r.legalSystem,
      })),
  };
}

export async function getJurisdictionById(deps: Deps, id: string, userId?: string) {
  const rows = await deps.sql.query(
    `SELECT ${JURISDICTION_COLUMNS},
       (SELECT json_build_object('id', p.id, 'name', p.name, 'code', p.code)
          FROM jurisdictions p WHERE p.id = j.parent_id) AS parent,
       COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code,
                                                   'level', c.level) ORDER BY c.name)
          FROM jurisdictions c
          WHERE c.parent_id = j.id AND (c.created_by IS NULL OR c.created_by = $2)), '[]'::json)
         AS children
     FROM jurisdictions j
     WHERE j.id = $1 AND (j.created_by IS NULL OR j.created_by = $2)`,
    [id, userId ?? null],
  );
  if (!rows[0]) throw new NotFoundError(`Jurisdiction with ID "${id}" not found`);
  return rows[0];
}

/** Provinces/territories with all their municipalities (the shared `ProvinceData` shape). */
export async function getProvinces(deps: Deps) {
  const visible = new VisibleJurisdictions(await officialIndex(deps), []);
  return visible.official.rows
    .filter((r) => r.level === 'provincial' || r.level === 'territorial')
    .map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      level: p.level,
      legalSystem: p.legalSystem,
      municipalities: visible
        .selfAndDescendants(p.id)
        .filter((c) => c.level === 'municipal')
        .sort(byLevelThenName)
        .map((c) => ({ id: c.id, name: c.name, code: c.code })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SearchOptions {
  q: string;
  level?: JurisdictionLevel;
  /** Only jurisdictions inside this one (e.g. a province). */
  within?: string;
  limit: number;
}

/**
 * Name search across every level (accent- and case-insensitive). Every word must appear in the
 * name or one of its ancestors' names ("hamilton ontario"), and at least one in the name itself.
 * Exact names rank first, then prefixes, then word prefixes, then other matches.
 */
export async function searchJurisdictions(
  deps: Deps,
  userId: string | undefined,
  options: SearchOptions,
): Promise<JurisdictionSearchResult[]> {
  const visible = await visibleTo(deps, userId);
  const query = normalizeName(options.q);
  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const scope = options.within
    ? new Set(visible.selfAndDescendants(options.within).map((r) => r.id))
    : undefined;

  const scored: { row: Indexed; score: number }[] = [];
  for (const row of visible.all()) {
    if (options.level && row.level !== options.level) continue;
    if (scope && !scope.has(row.id)) continue;
    if (!tokens.some((t) => row.norm.includes(t))) continue;
    const context = `${row.norm} ${visible
      .path(row)
      .map((p) => normalizeName(p.name))
      .join(' ')}`;
    if (!tokens.every((t) => context.includes(t))) continue;
    const words = row.norm.split(' ');
    const score =
      row.norm === query
        ? 0
        : row.norm.startsWith(query)
          ? 1
          : words.some((w) => w.startsWith(tokens[0]!))
            ? 2
            : 3;
    scored.push({ row, score });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (LEVEL_ORDER[a.row.level] ?? 99) - (LEVEL_ORDER[b.row.level] ?? 99) ||
      // Of same-named places, the one with the plain code (the city) before numbered namesakes
      Number(NUMBERED_CODE.test(a.row.code)) - Number(NUMBERED_CODE.test(b.row.code)) ||
      a.row.name.length - b.row.name.length ||
      a.row.name.localeCompare(b.row.name),
  );
  return scored.slice(0, options.limit).map(({ row }) => visible.toResult(row));
}

/** Everything inside a jurisdiction (e.g. all of a province), for browsing. */
export async function getDescendants(
  deps: Deps,
  userId: string | undefined,
  id: string,
  level?: JurisdictionLevel,
): Promise<JurisdictionSearchResult[]> {
  const visible = await visibleTo(deps, userId);
  if (!visible.get(id)) throw new NotFoundError(`Jurisdiction with ID "${id}" not found`);
  return visible
    .selfAndDescendants(id)
    .filter((r) => r.id !== id && (!level || r.level === level))
    .sort(byLevelThenName)
    .map((r) => visible.toResult(r));
}

export interface CreateJurisdictionInput {
  name: string;
  level: JurisdictionLevel;
  parentId?: string;
  subtype?: string;
}

/** Adds a jurisdiction that only this user can see and use. */
export async function createJurisdiction(
  deps: Deps,
  userId: string,
  input: CreateJurisdictionInput,
): Promise<JurisdictionSearchResult> {
  const visible = await visibleTo(deps, userId);
  if (visible.custom.length >= MAX_CUSTOM_JURISDICTIONS) {
    throw new ValidationError(
      `You can add up to ${MAX_CUSTOM_JURISDICTIONS} jurisdictions of your own`,
    );
  }

  const allowed = ALLOWED_PARENT_LEVELS[input.level];
  let parent: Indexed | undefined;
  if (input.parentId) {
    parent = visible.get(input.parentId);
    if (!parent) throw new ValidationError('The parent jurisdiction was not found');
  } else if (input.level === 'provincial' || input.level === 'territorial') {
    // Provinces and territories always sit under Canada
    parent = visible.official.rows.find((r) => r.level === 'federal');
  }
  if (allowed.length === 0 && parent) {
    throw new ValidationError('A federal-level jurisdiction cannot have a parent');
  }
  if (allowed.length > 0 && (!parent || !allowed.includes(parent.level))) {
    throw new ValidationError(
      `A ${input.level} jurisdiction must be inside a ${allowed.join(' or ')} jurisdiction`,
    );
  }

  const norm = normalizeName(input.name);
  const siblings = parent
    ? visible.childrenOf(parent.id)
    : [...visible.all()].filter((r) => !r.parentId);
  const duplicate = siblings.find((s) => s.level === input.level && s.norm === norm);
  if (duplicate) {
    throw new ConflictError(
      `"${duplicate.name}" already exists${parent ? ` in ${parent.name}` : ''}`,
    );
  }

  const rows = (await deps.sql.query(
    `INSERT INTO jurisdictions (name, code, level, subtype, parent_id, legal_system, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${JURISDICTION_COLUMNS}`,
    [
      input.name,
      `X-${crypto.randomUUID()}`,
      input.level,
      input.subtype ?? null,
      parent?.id ?? null,
      parent?.legalSystem ?? 'bijural',
      userId,
    ],
  )) as Row[];
  const created = rows[0]!;
  deps.log.info({
    module: 'jurisdictions',
    message: 'Custom jurisdiction added',
    userId,
    jurisdictionId: created.id,
  });
  return visible.toResult(created);
}

/**
 * Deletes a jurisdiction the user added. Refused while any document (including ones deleted
 * within the undo window) is tagged with it, or while other jurisdictions sit inside it.
 */
export async function deleteCustomJurisdiction(
  deps: Deps,
  userId: string,
  id: string,
): Promise<void> {
  const [row] = (await deps.sql.query(
    `SELECT name,
       (SELECT count(*)::int FROM document_jurisdictions WHERE jurisdiction_id = j.id) AS documents,
       (SELECT count(*)::int FROM jurisdictions c WHERE c.parent_id = j.id) AS children
     FROM jurisdictions j WHERE j.id = $1 AND j.created_by = $2`,
    [id, userId],
  )) as { name: string; documents: number; children: number }[];
  if (!row) throw new NotFoundError(`Jurisdiction with ID "${id}" not found`);
  if (row.documents > 0) {
    throw new ConflictError(
      `"${row.name}" is used by ${row.documents} document${row.documents === 1 ? '' : 's'}. ` +
        'Remove it from them first.',
    );
  }
  if (row.children > 0) {
    throw new ConflictError(`"${row.name}" has jurisdictions inside it. Delete those first.`);
  }
  await deps.sql.query(`DELETE FROM jurisdictions WHERE id = $1 AND created_by = $2`, [id, userId]);
  deps.log.info({
    module: 'jurisdictions',
    message: 'Custom jurisdiction deleted',
    userId,
    jurisdictionId: id,
  });
}

/**
 * The jurisdiction and everything above it: Squamish → Squamish, Squamish-Lillooet, British
 * Columbia, Canada. A document tagged with any of these applies to a case in Squamish.
 */
export async function getSelfAndAncestorIds(
  deps: Deps,
  id: string,
  userId?: string,
): Promise<string[]> {
  const visible = await visibleTo(deps, userId);
  const row = visible.get(id);
  if (!row) throw new NotFoundError(`Jurisdiction with ID "${id}" not found`);
  return [id, ...visible.path(row).map((p) => p.id), ...rootOf(visible, row)];
}

/** `path()` leaves out Canada (it is implied in display); applicability needs it. */
function rootOf(visible: VisibleJurisdictions, row: Row): string[] {
  let current: Row | undefined = row;
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = visible.get(current.parentId);
    if (!parent) break;
    if (parent.level === 'federal') return [parent.id];
    current = parent;
  }
  return [];
}

/**
 * The first official jurisdiction found among these codes, tried in order. Used to turn a map
 * location (most specific area first: municipality, region, province) into a jurisdiction.
 */
export async function findByCodes(
  deps: Deps,
  codes: string[],
): Promise<JurisdictionSearchResult | null> {
  const visible = await visibleTo(deps, undefined);
  for (const code of codes) {
    const row = visible.official.byCode.get(code);
    if (row) return visible.toResult(row);
  }
  return null;
}

/** Official jurisdictions by ID, with their paths (unknown IDs are left out). */
export async function findByIds(deps: Deps, ids: string[]): Promise<JurisdictionSearchResult[]> {
  const visible = await visibleTo(deps, undefined);
  return ids.flatMap((id) => {
    const row = visible.official.byId.get(id);
    return row ? [visible.toResult(row)] : [];
  });
}

/** Ancestors (broadest first, without Canada) of each jurisdiction, for display. */
export async function getPaths(
  deps: Deps,
  ids: string[],
  userId?: string,
): Promise<Map<string, JurisdictionPathItem[]>> {
  const visible = await visibleTo(deps, userId);
  const paths = new Map<string, JurisdictionPathItem[]>();
  for (const id of new Set(ids)) {
    const row = visible.get(id);
    if (row) paths.set(id, visible.path(row));
  }
  return paths;
}

/** The jurisdiction plus all descendants (e.g. a province and everything in it). */
export async function getSelfAndDescendantIds(
  deps: Deps,
  id: string,
  userId?: string,
): Promise<string[]> {
  const visible = await visibleTo(deps, userId);
  const ids = visible.selfAndDescendants(id).map((r) => r.id);
  return ids.length > 0 ? ids : [id];
}

/**
 * Resolves references (UUIDs or codes such as "BC" / "BC-VANCOUVER") to jurisdictions the user
 * may use: the official list and their own. Throws a ValidationError listing any others.
 */
export async function resolveJurisdictionRefs(
  deps: Deps,
  refs: string[],
  userId: string,
): Promise<JurisdictionRef[]> {
  const unique = [...new Set(refs)];
  const ids = unique.filter((r) => UUID_RE.test(r)).map((r) => r.toLowerCase());
  const codes = unique.filter((r) => !UUID_RE.test(r)).map((r) => r.toUpperCase());

  const rows = (await deps.sql`
    SELECT id, name, code, level FROM jurisdictions
    WHERE (id = ANY(${ids}::uuid[]) OR upper(code) = ANY(${codes}::text[]))
      AND (created_by IS NULL OR created_by = ${userId}::uuid)`) as JurisdictionRef[];

  const foundIds = new Set(rows.map((j) => j.id));
  const foundCodes = new Set(rows.map((j) => j.code.toUpperCase()));
  const missing = [
    ...ids.filter((id) => !foundIds.has(id)),
    ...codes.filter((c) => !foundCodes.has(c)),
  ];
  if (missing.length > 0) {
    throw new ValidationError(`The following jurisdictions were not found: ${missing.join(', ')}`);
  }
  return [...new Map(rows.map((j) => [j.id, j])).values()];
}
