import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('jurisdiction.service');

const JURISDICTION_TREE_CACHE_KEY = 'jurisdictions:tree';
const JURISDICTION_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

export interface JurisdictionNode {
  id: string;
  name: string;
  code: string;
  level: string;
  parentId: string | null;
  legalSystem: string;
  geoCode: string | null;
  population: number | null;
  createdAt: Date;
  children: JurisdictionNode[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEVEL_ORDER: Record<string, number> = {
  federal: 0,
  provincial: 1,
  territorial: 2,
  municipal: 3,
};

export class JurisdictionService {
  /**
   * Returns the full jurisdiction hierarchy as a tree structure.
   * Federal -> Provincial -> Municipal
   * Results are cached in Redis for 24 hours.
   */
  async getJurisdictionTree(): Promise<JurisdictionNode[]> {
    // Try cache first
    try {
      const cached = await redis.get(JURISDICTION_TREE_CACHE_KEY);
      if (cached) {
        logger.debug({ message: 'Jurisdiction tree served from cache' });
        return JSON.parse(cached) as JurisdictionNode[];
      }
    } catch (err) {
      logger.warn({
        message: 'Failed to read jurisdiction tree from cache',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Fetch all jurisdictions from DB
    // Order siblings by hierarchy level (federal, provincial, territorial, municipal), then name.
    // (Ordering by the level string in SQL would put "municipal" before "provincial".)
    const jurisdictions = (await prisma.jurisdiction.findMany({ orderBy: { name: 'asc' } })).sort(
      (a, b) => (LEVEL_ORDER[a.level] ?? 99) - (LEVEL_ORDER[b.level] ?? 99),
    );

    // Build tree structure
    const nodeMap = new Map<string, JurisdictionNode>();
    const roots: JurisdictionNode[] = [];

    // First pass: create all nodes
    for (const j of jurisdictions) {
      nodeMap.set(j.id, {
        id: j.id,
        name: j.name,
        code: j.code,
        level: j.level,
        parentId: j.parentId,
        legalSystem: j.legalSystem,
        geoCode: j.geoCode,
        population: j.population,
        createdAt: j.createdAt,
        children: [],
      });
    }

    // Second pass: wire up parent-child relationships
    for (const j of jurisdictions) {
      const node = nodeMap.get(j.id)!;
      if (j.parentId) {
        const parent = nodeMap.get(j.parentId);
        if (parent) {
          parent.children.push(node);
        } else {
          // Parent not found, treat as root
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    // Cache the tree
    try {
      await redis.set(
        JURISDICTION_TREE_CACHE_KEY,
        JSON.stringify(roots),
        'EX',
        JURISDICTION_CACHE_TTL,
      );
      logger.debug({ message: 'Jurisdiction tree cached' });
    } catch (err) {
      logger.warn({
        message: 'Failed to cache jurisdiction tree',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return roots;
  }

  /**
   * Returns a single jurisdiction by its ID.
   */
  async getJurisdictionById(id: string): Promise<{
    id: string;
    name: string;
    code: string;
    level: string;
    parentId: string | null;
    legalSystem: string;
    geoCode: string | null;
    population: number | null;
    parent: { id: string; name: string; code: string } | null;
    children: { id: string; name: string; code: string; level: string }[];
  }> {
    const jurisdiction = await prisma.jurisdiction.findUnique({
      where: { id },
      include: {
        parent: {
          select: { id: true, name: true, code: true },
        },
        children: {
          select: { id: true, name: true, code: true, level: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!jurisdiction) {
      throw new NotFoundError(`Jurisdiction with ID "${id}" not found`);
    }

    return jurisdiction;
  }

  /**
   * Returns provinces/territories with their municipalities, in the shape of the shared
   * `ProvinceData` type (used by the web map / upload picker).
   */
  async getProvinces(): Promise<
    {
      id: string;
      name: string;
      code: string;
      level: string;
      legalSystem: string;
      municipalities: { id: string; name: string; code: string }[];
    }[]
  > {
    const tree = await this.getJurisdictionTree();
    const result: Awaited<ReturnType<JurisdictionService['getProvinces']>> = [];
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
    visit(tree);
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Returns the given jurisdiction ID plus the IDs of all of its descendants
   * (e.g. a province and all of its municipalities).
   */
  async getSelfAndDescendantIds(id: string): Promise<string[]> {
    const all = await prisma.jurisdiction.findMany({ select: { id: true, parentId: true } });
    const childrenByParent = new Map<string, string[]>();
    for (const j of all) {
      if (!j.parentId) continue;
      const list = childrenByParent.get(j.parentId) ?? [];
      list.push(j.id);
      childrenByParent.set(j.parentId, list);
    }
    const result: string[] = [];
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      result.push(current);
      stack.push(...(childrenByParent.get(current) ?? []));
    }
    return result;
  }

  /**
   * Resolves jurisdiction references (UUIDs or codes such as "BC" / "BC-VANCOUVER") to
   * jurisdiction records. Throws a ValidationError listing any that do not exist.
   */
  async resolveJurisdictionRefs(
    refs: string[],
  ): Promise<{ id: string; name: string; code: string; level: string }[]> {
    const uniqueRefs = [...new Set(refs)];
    const ids = uniqueRefs.filter((r) => UUID_RE.test(r)).map((r) => r.toLowerCase());
    const codes = uniqueRefs.filter((r) => !UUID_RE.test(r)).map((r) => r.toUpperCase());

    const jurisdictions = await prisma.jurisdiction.findMany({
      where: { OR: [{ id: { in: ids } }, { code: { in: codes } }] },
      select: { id: true, name: true, code: true, level: true },
    });

    const foundIds = new Set(jurisdictions.map((j) => j.id));
    const foundCodes = new Set(jurisdictions.map((j) => j.code.toUpperCase()));
    const missing = [
      ...ids.filter((id) => !foundIds.has(id)),
      ...codes.filter((c) => !foundCodes.has(c)),
    ];
    if (missing.length > 0) {
      throw new ValidationError(
        `The following jurisdictions were not found: ${missing.join(', ')}`,
      );
    }

    // De-duplicate in case the same jurisdiction was referenced by both ID and code
    return [...new Map(jurisdictions.map((j) => [j.id, j])).values()];
  }

  /**
   * Batch lookup: validates that all provided IDs exist and returns the jurisdictions.
   * Throws a ValidationError if any IDs are not found.
   */
  async getJurisdictionsByIds(
    ids: string[],
  ): Promise<{ id: string; name: string; code: string; level: string }[]> {
    if (ids.length === 0) {
      return [];
    }

    const uniqueIds = [...new Set(ids)];

    const jurisdictions = await prisma.jurisdiction.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, name: true, code: true, level: true },
    });

    if (jurisdictions.length !== uniqueIds.length) {
      const foundIds = new Set(jurisdictions.map((j) => j.id));
      const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        `The following jurisdiction IDs were not found: ${missingIds.join(', ')}`,
      );
    }

    return jurisdictions;
  }
}

export const jurisdictionService = new JurisdictionService();
