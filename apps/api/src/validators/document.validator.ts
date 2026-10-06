import { z } from 'zod';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_JURISDICTIONS_PER_DOCUMENT,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_DOCUMENT,
  MAX_TITLE_LENGTH,
  PAGINATION_MAX_PAGE_SIZE,
} from '@lexterrae/shared';

/**
 * Multipart form fields always arrive as strings. Array fields may be sent as a JSON array
 * string ('["a","b"]'), a comma-separated string, repeated fields (parsed as an array),
 * or a real array (JSON bodies). Normalize all of these to string[].
 */
function toStringArray(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value; // let zod report the type error
    }
  }
  return trimmed
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Treats empty query-string values (e.g. "?fileType=") as absent. */
function emptyToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

const tagsSchema = z.preprocess(
  toStringArray,
  z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(MAX_TAG_LENGTH, `Each tag must be ${MAX_TAG_LENGTH} characters or fewer`),
    )
    .max(MAX_TAGS_PER_DOCUMENT, `Maximum ${MAX_TAGS_PER_DOCUMENT} tags allowed`)
    // de-duplicate tags case-insensitively, keeping first spelling
    .transform((tags) => {
      const seen = new Set<string>();
      return tags.filter((t) => {
        const key = t.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
);

/** A jurisdiction reference: either its UUID or its unique code (e.g. "CA", "BC", "BC-VANCOUVER"). */
const jurisdictionRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(
    /^(?:[0-9a-fA-F-]{36}|[A-Za-z0-9_-]+)$/,
    'Each jurisdiction must be a valid jurisdiction ID or code',
  );

export const uploadDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer`),
  description: z
    .string()
    .trim()
    .max(
      MAX_DESCRIPTION_LENGTH,
      `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    )
    .optional()
    .default(''),
  tags: tagsSchema.optional().default([]),
  jurisdictionIds: z.preprocess(
    toStringArray,
    z
      .array(jurisdictionRefSchema)
      .min(1, 'At least one jurisdiction is required')
      .max(
        MAX_JURISDICTIONS_PER_DOCUMENT,
        `Maximum ${MAX_JURISDICTIONS_PER_DOCUMENT} jurisdictions allowed`,
      )
      .transform((ids) => [...new Set(ids)]),
  ),
});

export const updateDocumentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title must not be empty')
    .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer`)
    .optional(),
  description: z
    .string()
    .trim()
    .max(
      MAX_DESCRIPTION_LENGTH,
      `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    )
    .optional(),
  tags: tagsSchema.optional(),
});

/** Accept both camelCase and the snake_case column names the web client uses. */
const SORT_FIELD_ALIASES: Record<string, string> = {
  uploaded_at: 'uploadedAt',
  updated_at: 'updatedAt',
  file_size_bytes: 'fileSizeBytes',
};

/** A bare date (YYYY-MM-DD) used as an upper bound means "through the end of that day" (UTC). */
function endOfDayIfDateOnly(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return `${value.trim()}T23:59:59.999Z`;
  }
  return emptyToUndefined(value);
}

export const documentQuerySchema = z
  .object({
    page: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(100_000, 'Page must be 100000 or lower').default(1),
    ),
    pageSize: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(PAGINATION_MAX_PAGE_SIZE).default(20),
    ),
    search: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
    jurisdictionLevel: z.preprocess(
      emptyToUndefined,
      z.enum(['federal', 'provincial', 'territorial', 'municipal']).optional(),
    ),
    jurisdictionId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    fileType: z.preprocess(
      (v) =>
        typeof v === 'string' ? emptyToUndefined(v.trim().toLowerCase().replace(/^\./, '')) : v,
      z.enum(['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'rtf', 'png', 'jpg']).optional(),
    ),
    sortBy: z.preprocess(
      (v) => (typeof v === 'string' ? (SORT_FIELD_ALIASES[v] ?? emptyToUndefined(v)) : v),
      z.enum(['uploadedAt', 'title', 'fileSizeBytes', 'updatedAt']).default('uploadedAt'),
    ),
    sortOrder: z.preprocess(
      (v) => (typeof v === 'string' ? emptyToUndefined(v.toLowerCase()) : v),
      z.enum(['asc', 'desc']).default('desc'),
    ),
    dateFrom: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    dateTo: z.preprocess(endOfDayIfDateOnly, z.coerce.date().optional()),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    message: 'dateFrom must be on or before dateTo',
    path: ['dateFrom'],
  });

export const documentParamsSchema = z.object({
  id: z.string().uuid('Document ID must be a valid UUID'),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type DocumentQueryInput = z.infer<typeof documentQuerySchema>;
export type DocumentParamsInput = z.infer<typeof documentParamsSchema>;
