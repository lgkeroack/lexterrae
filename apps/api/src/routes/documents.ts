import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { documentService } from '../services/document.service.js';
import { env } from '../config/env.js';
import {
  uploadDocumentSchema,
  updateDocumentSchema,
  documentQuerySchema,
  documentParamsSchema,
} from '../validators/document.validator.js';
import { ValidationError } from '../lib/errors.js';

const router: ReturnType<typeof Router> = Router();

/**
 * Rate limiter for uploads: 50 per hour per IP.
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    type: 'https://lexterrae.io/problems/rate-limit',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many uploads. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});

/**
 * Multer configuration for handling file uploads in memory.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
  },
});

// All document routes require authentication
router.use(authenticate);

/**
 * POST /api/documents
 * Upload a new document with multipart form data.
 * Expects a file field named "file" and JSON metadata fields.
 */
router.post(
  '/',
  uploadLimiter,
  upload.single('file'),
  validate({ body: uploadDocumentSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new ValidationError('A file is required');
      }

      const { title, description, tags, jurisdictionIds } = req.body;

      const document = await documentService.uploadDocument({
        userId: req.context!.userId,
        title,
        description,
        tags,
        jurisdictionIds,
        file: {
          buffer: req.file.buffer,
          originalname: req.file.originalname,
          size: req.file.size,
        },
        requestId: req.requestId,
        actorIp: req.ip || '0.0.0.0',
      });

      res.status(201).json({ data: document });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/documents
 * Retrieves a paginated list of the authenticated user's documents.
 * Supports filtering by jurisdiction, file type, search text, and date range.
 */
router.get(
  '/',
  validate({ query: documentQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await documentService.getDocuments({
        userId: req.context!.userId,
        page: req.query['page'] as unknown as number,
        pageSize: req.query['pageSize'] as unknown as number,
        search: req.query['search'] as string | undefined,
        jurisdictionLevel: req.query['jurisdictionLevel'] as string | undefined,
        jurisdictionId: req.query['jurisdictionId'] as string | undefined,
        fileType: req.query['fileType'] as string | undefined,
        sortBy: (req.query['sortBy'] as string) || 'uploadedAt',
        sortOrder: (req.query['sortOrder'] as 'asc' | 'desc') || 'desc',
        dateFrom: req.query['dateFrom'] ? new Date(req.query['dateFrom'] as string) : undefined,
        dateTo: req.query['dateTo'] ? new Date(req.query['dateTo'] as string) : undefined,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/documents/:id
 * Retrieves a single document by ID.
 */
router.get(
  '/:id',
  validate({ params: documentParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const document = await documentService.getDocument(
        req.params['id'] as string,
        req.context!.userId,
      );

      res.status(200).json({ data: document });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PATCH /api/documents/:id
 * Updates a document's metadata (title, description, tags).
 */
router.patch(
  '/:id',
  validate({ params: documentParamsSchema, body: updateDocumentSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { title, description, tags } = req.body;

      const document = await documentService.updateDocument({
        userId: req.context!.userId,
        documentId: req.params['id'] as string,
        title,
        description,
        tags,
        requestId: req.requestId,
        actorIp: req.ip || '0.0.0.0',
      });

      res.status(200).json({ data: document });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/documents/:id
 * Soft-deletes a document.
 */
router.delete(
  '/:id',
  validate({ params: documentParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await documentService.deleteDocument(
        req.params['id'] as string,
        req.context!.userId,
        req.requestId,
        req.ip || '0.0.0.0',
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/documents/:id/download
 * Downloads a document's file from S3.
 */
router.get(
  '/:id/download',
  validate({ params: documentParamsSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await documentService.downloadDocument(
        req.params['id'] as string,
        req.context!.userId,
        req.requestId,
        req.ip || '0.0.0.0',
      );

      // SECURITY: Force download, prevent browser from rendering potentially malicious content
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('Cache-Control', 'no-store');
      if (result.contentLength) {
        res.setHeader('Content-Length', result.contentLength);
      }

      result.stream.pipe(res);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
