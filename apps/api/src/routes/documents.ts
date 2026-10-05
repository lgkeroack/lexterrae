import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { generalLimiter, searchLimiter, uploadLimiter } from '../lib/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { documentService } from '../services/document.service.js';
import { env } from '../config/env.js';
import {
  uploadDocumentSchema,
  updateDocumentSchema,
  documentQuerySchema,
  documentParamsSchema,
  type DocumentQueryInput,
} from '../validators/document.validator.js';
import { FileSizeError, ValidationError } from '../lib/errors.js';

const router: ReturnType<typeof Router> = Router();

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

/**
 * Runs multer and converts its errors (e.g. LIMIT_FILE_SIZE) into application errors
 * so they produce 413/400 problem responses instead of a generic 500.
 */
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new FileSizeError(`File exceeds the ${env.MAX_FILE_SIZE_MB} MB limit`));
      }
      return next(new ValidationError(`Invalid upload: ${err.message}`));
    }
    next(err);
  });
}

// All document routes require authentication; limits are then applied per user
router.use(authenticate, generalLimiter);

/**
 * POST /api/documents
 * Upload a new document with multipart form data.
 * Expects a file field named "file" and JSON metadata fields.
 */
router.post(
  ['/', '/upload'],
  // Checked before multer so rejected uploads are not buffered
  uploadLimiter,
  handleUpload,
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
  searchLimiter,
  validate({ query: documentQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // validate() replaced req.query with the parsed/coerced values
      const query = req.query as unknown as DocumentQueryInput;
      const result = await documentService.getDocuments({
        userId: req.context!.userId,
        ...query,
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
      // ASCII fallback plus RFC 5987 UTF-8 filename so non-ASCII names survive intact
      const asciiName = result.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('Cache-Control', 'no-store');
      if (result.contentLength) {
        res.setHeader('Content-Length', result.contentLength);
      }

      // A storage error mid-stream must not crash the process (unhandled 'error' event)
      result.stream.on('error', (streamErr) => {
        if (!res.headersSent) {
          next(streamErr);
        } else {
          res.destroy(streamErr);
        }
      });
      res.on('close', () => result.stream.destroy());
      result.stream.pipe(res);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
