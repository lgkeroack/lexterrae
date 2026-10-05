import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { Deps } from '../types.js';

export interface JurisdictionNode {
  id: string;
  name: string;
  code: string;
  level: string;
  parentId: string | null;
  legalSystem: string;
  geoCode: string | null;
  population: number | null;
  createdAt: string;
  children: JurisdictionNode[];
}

export interface JurisdictionRef {
  id: string;
  name: string;
  code: string;
  level: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEVEL_ORDER: Record<string, number> = {
  federal: 0,
  provincial: 1,
  territorial: 2,
  municipal: 3,
};

const JURISDICTION_COLUMNS = `id, name, code, level, parent_id AS "parentId", legal_system AS "legalSystem",
  geo_code AS "geoCode", population, created_at AS "createdAt"`;

/**
 * Jurisdictions are reference data that only change when the seed is re-run, so the flat list
 * is cached in the isolate for a few minutes (no shared cache needed).
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; rows: Omit<JurisdictionNode, 'children'>[] } | undefined;

async function allJurisdictions(deps: Deps): Promise<Omit<JurisdictionNode, 'children'>[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const rows = (await deps.sql.query(
    `SELECT ${JURISDICTION_COLUMNS} FROM jurisdictions ORDER BY name`,
  )) as Omit<JurisdictionNode, 'children'>[];
  cache = { at: Date.now(), rows };
  return rows;
}

/** Full hierarchy: federal → provincial/territorial → municipal, siblings ordered by level then name. */
export async function getJurisdictionTree(deps: Deps): Promise<JurisdictionNode[]> {
  const rows = [...(await allJurisdictions(deps))].sort(
    (a, b) => (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99),
  );
  const nodes = new Map<string, JurisdictionNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: JurisdictionNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getJurisdictionById(deps: Deps, id: string) {
  const rows = await deps.sql.query(
    `SELECT ${JURISDICTION_COLUMNS},
       (SELECT json_build_object('id', p.id, 'name', p.name, 'code', p.code)
          FROM jurisdictions p WHERE p.id = j.parent_id) AS parent,
       COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'code', c.code,
                                                   'level', c.level) ORDER BY c.name)
          FROM jurisdictions c WHERE c.parent_id = j.id), '[]'::json) AS children
     FROM jurisdictions j WHERE j.id = $1`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError(`Jurisdiction with ID "${id}" not found`);
  return rows[0];
}

/** Provinces/territories with their municipalities (the shared `ProvinceData` shape). */
export async function getProvinces(deps: Deps) {
  const result: {
    id: string;
    name: string;
    code: string;
    level: string;
    legalSystem: string;
    municipalities: { id: string; name: string; code: string }[];
  }[] = [];
  const visit = (nodes: JurisdictionNode[]) => {
    for (const n of nodes) {
      if (n.level === 'provincial' || n.level === 'territorial') {
        result.push({
          id: n.id,
          name: n.name,
          code: n.code,
          level: n.level,
          legalSystem: n.legalSystem,
          municipalities: n.children
            .filter((c) => c.level === 'municipal')
            .map((c) => ({ id: c.id, name: c.name, code: c.code })),
        });
      } else {
        visit(n.children);
      }
    }
  };
  visit(await getJurisdictionTree(deps));
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** The jurisdiction plus all descendants (e.g. a province and its municipalities). */
export async function getSelfAndDescendantIds(deps: Deps, id: string): Promise<string[]> {
  const rows = await allJurisdictions(deps);
  const childrenByParent = new Map<string, string[]>();
  for (const j of rows) {
    if (!j.parentId) continue;
    childrenByParent.set(j.parentId, [...(childrenByParent.get(j.parentId) ?? []), j.id]);
  }
  const result: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.includes(current)) continue;
    result.push(current);
    stack.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}

/**
 * Resolves references (UUIDs or codes such as "BC" / "BC-VANCOUVER") to jurisdictions.
 * Throws a ValidationError listing any that do not exist.
 */
export async function resolveJurisdictionRefs(
  deps: Deps,
  refs: string[],
): Promise<JurisdictionRef[]> {
  const unique = [...new Set(refs)];
  const ids = unique.filter((r) => UUID_RE.test(r)).map((r) => r.toLowerCase());
  const codes = unique.filter((r) => !UUID_RE.test(r)).map((r) => r.toUpperCase());

  const rows = (await deps.sql`
    SELECT id, name, code, level FROM jurisdictions
    WHERE id = ANY(${ids}::uuid[]) OR upper(code) = ANY(${codes}::text[])`) as JurisdictionRef[];

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
