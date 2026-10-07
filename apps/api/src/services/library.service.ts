import type {
  JurisdictionLevel,
  JurisdictionSearchResult,
  LibraryDocument,
} from '@lexterrae/shared';
import { buildPackage, packageFilename, type PackageDocument } from '../lib/llm-package.js';
import type { Deps } from '../types.js';
import * as jurisdictions from './jurisdiction.service.js';

export interface LibraryQuery {
  jurisdictionId: string;
  search?: string;
  page: number;
  pageSize: number;
}

/**
 * The user-facing library: every document in the backend that applies in a place, that is,
 * documents for the place itself and for every jurisdiction containing it (its region, province
 * or territory, and Canada). Only official jurisdictions are used and shown, never the private
 * ones a backend user added.
 */
export async function listLibrary(deps: Deps, query: LibraryQuery) {
  const ids = await jurisdictions.getSelfAndAncestorIds(deps, query.jurisdictionId);
  const params: unknown[] = [ids];
  const where = [
    'd.deleted_at IS NULL',
    `EXISTS (SELECT 1 FROM document_jurisdictions dj
       WHERE dj.document_id = d.id AND dj.jurisdiction_id = ANY($1::uuid[]))`,
  ];
  if (query.search) {
    params.push(`%${query.search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    const p = `$${params.length}`;
    where.push(`(d.title ILIKE ${p} OR d.description ILIKE ${p} OR d.content_text ILIKE ${p}
      OR EXISTS (SELECT 1 FROM unnest(d.tags) AS t WHERE t ILIKE ${p}))`);
  }
  const whereSql = where.join(' AND ');
  const offset = (query.page - 1) * query.pageSize;

  const [rows, countRows, place] = await Promise.all([
    deps.sql.query(
      `SELECT d.id, d.title, d.description, d.file_type AS "fileType",
         d.file_size_bytes AS "fileSizeBytes", d.original_filename AS "originalFilename", d.tags,
         COALESCE((
           SELECT json_agg(json_build_object('id', j.id, 'name', j.name, 'code', j.code,
                                             'level', j.level, 'parentId', j.parent_id)
                           ORDER BY j.name)
           FROM document_jurisdictions dj JOIN jurisdictions j ON j.id = dj.jurisdiction_id
           WHERE dj.document_id = d.id AND j.created_by IS NULL
         ), '[]'::json) AS jurisdictions,
         d.uploaded_at AS "uploadedAt", d.updated_at AS "updatedAt"
       FROM documents d WHERE ${whereSql}
       ORDER BY d.title ASC, d.id ASC
       LIMIT ${query.pageSize} OFFSET ${offset}`,
      params,
    ),
    deps.sql.query(`SELECT count(*)::int AS total FROM documents d WHERE ${whereSql}`, params),
    jurisdictions.findByIds(deps, [query.jurisdictionId]),
  ]);

  const docs = rows as unknown as LibraryDocument[];
  const paths = await jurisdictions.getPaths(
    deps,
    docs.flatMap((d) => d.jurisdictions.map((j) => j.id)),
  );
  const applying = new Set(ids);
  for (const doc of docs) {
    for (const j of doc.jurisdictions) {
      j.path = paths.get(j.id) ?? [];
      j.applies = applying.has(j.id);
    }
  }
  const total = (countRows[0] as { total: number }).total;
  return {
    place: place[0] as JurisdictionSearchResult,
    data: docs,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/** Most documents and text one package may hold, to stay within Worker memory and LLM limits. */
const PACKAGE_MAX_DOCUMENTS = 500;
const PACKAGE_MAX_TEXT_CHARS = 20_000_000;

/**
 * The reference package for AI assistants (see lib/llm-package.ts), built on request from what
 * is in the backend now: every document that applies in the place, with its full text.
 */
export async function buildLibraryPackage(deps: Deps, jurisdictionId: string, now = new Date()) {
  const ids = await jurisdictions.getSelfAndAncestorIds(deps, jurisdictionId);
  const [place] = await jurisdictions.findByIds(deps, [jurisdictionId]);
  const rows = (await deps.sql.query(
    `SELECT d.id, d.title, d.description, d.tags, d.file_type AS "fileType",
       d.original_filename AS "originalFilename", d.content_text AS "contentText",
       (d.content_text IS NULL AND d.text_checked_at IS NULL) AS "textPending",
       d.uploaded_at AS "uploadedAt", d.updated_at AS "updatedAt",
       COALESCE((
         SELECT json_agg(json_build_object('id', j.id, 'name', j.name, 'level', j.level)
                         ORDER BY j.name)
         FROM document_jurisdictions dj JOIN jurisdictions j ON j.id = dj.jurisdiction_id
         WHERE dj.document_id = d.id AND j.created_by IS NULL
       ), '[]'::json) AS jurisdictions
     FROM documents d
     WHERE d.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM document_jurisdictions dj
                   WHERE dj.document_id = d.id AND dj.jurisdiction_id = ANY($1::uuid[]))
     ORDER BY d.title, d.id
     LIMIT ${PACKAGE_MAX_DOCUMENTS}`,
    [ids],
  )) as unknown as (Omit<PackageDocument, 'jurisdictions'> & {
    jurisdictions: { id: string; name: string; level: JurisdictionLevel }[];
  })[];

  const paths = await jurisdictions.getPaths(
    deps,
    rows.flatMap((d) => d.jurisdictions.map((j) => j.id)),
  );
  // Most local first, matching the user-facing page: the place, its ancestors, then Canada
  const order = [jurisdictionId, ...[...place!.path].reverse().map((p) => p.id)];
  const rank = (doc: (typeof rows)[number]) => {
    const found = order.findIndex((id) => doc.jurisdictions.some((j) => j.id === id));
    return found === -1 ? order.length : found;
  };
  rows.sort((a, b) => rank(a) - rank(b));

  let budget = PACKAGE_MAX_TEXT_CHARS;
  const docs: PackageDocument[] = rows.map((doc) => {
    const text = doc.contentText && doc.contentText.length <= budget ? doc.contentText : null;
    if (text) budget -= text.length;
    return {
      ...doc,
      contentText: text,
      jurisdictions: doc.jurisdictions.map((j) => ({
        name: j.name,
        level: j.level,
        path: paths.get(j.id) ?? [],
        applies: ids.includes(j.id),
      })),
    };
  });

  return {
    filename: packageFilename(place!.name, now),
    body: buildPackage(place!, docs, now),
  };
}
