import type { Document } from '@lexterrae/shared';
import { FileSizeError, NotFoundError } from '../lib/errors.js';
import type { Deps } from '../types.js';
import type { DocumentQueryInput } from '../validators/document.validator.js';
import { audit } from './audit.service.js';
import * as files from './file.service.js';
import * as jurisdictions from './jurisdiction.service.js';

export interface UploadDocumentParams {
  userId: string;
  title: string;
  description: string;
  tags: string[];
  jurisdictionIds: string[];
  file: File;
}

export interface UpdateDocumentParams {
  userId: string;
  documentId: string;
  title?: string;
  description?: string;
  tags?: string[];
}

/** Columns returned for a document, with its jurisdictions embedded as JSON. */
function documentColumns(options: { includeContent?: boolean } = {}): string {
  return `d.id, d.user_id AS "userId", d.title, d.description, d.file_type AS "fileType",
    d.file_size_bytes AS "fileSizeBytes", d.original_filename AS "originalFilename", d.tags,
    ${options.includeContent ? 'd.content_text AS "contentText",' : ''}
    COALESCE((
      SELECT json_agg(json_build_object('id', j.id, 'name', j.name, 'code', j.code,
                                        'level', j.level, 'parentId', j.parent_id) ORDER BY j.name)
      FROM document_jurisdictions dj JOIN jurisdictions j ON j.id = dj.jurisdiction_id
      WHERE dj.document_id = d.id
    ), '[]'::json) AS jurisdictions,
    d.uploaded_at AS "uploadedAt", d.updated_at AS "updatedAt"`;
}

/** Whitelisted sort columns (values come from the validator's enum). */
const SORT_COLUMNS: Record<DocumentQueryInput['sortBy'], string> = {
  uploadedAt: 'd.uploaded_at',
  updatedAt: 'd.updated_at',
  title: 'd.title',
  fileSizeBytes: 'd.file_size_bytes',
};

/**
 * Validates the file, stores it in R2 and creates the document with its jurisdictions in a
 * single statement. If the database insert fails, the stored file is removed again.
 */
export async function uploadDocument(deps: Deps, params: UploadDocumentParams): Promise<Document> {
  const { userId, title, description, tags, file } = params;

  const maxBytes = deps.config.MAX_FILE_SIZE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new FileSizeError(
      `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the ${deps.config.MAX_FILE_SIZE_MB} MB limit`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = files.sanitizeFilename(file.name);
  const { mimeType, extension } = await files.validateFileType(bytes, filename);

  // Accepts UUIDs or jurisdiction codes such as "BC"
  const resolved = await jurisdictions.resolveJurisdictionRefs(deps, params.jurisdictionIds);
  const jurisdictionIds = resolved.map((j) => j.id);

  const contentText = await files.extractText(deps, bytes, extension);

  const fileKey = files.generateFileKey(userId, extension);
  await files.putFile(deps, fileKey, bytes, mimeType, filename);

  let documentId: string;
  try {
    const [row] = await deps.sql`
      WITH doc AS (
        INSERT INTO documents (user_id, title, description, file_key, file_type, file_size_bytes,
                               original_filename, content_text, tags)
        VALUES (${userId}, ${title}, ${description}, ${fileKey}, ${extension}, ${bytes.length},
                ${filename}, ${contentText}, ${tags})
        RETURNING id
      ), links AS (
        INSERT INTO document_jurisdictions (document_id, jurisdiction_id)
        SELECT doc.id, unnest(${jurisdictionIds}::uuid[]) FROM doc
      )
      SELECT id FROM doc`;
    documentId = (row as { id: string }).id;
  } catch (err) {
    deps.log.error({
      module: 'documents',
      message: 'Failed to create document; removing stored file',
      fileKey,
      error: err,
    });
    await files.deleteFile(deps, fileKey).catch(() => undefined);
    throw err;
  }

  audit(deps, {
    actorUserId: userId,
    action: 'document.upload',
    resourceType: 'document',
    resourceId: documentId,
    changes: { title, fileType: extension, fileSizeBytes: bytes.length, jurisdictionIds },
    outcome: 'success',
  });
  deps.log.info({ module: 'documents', message: 'Document uploaded', userId, documentId });

  return getDocument(deps, documentId, userId, { includeContent: false });
}

/** A single document owned by the user (404 for missing, deleted or other users' documents). */
export async function getDocument(
  deps: Deps,
  documentId: string,
  userId: string,
  options: { includeContent?: boolean } = { includeContent: true },
): Promise<Document> {
  const rows = await deps.sql.query(
    `SELECT ${documentColumns(options)} FROM documents d
     WHERE d.id = $1 AND d.user_id = $2 AND d.deleted_at IS NULL`,
    [documentId, userId],
  );
  // SECURITY: 404 rather than 403 so other users' document IDs are not revealed (07-SECURITY.md §1.4)
  if (!rows[0]) throw new NotFoundError('Document not found');
  return rows[0] as unknown as Document;
}

/** Paginated list with search, jurisdiction, file type and date filters. */
export async function listDocuments(deps: Deps, userId: string, query: DocumentQueryInput) {
  const params: unknown[] = [userId];
  const where = ['d.user_id = $1', 'd.deleted_at IS NULL'];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.search) {
    const pattern = param(`%${query.search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    where.push(`(d.title ILIKE ${pattern} OR d.description ILIKE ${pattern}
      OR d.original_filename ILIKE ${pattern} OR d.content_text ILIKE ${pattern}
      OR EXISTS (SELECT 1 FROM unnest(d.tags) AS t WHERE t ILIKE ${pattern}))`);
  }
  if (query.fileType) where.push(`d.file_type = ${param(query.fileType)}`);
  if (query.dateFrom) where.push(`d.uploaded_at >= ${param(query.dateFrom)}`);
  if (query.dateTo) where.push(`d.uploaded_at <= ${param(query.dateTo)}`);

  if (query.jurisdictionId || query.jurisdictionLevel) {
    const conditions: string[] = [];
    if (query.jurisdictionId) {
      // Include sub-jurisdictions: "BC" also matches documents tagged with BC municipalities
      const ids = await jurisdictions.getSelfAndDescendantIds(deps, query.jurisdictionId);
      conditions.push(`dj.jurisdiction_id = ANY(${param(ids)}::uuid[])`);
    }
    if (query.jurisdictionLevel) conditions.push(`j.level = ${param(query.jurisdictionLevel)}`);
    where.push(`EXISTS (SELECT 1 FROM document_jurisdictions dj
      JOIN jurisdictions j ON j.id = dj.jurisdiction_id
      WHERE dj.document_id = d.id AND ${conditions.join(' AND ')})`);
  }

  const whereSql = where.join(' AND ');
  const direction = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const offset = (query.page - 1) * query.pageSize;

  const [rows, countRows] = await Promise.all([
    deps.sql.query(
      // id as a tie-breaker keeps pagination stable when sort values collide
      `SELECT ${documentColumns()} FROM documents d WHERE ${whereSql}
       ORDER BY ${SORT_COLUMNS[query.sortBy]} ${direction}, d.id ${direction}
       LIMIT ${query.pageSize} OFFSET ${offset}`,
      params,
    ),
    deps.sql.query(`SELECT count(*)::int AS total FROM documents d WHERE ${whereSql}`, params),
  ]);
  const total = (countRows[0] as { total: number }).total;

  return {
    data: rows as unknown as Document[],
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: total,
      /** @deprecated alias of totalItems */
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/** Updates title, description and/or tags; audits only fields that actually changed. */
export async function updateDocument(deps: Deps, params: UpdateDocumentParams): Promise<Document> {
  const { userId, documentId } = params;
  const [existing] = (await deps.sql`
    SELECT title, description, tags FROM documents
    WHERE id = ${documentId} AND user_id = ${userId} AND deleted_at IS NULL`) as {
    title: string;
    description: string | null;
    tags: string[];
  }[];
  if (!existing) throw new NotFoundError('Document not found');

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (params.title !== undefined && params.title !== existing.title) {
    changes['title'] = { from: existing.title, to: params.title };
  }
  if (params.description !== undefined && params.description !== existing.description) {
    changes['description'] = { from: existing.description, to: params.description };
  }
  if (params.tags !== undefined && JSON.stringify(params.tags) !== JSON.stringify(existing.tags)) {
    changes['tags'] = { from: existing.tags, to: params.tags };
  }

  if (Object.keys(changes).length > 0) {
    await deps.sql`
      UPDATE documents SET
        title = ${params.title ?? existing.title},
        description = ${params.description ?? existing.description},
        tags = ${params.tags ?? existing.tags}
      WHERE id = ${documentId} AND user_id = ${userId}`;
    audit(deps, {
      actorUserId: userId,
      action: 'document.update',
      resourceType: 'document',
      resourceId: documentId,
      changes,
      outcome: 'success',
    });
  }

  return getDocument(deps, documentId, userId);
}

/** Soft delete: the document disappears immediately and is purged after the retention period. */
export async function deleteDocument(
  deps: Deps,
  documentId: string,
  userId: string,
): Promise<void> {
  const rows = await deps.sql`
    UPDATE documents SET deleted_at = now()
    WHERE id = ${documentId} AND user_id = ${userId} AND deleted_at IS NULL
    RETURNING id`;
  if (rows.length === 0) throw new NotFoundError('Document not found');

  audit(deps, {
    actorUserId: userId,
    action: 'document.delete',
    resourceType: 'document',
    resourceId: documentId,
    outcome: 'success',
  });
}

export async function downloadDocument(deps: Deps, documentId: string, userId: string) {
  const [doc] = (await deps.sql`
    SELECT file_key AS "fileKey", original_filename AS "originalFilename" FROM documents
    WHERE id = ${documentId} AND user_id = ${userId} AND deleted_at IS NULL`) as {
    fileKey: string;
    originalFilename: string;
  }[];
  if (!doc) throw new NotFoundError('Document not found');

  const file = await files.getFile(deps, doc.fileKey);
  audit(deps, {
    actorUserId: userId,
    action: 'document.download',
    resourceType: 'document',
    resourceId: documentId,
    outcome: 'success',
  });
  return { ...file, filename: doc.originalFilename };
}
