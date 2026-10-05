import { fileTypeFromBuffer } from 'file-type';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { ALLOWED_EXTENSIONS } from '@lexterrae/shared';
import {
  FileTypeError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../lib/errors.js';
import type { Deps } from '../types.js';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/rtf': 'rtf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

const ALLOWED_LIST = ALLOWED_EXTENSIONS.map((e) => e.slice(1)).join(', ');

/** Filename extensions accepted for each detected type (e.g. ".jpeg" for JPEG). */
const EXTENSION_ALIASES: Record<string, string[]> = { jpg: ['jpg', 'jpeg'] };

/** Legacy Office formats are OLE2 compound files; file-type reports them all as application/x-cfb. */
const CFB_TYPES: Record<string, DetectedType> = {
  doc: { mimeType: 'application/msword', extension: 'doc' },
  xls: { mimeType: 'application/vnd.ms-excel', extension: 'xls' },
};

const TEXT_TYPES: Record<string, DetectedType> = {
  txt: { mimeType: 'text/plain', extension: 'txt' },
  csv: { mimeType: 'text/csv', extension: 'csv' },
};

const PDF_EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_EXTRACTED_TEXT_CHARS = 5_000_000;

export interface DetectedType {
  mimeType: string;
  extension: string;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** Removes null bytes / control characters (Postgres TEXT rejects \u0000) and normalizes whitespace. */
function sanitizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function decodeUtf8(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Validates a file's type by magic bytes; the filename extension must agree with the content. */
export async function validateFileType(bytes: Uint8Array, filename: string): Promise<DetectedType> {
  if (bytes.length === 0) throw new ValidationError('The uploaded file is empty');

  const fileExt = extensionOf(filename);
  const detected = await fileTypeFromBuffer(bytes);

  if (detected) {
    let result: DetectedType | undefined;
    if (detected.mime === 'application/x-cfb') {
      result = CFB_TYPES[fileExt];
    } else {
      const ext = ALLOWED_MIME_TYPES[detected.mime];
      if (ext) result = { mimeType: detected.mime, extension: ext };
    }
    if (!result) {
      throw new FileTypeError(
        `File type "${detected.mime}" is not supported. Allowed types: ${ALLOWED_LIST}`,
      );
    }
    // SECURITY: the filename extension must agree with the detected content type
    const acceptedExts = EXTENSION_ALIASES[result.extension] ?? [result.extension];
    if (!acceptedExts.includes(fileExt)) {
      throw new FileTypeError(
        `File content (${result.extension}) does not match the file extension ".${fileExt || '(none)'}"`,
      );
    }
    return result;
  }

  // Text-based files have no magic bytes: require a text extension AND valid UTF-8 without NUL bytes
  const textType = TEXT_TYPES[fileExt];
  if (textType) {
    if (decodeUtf8(bytes) === null) {
      throw new FileTypeError(`File has a .${fileExt} extension but is not valid UTF-8 text`);
    }
    return textType;
  }

  throw new FileTypeError(`Unable to determine file type. Allowed types: ${ALLOWED_LIST}`);
}

/** Strips path components, control characters and unsafe characters; caps length at 200. */
export function sanitizeFilename(filename: string): string {
  let sanitized = filename.split(/[\\/]/).pop() ?? '';
  sanitized = sanitized
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\.\./g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length > 200) {
    const dot = sanitized.lastIndexOf('.');
    const ext = dot > 0 ? sanitized.slice(dot) : '';
    sanitized = sanitized.slice(0, 200 - ext.length) + ext;
  }
  if (!sanitized || sanitized === '.' || sanitized === '..') sanitized = 'unnamed_file';
  return sanitized;
}

/**
 * Extracts searchable text. Never throws: failures (encrypted, image-only or malformed files)
 * are logged and yield null.
 */
export async function extractText(
  deps: Deps,
  bytes: Uint8Array,
  extension: string,
): Promise<string | null> {
  if (extension === 'txt' || extension === 'csv') {
    return sanitizeExtractedText(decodeUtf8(bytes) ?? '') || null;
  }
  if (extension !== 'pdf') return null;

  let timer: number | undefined;
  try {
    // pdf.js takes ownership of (detaches) the buffer it is given, so pass a copy
    const extraction = getDocumentProxy(bytes.slice()).then((pdf) =>
      extractPdfText(pdf, { mergePages: true }),
    );
    const { text } = await Promise.race([
      extraction,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('PDF text extraction timed out')),
          PDF_EXTRACTION_TIMEOUT_MS,
        );
      }),
    ]);
    return sanitizeExtractedText(text) || null;
  } catch (err) {
    deps.log.warn({ module: 'file', message: 'Failed to extract PDF text', error: err });
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Storage key: uploads/{userId}/{uuid}.{ext} — never derived from user input. */
export function generateFileKey(userId: string, extension: string): string {
  return `uploads/${userId}/${crypto.randomUUID()}.${extension}`;
}

function storageUnavailable(
  deps: Deps,
  action: string,
  fileKey: string,
  err: unknown,
): ServiceUnavailableError {
  deps.log.error({
    module: 'file',
    message: `Failed to ${action} file in R2`,
    fileKey,
    error: err,
  });
  return new ServiceUnavailableError(
    'File storage is temporarily unavailable. Please try again shortly.',
  );
}

export async function putFile(
  deps: Deps,
  fileKey: string,
  bytes: Uint8Array,
  mimeType: string,
  originalFilename: string,
): Promise<void> {
  try {
    await deps.bucket.put(fileKey, bytes, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: encodeURIComponent(originalFilename) },
    });
  } catch (err) {
    throw storageUnavailable(deps, 'store', fileKey, err);
  }
}

export async function deleteFile(deps: Deps, fileKey: string): Promise<void> {
  try {
    await deps.bucket.delete(fileKey);
  } catch (err) {
    throw storageUnavailable(deps, 'delete', fileKey, err);
  }
}

export async function getFile(
  deps: Deps,
  fileKey: string,
): Promise<{ body: ReadableStream; contentType: string; contentLength: number }> {
  let object: R2ObjectBody | null;
  try {
    object = await deps.bucket.get(fileKey);
  } catch (err) {
    throw storageUnavailable(deps, 'read', fileKey, err);
  }
  if (!object) throw new NotFoundError('File not found in storage');
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
    contentLength: object.size,
  };
}
