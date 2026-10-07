import type { JurisdictionSearchResult, LibraryDocument } from '@lexterrae/shared';
import { NotFoundError } from '../lib/errors.js';
import type { Deps } from '../types.js';
import { audit } from './audit.service.js';
import * as files from './file.service.js';
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

/** Downloads a document from the library (any signed-in user). */
export async function downloadLibraryDocument(deps: Deps, viewerId: string, documentId: string) {
  const [doc] = (await deps.sql`
    SELECT file_key AS "fileKey", original_filename AS "originalFilename" FROM documents
    WHERE id = ${documentId} AND deleted_at IS NULL`) as {
    fileKey: string;
    originalFilename: string;
  }[];
  if (!doc) throw new NotFoundError('Document not found');
  const file = await files.getFile(deps, doc.fileKey);
  audit(deps, {
    actorUserId: viewerId,
    action: 'document.download',
    resourceType: 'document',
    resourceId: documentId,
    changes: { via: 'library' },
    outcome: 'success',
  });
  return { ...file, filename: doc.originalFilename };
}
