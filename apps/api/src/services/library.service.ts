import type {
  JurisdictionLevel,
  JurisdictionSearchResult,
  LibraryDocument,
  PackageContentsDocument,
  PackageContentsResponse,
  PackagePlanResponse,
} from '@lexterrae/shared';
import {
  buildPackage,
  describeSlice,
  packageFilename,
  planParts,
  type PackageDocument,
} from '../lib/llm-package.js';
import { strToU8, zipSync } from 'fflate';
import { ValidationError } from '../lib/errors.js';
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

type JurisdictionRef = { id: string; name: string; level: JurisdictionLevel };

/** The place and every jurisdiction containing it, most local first, Canada last. */
async function applicability(deps: Deps, jurisdictionId: string) {
  const ids = await jurisdictions.getSelfAndAncestorIds(deps, jurisdictionId);
  const [place] = await jurisdictions.findByIds(deps, [jurisdictionId]);
  const chain = [jurisdictionId, ...[...place!.path].reverse().map((p) => p.id)];
  const federal = ids.filter((id) => !chain.includes(id));
  const order = [...chain, ...federal];
  const sources = (await jurisdictions.findByIds(deps, order)).map((j) => ({
    id: j.id,
    name: j.name,
    level: j.level,
  }));
  return { ids, place: place!, order, sources };
}

/** Index in `order` of the most local jurisdiction a document applies through. */
function sourceRank(order: string[], tagged: { id: string }[]): number {
  const found = order.findIndex((id) => tagged.some((j) => j.id === id));
  return found === -1 ? order.length : found;
}

/**
 * What an AI package for the place can hold: every applying document with its size, so the
 * page can estimate the package and let the person choose which documents to include.
 */
export async function getPackageContents(
  deps: Deps,
  jurisdictionId: string,
): Promise<PackageContentsResponse> {
  const { ids, place, order, sources } = await applicability(deps, jurisdictionId);
  const params: unknown[] = [ids];
  const applies = `d.deleted_at IS NULL AND EXISTS (SELECT 1 FROM document_jurisdictions dj
    WHERE dj.document_id = d.id AND dj.jurisdiction_id = ANY($1::uuid[]))`;
  const rows = (await deps.sql.query(
    `SELECT d.id, d.title, d.file_type AS "fileType",
         COALESCE(length(d.content_text), 0)::int AS "textChars",
         CASE WHEN d.content_text IS NOT NULL THEN 'ready'
              WHEN d.text_checked_at IS NULL THEN 'pending' ELSE 'none' END AS "textStatus",
         ARRAY(SELECT dj.jurisdiction_id FROM document_jurisdictions dj
               WHERE dj.document_id = d.id) AS "tagged"
       FROM documents d WHERE ${applies}
       ORDER BY d.title, d.id LIMIT ${PACKAGE_MAX_DOCUMENTS}`,
    params,
  )) as unknown as (Omit<PackageContentsDocument, 'sourceId'> & { tagged: string[] })[];
  const documents = rows
    .map(({ tagged, ...doc }) => {
      const rank = sourceRank(
        order,
        tagged.map((id) => ({ id })),
      );
      return { ...doc, sourceId: order[rank] ?? order[order.length - 1]!, rank };
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _rank, ...doc }) => doc);
  return {
    place,
    sources,
    documents,
  };
}

/**
 * The reference package for AI assistants (see lib/llm-package.ts), built on request from what
 * is in the backend now: every document that applies in the place, or the selection the person
 * narrowed it to, with full text.
 */
export interface LibraryPackageRequest {
  jurisdictionId: string;
  documentIds?: string[];
  /** Split into parts of at most about this many tokens: one part, or all of them as a zip. */
  split?: { maxTokens: number; part?: number };
}

/** Loads what a package for the place (or the chosen documents) holds, ready to build. */
async function loadPackage(deps: Deps, request: Omit<LibraryPackageRequest, 'split'>) {
  const { ids, place, order } = await applicability(deps, request.jurisdictionId);
  const params: unknown[] = [ids];
  let selected = '';
  if (request.documentIds) {
    params.push(request.documentIds);
    selected = 'AND d.id = ANY($2::uuid[])';
  }
  const applies = `d.deleted_at IS NULL AND EXISTS (SELECT 1 FROM document_jurisdictions dj
    WHERE dj.document_id = d.id AND dj.jurisdiction_id = ANY($1::uuid[]))`;
  const [rowsResult, count] = await Promise.all([
    deps.sql.query(
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
       WHERE ${applies} ${selected}
       ORDER BY d.title, d.id
       LIMIT ${PACKAGE_MAX_DOCUMENTS}`,
      params,
    ),
    deps.sql.query(`SELECT count(*)::int AS n FROM documents d WHERE ${applies}`, [ids]),
  ]);
  const rows = rowsResult as unknown as (Omit<PackageDocument, 'jurisdictions'> & {
    jurisdictions: JurisdictionRef[];
  })[];

  const paths = await jurisdictions.getPaths(
    deps,
    rows.flatMap((d) => d.jurisdictions.map((j) => j.id)),
  );
  // Most local first, matching the user-facing page: the place, its ancestors, then Canada
  rows.sort((a, b) => sourceRank(order, a.jurisdictions) - sourceRank(order, b.jurisdictions));

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

  return { place, docs, totalApplying: (count[0] as { n: number }).n };
}

const MARKDOWN = 'text/markdown; charset=utf-8';

/** The whole package; or, when `split` is given, one part of it or every part as a zip. */
export async function buildLibraryPackage(
  deps: Deps,
  request: LibraryPackageRequest,
  now = new Date(),
) {
  const { place, docs, totalApplying } = await loadPackage(deps, request);
  if (!request.split) {
    return {
      filename: packageFilename(place.name, now),
      body: buildPackage(place, docs, now, { totalApplying }) as string | Uint8Array,
      contentType: MARKDOWN,
    };
  }
  const parts = planParts(docs, request.split.maxTokens);
  const index = request.split.part;
  if (index === undefined) {
    // Every part, in one zip download
    const files = Object.fromEntries(
      parts.map((_, i) => [
        packageFilename(place.name, now, { index: i, count: parts.length }),
        strToU8(buildPackage(place, docs, now, { totalApplying }, { index: i, parts })),
      ]),
    );
    return {
      filename: packageFilename(place.name, now).replace(/\.md$/, `-${parts.length}-parts.zip`),
      body: zipSync(files, { level: 6 }),
      contentType: 'application/zip',
    };
  }
  if (index >= parts.length) {
    throw new ValidationError(
      `The package has ${parts.length} parts; part ${index + 1} doesn't exist.`,
    );
  }
  return {
    filename: packageFilename(place.name, now, { index, count: parts.length }),
    body: buildPackage(place, docs, now, { totalApplying }, { index, parts }),
    contentType: MARKDOWN,
  };
}

/** How the package would be split into parts of at most about `maxTokens` each. */
export async function planLibraryPackage(
  deps: Deps,
  request: Omit<LibraryPackageRequest, 'split'> & { maxTokens: number },
): Promise<PackagePlanResponse> {
  const { docs } = await loadPackage(deps, request);
  return {
    parts: planParts(docs, request.maxTokens).map((part) => ({
      tokens: part.tokens,
      holds: part.slices.map((slice) => ({
        label: describeSlice(slice),
        title: docs[slice.doc]!.title,
      })),
    })),
  };
}
