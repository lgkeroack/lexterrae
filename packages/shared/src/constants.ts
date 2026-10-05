export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_FILE_SIZE_MB = 50;

/** Upload types accepted by the API (it validates content by magic bytes, see apps/api/src/services/file.service.ts). */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/rtf',
  'text/rtf',
  'image/png',
  'image/jpeg',
] as const;
export const ALLOWED_EXTENSIONS = [
  '.pdf',
  '.txt',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.rtf',
  '.png',
  '.jpg',
  '.jpeg',
] as const;

export const MAX_TITLE_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_TAGS_PER_DOCUMENT = 20;
export const MAX_TAG_LENGTH = 50;
export const MAX_JURISDICTIONS_PER_DOCUMENT = 50;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PAGINATION_DEFAULT_PAGE = 1;
export const PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const PAGINATION_MAX_PAGE_SIZE = 100;

export const SOFT_DELETE_RETENTION_DAYS = 30;

export const JWT_ACCESS_TOKEN_EXPIRY = '15m';
export const JWT_REFRESH_TOKEN_EXPIRY = '7d';
