import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { FileSizeError, ValidationError } from '../lib/errors.js';
import { requireBackendAccess } from '../middleware/access.js';
import { authenticate } from '../middleware/auth.js';
import { generalLimiter, searchLimiter, uploadLimiter } from '../middleware/rate-limit.js';
import {
  readBodyLimited,
  validFields,
  validJson,
  validParams,
  validQuery,
} from '../middleware/validate.js';
import { fileResponse } from '../lib/download.js';
import * as documents from '../services/document.service.js';
import type { AppEnv } from '../types.js';
import {
  documentParamsSchema,
  documentQuerySchema,
  updateDocumentSchema,
  uploadDocumentSchema,
} from '../validators/document.validator.js';

const router = new Hono<AppEnv>();

// All document routes require authentication; limits then apply per user
// The backend: only users an admin has authorized (see routes/access.ts)
router.use('*', authenticate, generalLimiter, requireBackendAccess);

/**
 * Caps the upload size (1 MB of headroom for the other form fields). Browsers send Content-Length,
 * which is checked without reading the body; a chunked body is read with a byte cap instead.
 */
const enforceUploadSize: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { MAX_FILE_SIZE_MB } = c.get('deps').config;
  const maxBytes = (MAX_FILE_SIZE_MB + 1) * 1024 * 1024;
  const tooLarge = () => new FileSizeError(`File exceeds the ${MAX_FILE_SIZE_MB} MB limit`);
  if (c.req.header('content-length') && !c.req.header('transfer-encoding')) {
    if (Number(c.req.header('content-length')) > maxBytes) throw tooLarge();
  } else if (c.req.raw.body) {
    const bytes = await readBodyLimited(c, maxBytes, tooLarge);
    c.req.raw = new Request(c.req.raw, { body: bytes });
  }
  await next();
};

/**
 * POST /api/documents (alias: /api/documents/upload)
 * Multipart form: file, title, description, tags[] / tags, jurisdictionIds[] / jurisdictionIds.
 */
router.post('/', uploadLimiter, enforceUploadSize, async (c) => upload(c));
router.post('/upload', uploadLimiter, enforceUploadSize, async (c) => upload(c));

async function upload(c: Context<AppEnv>) {
  const deps = c.get('deps');
  if (!c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    throw new ValidationError(
      'Upload must be sent as multipart/form-data with the file in the "file" field',
    );
  }

  // Parse the multipart body once, directly (hono's parseBody would keep an extra copy)
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    throw new ValidationError('Could not read the uploaded form data');
  }

  // Normalise "tags[]" style keys; repeated fields become arrays
  const fields: Record<string, unknown> = {};
  for (const [rawKey, value] of form.entries()) {
    const key = rawKey.replace(/\[\]$/, '');
    const existing = fields[key];
    if (existing === undefined) fields[key] = rawKey.endsWith('[]') ? [value] : value;
    else fields[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }

  const file = fields['file'];
  if (Array.isArray(file)) throw new ValidationError('Only one file can be uploaded at a time');
  if (!(file instanceof File)) throw new ValidationError('A file is required');
  delete fields['file'];

  const { title, description, tags, jurisdictionIds } = validFields(uploadDocumentSchema, fields);
  const document = await documents.uploadDocument(deps, {
    userId: c.get('userId'),
    title,
    description,
    tags,
    jurisdictionIds,
    file,
  });
  return c.json({ data: document }, 201);
}

/** GET /api/documents — paginated list with filters. */
router.get('/', searchLimiter, async (c) => {
  const query = validQuery(c, documentQuerySchema);
  const result = await documents.listDocuments(c.get('deps'), c.get('userId'), query);
  return c.json(result, 200);
});

/** GET /api/documents/:id */
router.get('/:id', async (c) => {
  const { id } = validParams(c, documentParamsSchema);
  const document = await documents.getDocument(c.get('deps'), id, c.get('userId'));
  return c.json({ data: document }, 200);
});

/** PATCH /api/documents/:id — title, description, tags. */
router.patch('/:id', async (c) => {
  const { id } = validParams(c, documentParamsSchema);
  const { title, description, tags } = await validJson(c, updateDocumentSchema);
  const document = await documents.updateDocument(c.get('deps'), {
    userId: c.get('userId'),
    documentId: id,
    title,
    description,
    tags,
  });
  return c.json({ data: document }, 200);
});

/** DELETE /api/documents/:id — soft delete. */
router.delete('/:id', async (c) => {
  const { id } = validParams(c, documentParamsSchema);
  await documents.deleteDocument(c.get('deps'), id, c.get('userId'));
  return c.body(null, 204);
});

/** POST /api/documents/:id/restore — undoes a delete (until the document is purged). */
router.post('/:id/restore', async (c) => {
  const { id } = validParams(c, documentParamsSchema);
  const document = await documents.restoreDocument(c.get('deps'), id, c.get('userId'));
  return c.json({ data: document }, 200);
});

/** GET /api/documents/:id/download — streams the file from R2. */
router.get('/:id/download', async (c) => {
  const { id } = validParams(c, documentParamsSchema);
  const file = await documents.downloadDocument(c.get('deps'), id, c.get('userId'));

  return fileResponse(c, file);
});

export default router;
