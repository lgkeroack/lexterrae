import type { Context } from 'hono';
import { ZodError, type ZodSchema, type z } from 'zod';
import { PayloadTooLargeError, UnsupportedMediaTypeError, ValidationError } from '../lib/errors.js';

type Target = 'body' | 'query' | 'params';

/** True if any string in the (JSON-like) value contains a NUL character, which Postgres rejects. */
function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 5 || value === null || typeof value !== 'object' || value instanceof Blob)
    return false;
  return Object.values(value).some((v) => containsNul(v, depth + 1));
}

function check<S extends ZodSchema>(target: Target, schema: S, input: unknown): z.infer<S> {
  if (containsNul(input)) {
    throw new ValidationError('Text fields must not contain NUL (\\u0000) characters');
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    // Prefix paths with the request part so the client knows where the problem is (e.g. "body.email")
    throw new ZodError(
      result.error.errors.map((issue) => ({ ...issue, path: [target, ...issue.path] })),
    );
  }
  return result.data;
}

const MAX_JSON_BYTES = 1024 * 1024;

/**
 * Reads a request body, counting bytes as they stream in and keeping at most `maxBytes`, so a
 * chunked (no Content-Length) body cannot be buffered without bound. Past the limit the rest of
 * the body is drained without being stored (abandoning a half-read body breaks the connection),
 * then a 413 is thrown.
 */
export async function readBodyLimited(
  c: Context,
  maxBytes: number,
  tooLarge: () => Error = () => new PayloadTooLargeError('Request body is too large'),
): Promise<Uint8Array> {
  const declared = c.req.header('content-length');
  if (declared && !c.req.header('transfer-encoding') && Number(declared) > maxBytes) {
    throw tooLarge();
  }
  const body = c.req.raw.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size <= maxBytes) chunks.push(value);
  }
  if (size > maxBytes) throw tooLarge();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Parses and validates a JSON body (max 1 MB). A missing body is treated as `{}` so
 * required-field messages show.
 *
 * SECURITY: a non-empty body must be sent as application/json. HTML forms cannot send that type
 * cross-site without a CORS preflight (which this API never grants), so this blocks form-based
 * CSRF such as a hidden text/plain form posting to /api/auth/login.
 */
export async function validJson<S extends ZodSchema>(c: Context, schema: S): Promise<z.infer<S>> {
  const bytes = await readBodyLimited(c, MAX_JSON_BYTES);
  const text = new TextDecoder().decode(bytes);
  let body: unknown = {};
  if (text.trim() !== '') {
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new UnsupportedMediaTypeError('Request body must be sent as application/json');
    }
    try {
      body = JSON.parse(text);
    } catch {
      throw new ValidationError('Request body is not valid JSON');
    }
  }
  return check('body', schema, body);
}

/** Validates already-parsed fields (e.g. multipart form fields) as the request body. */
export function validFields<S extends ZodSchema>(schema: S, fields: unknown): z.infer<S> {
  return check('body', schema, fields);
}

export function validQuery<S extends ZodSchema>(c: Context, schema: S): z.infer<S> {
  return check('query', schema, c.req.query());
}

export function validParams<S extends ZodSchema>(c: Context, schema: S): z.infer<S> {
  return check('params', schema, c.req.param());
}
