import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { NotFoundError, FileSizeError } from '../lib/errors.js';
import { createModuleLogger } from '../lib/logger.js';
import { fileService } from './file.service.js';
import { jurisdictionService } from './jurisdiction.service.js';
import { auditService } from './audit.service.js';

const logger = createModuleLogger('document.service');

export interface UploadDocumentParams {
  userId: string;
  title: string;
  description?: string;
  tags?: string[];
  jurisdictionIds: string[];
  file: {
    buffer: Buffer;
    originalname: string;
    size: number;
  };
  requestId: string;
  actorIp: string;
}

export interface GetDocumentsParams {
  userId: string;
  page: number;
  pageSize: number;
  search?: string;
  jurisdictionLevel?: string;
  jurisdictionId?: string;
  fileType?: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  dateFrom?: Date;
  dateTo?: Date;
}

export interface UpdateDocumentParams {
  userId: string;
  documentId: string;
  title?: string;
  description?: string;
  tags?: string[];
  requestId: string;
  actorIp: string;
}

export class DocumentService {
  /**
   * Uploads a document: validates the file, streams to S3, creates a DB record
   * with jurisdiction associations, and creates an audit log entry.
   */
  async uploadDocument(params: UploadDocumentParams) {
    const { userId, title, description, tags, jurisdictionIds, file, requestId, actorIp } = params;

    // Check file size
    const maxBytes = env.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new FileSizeError(
        `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the ${env.MAX_FILE_SIZE_MB} MB limit`,
      );
    }

    // Validate file type via magic bytes
    const sanitizedFilename = fileService.sanitizeFilename(file.originalname);
    const { mimeType, extension } = await fileService.validateFileType(file.buffer, sanitizedFilename);

    // Validate jurisdictions exist (accepts UUIDs or jurisdiction codes such as "BC")
    const jurisdictions = await jurisdictionService.resolveJurisdictionRefs(jurisdictionIds);
    const resolvedJurisdictionIds = jurisdictions.map((j) => j.id);

    // Extract searchable text (never throws)
    const contentText = await fileService.extractText(file.buffer, extension);

    // Generate S3 key and upload
    const fileKey = fileService.generateFileKey(userId, extension);
    await fileService.streamToS3(fileKey, file.buffer, mimeType, sanitizedFilename);

    // Create DB record with jurisdictions; if it fails, remove the stored object so it is not orphaned
    let document;
    try {
      document = await prisma.document.create({
        data: {
          userId,
          title,
          description: description || '',
          fileKey,
          fileType: extension,
          fileSizeBytes: file.size,
          originalFilename: sanitizedFilename,
          contentText,
          tags: tags || [],
          jurisdictions: {
            create: resolvedJurisdictionIds.map((jId) => ({
              jurisdictionId: jId,
            })),
          },
        },
        include: {
          jurisdictions: {
            include: {
              jurisdiction: {
                select: { id: true, name: true, code: true, level: true, parentId: true },
              },
            },
          },
        },
      });
    } catch (err) {
      logger.error({
        userId,
        fileKey,
        message: 'Failed to create document record; removing stored file',
        error: err instanceof Error ? err.message : String(err),
      });
      await fileService.deleteFromS3(fileKey).catch(() => undefined);
      throw err;
    }

    // Audit log (fire-and-forget)
    auditService.logAction({
      actorUserId: userId,
      actorIp,
      action: 'document.upload',
      resourceType: 'document',
      resourceId: document.id,
      changes: {
        title,
        fileType: extension,
        fileSizeBytes: file.size,
        jurisdictionIds: resolvedJurisdictionIds,
      },
      requestId,
      outcome: 'success',
    });

    logger.info({ userId, documentId: document.id, message: 'Document uploaded successfully' });

    return this.formatDocument(document);
  }

  /**
   * Retrieves a single document by ID. Checks ownership.
   */
  async getDocument(documentId: string, userId: string) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        jurisdictions: {
          include: {
            jurisdiction: {
              select: { id: true, name: true, code: true, level: true, parentId: true },
            },
          },
        },
      },
    });

    if (!document || document.deletedAt) {
      throw new NotFoundError('Document not found');
    }

    // SECURITY: 404 rather than 403 so other users' document IDs are not revealed (07-SECURITY.md §1.4)
    if (document.userId !== userId) {
      throw new NotFoundError('Document not found');
    }

    return this.formatDocument(document, { includeContent: true });
  }

  /**
   * Retrieves a paginated list of documents with filtering and sorting.
   */
  async getDocuments(params: GetDocumentsParams) {
    const {
      userId,
      page,
      pageSize,
      search,
      jurisdictionLevel,
      jurisdictionId,
      fileType,
      sortBy,
      sortOrder,
      dateFrom,
      dateTo,
    } = params;

    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: Prisma.DocumentWhereInput = {
      userId,
      deletedAt: null,
    };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { originalFilename: { contains: search, mode: 'insensitive' } },
        { contentText: { contains: search, mode: 'insensitive' } },
        { tags: { hasSome: [...new Set([search, search.toLowerCase()])] } },
      ];
    }

    if (fileType) {
      where.fileType = fileType;
    }

    if (dateFrom || dateTo) {
      where.uploadedAt = {};
      if (dateFrom) {
        (where.uploadedAt as Prisma.DateTimeFilter).gte = dateFrom;
      }
      if (dateTo) {
        (where.uploadedAt as Prisma.DateTimeFilter).lte = dateTo;
      }
    }

    if (jurisdictionId) {
      // Include sub-jurisdictions: filtering by "BC" also matches documents tagged with BC municipalities
      const ids = await jurisdictionService.getSelfAndDescendantIds(jurisdictionId);
      where.jurisdictions = {
        some: {
          jurisdictionId: { in: ids },
          ...(jurisdictionLevel ? { jurisdiction: { level: jurisdictionLevel } } : {}),
        },
      };
    } else if (jurisdictionLevel) {
      where.jurisdictions = {
        some: {
          jurisdiction: { level: jurisdictionLevel },
        },
      };
    }

    // Build orderBy; id as a tie-breaker keeps pagination stable when sort values collide
    const orderBy: Prisma.DocumentOrderByWithRelationInput[] = [
      { [sortBy]: sortOrder },
      { id: sortOrder },
    ];

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          jurisdictions: {
            include: {
              jurisdiction: {
                select: { id: true, name: true, code: true, level: true, parentId: true },
              },
            },
          },
        },
      }),
      prisma.document.count({ where }),
    ]);

    return {
      data: documents.map((doc) => this.formatDocument(doc)),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        /** @deprecated alias of totalItems */
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Updates a document's metadata (title, description, tags).
   */
  async updateDocument(params: UpdateDocumentParams) {
    const { userId, documentId, title, description, tags, requestId, actorIp } = params;

    // Fetch existing document
    const existing = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!existing || existing.deletedAt) {
      throw new NotFoundError('Document not found');
    }

    if (existing.userId !== userId) {
      throw new NotFoundError('Document not found');
    }

    // Build update data
    const updateData: Prisma.DocumentUpdateInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (title !== undefined && title !== existing.title) {
      updateData.title = title;
      changes['title'] = { from: existing.title, to: title };
    }

    if (description !== undefined && description !== existing.description) {
      updateData.description = description;
      changes['description'] = { from: existing.description, to: description };
    }

    if (tags !== undefined && JSON.stringify(tags) !== JSON.stringify(existing.tags)) {
      updateData.tags = tags;
      changes['tags'] = { from: existing.tags, to: tags };
    }

    if (Object.keys(updateData).length === 0) {
      // No changes; return existing document
      return this.getDocument(documentId, userId);
    }

    const document = await prisma.document.update({
      where: { id: documentId },
      data: updateData,
      include: {
        jurisdictions: {
          include: {
            jurisdiction: {
              select: { id: true, name: true, code: true, level: true, parentId: true },
            },
          },
        },
      },
    });

    // Audit log (fire-and-forget)
    auditService.logAction({
      actorUserId: userId,
      actorIp,
      action: 'document.update',
      resourceType: 'document',
      resourceId: documentId,
      changes,
      requestId,
      outcome: 'success',
    });

    logger.info({ userId, documentId, message: 'Document updated successfully' });

    return this.formatDocument(document, { includeContent: true });
  }

  /**
   * Soft-deletes a document by setting the deletedAt timestamp.
   */
  async deleteDocument(
    documentId: string,
    userId: string,
    requestId: string,
    actorIp: string,
  ) {
    const existing = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!existing || existing.deletedAt) {
      throw new NotFoundError('Document not found');
    }

    if (existing.userId !== userId) {
      throw new NotFoundError('Document not found');
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    // Audit log (fire-and-forget)
    auditService.logAction({
      actorUserId: userId,
      actorIp,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: documentId,
      requestId,
      outcome: 'success',
    });

    logger.info({ userId, documentId, message: 'Document soft-deleted' });
  }

  /**
   * Returns a download stream for a document's file from S3.
   * Creates an audit log for the download event.
   */
  async downloadDocument(
    documentId: string,
    userId: string,
    requestId: string,
    actorIp: string,
  ) {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.deletedAt) {
      throw new NotFoundError('Document not found');
    }

    if (document.userId !== userId) {
      throw new NotFoundError('Document not found');
    }

    const fileData = await fileService.getFileStream(document.fileKey);

    // Audit log (fire-and-forget)
    auditService.logAction({
      actorUserId: userId,
      actorIp,
      action: 'document.download',
      resourceType: 'document',
      resourceId: documentId,
      requestId,
      outcome: 'success',
    });

    logger.info({ userId, documentId, message: 'Document downloaded' });

    return {
      stream: fileData.stream,
      contentType: fileData.contentType,
      contentLength: fileData.contentLength,
      filename: document.originalFilename,
    };
  }

  /**
   * Formats a document record with flattened jurisdiction data.
   */
  private formatDocument(
    doc: {
      id: string;
      userId: string;
      title: string;
      description: string | null;
      fileKey: string;
      fileType: string;
      fileSizeBytes: number;
      originalFilename: string;
      contentText?: string | null;
      tags: string[];
      uploadedAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      jurisdictions: {
        jurisdiction: {
          id: string;
          name: string;
          code: string;
          level: string;
          parentId: string | null;
        };
      }[];
    },
    options: { includeContent?: boolean } = {},
  ) {
    return {
      id: doc.id,
      userId: doc.userId,
      title: doc.title,
      description: doc.description,
      fileType: doc.fileType,
      fileSizeBytes: doc.fileSizeBytes,
      originalFilename: doc.originalFilename,
      tags: doc.tags,
      ...(options.includeContent ? { contentText: doc.contentText ?? null } : {}),
      jurisdictions: doc.jurisdictions.map((dj) => dj.jurisdiction),
      uploadedAt: doc.uploadedAt,
      updatedAt: doc.updatedAt,
    };
  }
}

export const documentService = new DocumentService();
