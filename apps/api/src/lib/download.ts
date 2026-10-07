import type { Context } from 'hono';
import type { AppEnv } from '../types.js';

export interface DownloadableFile {
  body: ReadableStream;
  contentType: string;
  contentLength: number;
  filename: string;
}

/** Streams a stored file as a download. */
export function fileResponse(c: Context<AppEnv>, file: DownloadableFile): Response {
  // ASCII fallback plus RFC 5987 UTF-8 filename so non-ASCII names survive intact
  const asciiName = file.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return c.body(file.body, 200, {
    'Content-Type': file.contentType,
    'Content-Length': String(file.contentLength),
    // SECURITY: force download; never let the browser render uploaded content in our origin
    'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store',
  });
}
