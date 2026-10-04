import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { s3Client } from '../config/s3.js';
import { env } from '../config/env.js';
import { FileTypeError, InternalError, ValidationError } from '../lib/errors.js';
import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('file.service');

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

const ALLOWED_EXTENSIONS = new Set(Object.values(ALLOWED_MIME_TYPES));

/** Filename extensions accepted for each detected type (e.g. ".jpeg" for JPEG). */
const EXTENSION_ALIASES: Record<string, string[]> = {
  jpg: ['jpg', 'jpeg'],
};

/** Legacy Office formats are OLE2 compound files; file-type reports them all as application/x-cfb. */
const CFB_TYPES: Record<string, { mimeType: string; extension: string }> = {
  doc: { mimeType: 'application/msword', extension: 'doc' },
  xls: { mimeType: 'application/vnd.ms-excel', extension: 'xls' },
};

const TEXT_TYPES: Record<string, { mimeType: string; extension: string }> = {
  txt: { mimeType: 'text/plain', extension: 'txt' },
  csv: { mimeType: 'text/csv', extension: 'csv' },
};

/**
 * DEV ONLY: when LOCAL_STORAGE_DIR is set and NODE_ENV=development, files are stored on local
 * disk instead of S3/MinIO so uploads can be exercised without object storage running.
 */
const LOCAL_STORAGE_DIR =
  env.NODE_ENV === 'development' && process.env['LOCAL_STORAGE_DIR']
    ? path.resolve(process.env['LOCAL_STORAGE_DIR'])
    : null;

function localPath(fileKey: string): string {
  const full = path.resolve(LOCAL_STORAGE_DIR!, fileKey);
  if (!full.startsWith(LOCAL_STORAGE_DIR! + path.sep)) {
    throw new InternalError('Invalid storage key');
  }
  return full;
}

const PDF_EXTRACTION_TIMEOUT_MS = 30_000;
const MAX_EXTRACTED_TEXT_CHARS = 5_000_000;

/**
 * pdf-parse (pdf.js 1.x) can emit unhandled promise rejections for malformed PDFs, which
 * would crash the whole API process. Extraction therefore runs in a throwaway worker thread.
 */
const PDF_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const pdfParse = require(workerData.modulePath);
process.on('unhandledRejection', (e) => { throw e; });
pdfParse(Buffer.from(workerData.buffer))
  .then((r) => parentPort.postMessage({ text: r.text || '' }))
  .catch((e) => parentPort.postMessage({ error: e && e.message ? e.message : String(e) }));
`;

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

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

export class FileService {
  /**
   * Validates a file's type using magic byte detection.
   * Returns the detected MIME type and extension.
   */
  async validateFileType(
    buffer: Buffer,
    originalFilename: string,
  ): Promise<{ mimeType: string; extension: string }> {
    if (buffer.length === 0) {
      throw new ValidationError('The uploaded file is empty');
    }

    const fileExt = path.extname(originalFilename).toLowerCase().replace('.', '');

    // Detect file type from magic bytes
    const detected = await fileTypeFromBuffer(buffer);

    if (detected) {
      let result: { mimeType: string; extension: string } | undefined;
      if (detected.mime === 'application/x-cfb') {
        result = CFB_TYPES[fileExt];
      } else {
        const ext = ALLOWED_MIME_TYPES[detected.mime];
        if (ext) result = { mimeType: detected.mime, extension: ext };
      }

      if (!result) {
        throw new FileTypeError(
          `File type "${detected.mime}" is not supported. Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
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
      if (!isProbablyText(buffer)) {
        throw new FileTypeError(`File has a .${fileExt} extension but is not valid UTF-8 text`);
      }
      return textType;
    }

    throw new FileTypeError(
      `Unable to determine file type. Allowed types: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
    );
  }

  /**
   * Sanitizes a filename by stripping path traversal characters,
   * control characters, and truncating to a safe length.
   */
  sanitizeFilename(filename: string): string {
    // Strip path components
    let sanitized = path.basename(filename);

    // Remove control characters and null bytes
    sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');

    // Remove path traversal sequences
    sanitized = sanitized.replace(/\.\./g, '');

    // Replace any remaining unsafe characters
    sanitized = sanitized.replace(/[<>:"/\\|?*]/g, '_');

    // Collapse multiple underscores/spaces
    sanitized = sanitized.replace(/_{2,}/g, '_').replace(/\s+/g, ' ').trim();

    // Truncate to 200 characters (leaving room for extension)
    if (sanitized.length > 200) {
      const ext = path.extname(sanitized);
      const baseName = path.basename(sanitized, ext);
      sanitized = baseName.slice(0, 200 - ext.length) + ext;
    }

    // If empty after sanitization, use a default
    if (!sanitized || sanitized === '.' || sanitized === '..') {
      sanitized = 'unnamed_file';
    }

    return sanitized;
  }

  /**
   * Extracts searchable text from an uploaded file. Never throws: extraction failures
   * (encrypted, image-only or malformed files) are logged and yield null.
   */
  async extractText(buffer: Buffer, extension: string): Promise<string | null> {
    if (extension === 'pdf') {
      const text = await this.extractPdfText(buffer);
      return text ? text : null;
    }
    if (extension === 'txt' || extension === 'csv') {
      return sanitizeExtractedText(buffer.toString('utf8')) || null;
    }
    return null;
  }

  /**
   * Extracts text content from a PDF buffer using pdf-parse, isolated in a worker thread.
   */
  async extractPdfText(buffer: Buffer): Promise<string> {
    try {
      const modulePath = createRequire(import.meta.url).resolve('pdf-parse/lib/pdf-parse.js');
      const text = await new Promise<string>((resolve, reject) => {
        const worker = new Worker(PDF_WORKER_SOURCE, {
          eval: true,
          workerData: { modulePath, buffer: new Uint8Array(buffer) },
        });
        const timer = setTimeout(() => {
          void worker.terminate();
          reject(new Error('PDF text extraction timed out'));
        }, PDF_EXTRACTION_TIMEOUT_MS);
        worker.once('message', (msg: { text?: string; error?: string }) => {
          clearTimeout(timer);
          void worker.terminate();
          if (msg.error !== undefined) reject(new Error(msg.error));
          else resolve(msg.text ?? '');
        });
        worker.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        worker.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`PDF extraction worker exited with code ${code}`));
        });
      });
      return sanitizeExtractedText(text);
    } catch (err) {
      logger.warn({
        message: 'Failed to extract PDF text',
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  /**
   * Uploads a file buffer to S3/MinIO.
   */
  async streamToS3(
    fileKey: string,
    buffer: Buffer,
    mimeType: string,
    originalFilename: string,
  ): Promise<void> {
    if (LOCAL_STORAGE_DIR) {
      const target = localPath(fileKey);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
      await writeFile(`${target}.mime`, mimeType);
      return;
    }
    try {
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: env.S3_BUCKET,
          Key: fileKey,
          Body: buffer,
          ContentType: mimeType,
          Metadata: {
            'original-filename': encodeURIComponent(originalFilename),
          },
        },
        queueSize: 4,
        partSize: 5 * 1024 * 1024, // 5 MB
      });

      await upload.done();
      logger.info({ message: 'File uploaded to S3', fileKey, mimeType });
    } catch (err) {
      logger.error({
        message: 'Failed to upload file to S3',
        fileKey,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new InternalError('Failed to upload file to storage');
    }
  }

  /**
   * Deletes a file from S3/MinIO.
   */
  async deleteFromS3(fileKey: string): Promise<void> {
    if (LOCAL_STORAGE_DIR) {
      await unlink(localPath(fileKey)).catch(() => undefined);
      await unlink(`${localPath(fileKey)}.mime`).catch(() => undefined);
      return;
    }
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: fileKey,
        }),
      );
      logger.info({ message: 'File deleted from S3', fileKey });
    } catch (err) {
      logger.error({
        message: 'Failed to delete file from S3',
        fileKey,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new InternalError('Failed to delete file from storage');
    }
  }

  /**
   * Generates a UUID-based S3 key for a file upload.
   * Format: uploads/{userId}/{uuid}.{ext}
   */
  generateFileKey(userId: string, extension: string): string {
    const uuid = randomUUID();
    return `uploads/${userId}/${uuid}.${extension}`;
  }

  /**
   * Retrieves a file from S3 and returns a readable stream along with metadata.
   */
  async getFileStream(
    fileKey: string,
  ): Promise<{ stream: Readable; contentType: string; contentLength: number }> {
    if (LOCAL_STORAGE_DIR) {
      const target = localPath(fileKey);
      try {
        const info = await stat(target);
        const contentType = (await readFile(`${target}.mime`, 'utf8').catch(() => '')) || 'application/octet-stream';
        return { stream: createReadStream(target), contentType, contentLength: info.size };
      } catch {
        throw new InternalError('Failed to retrieve file from storage');
      }
    }
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: fileKey,
        }),
      );

      if (!response.Body) {
        throw new InternalError('Empty response from storage');
      }

      return {
        stream: response.Body as Readable,
        contentType: response.ContentType || 'application/octet-stream',
        contentLength: response.ContentLength || 0,
      };
    } catch (err) {
      if (err instanceof InternalError) throw err;
      logger.error({
        message: 'Failed to retrieve file from S3',
        fileKey,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new InternalError('Failed to retrieve file from storage');
    }
  }
}

export const fileService = new FileService();
