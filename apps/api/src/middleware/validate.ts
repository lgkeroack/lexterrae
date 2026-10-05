import type { Context } from 'hono';
import { ZodError, type ZodSchema, type z } from 'zod';
import { PayloadTooLargeError, ValidationError } from '../lib/errors.js';

type Target = 'body' | 'query' | 'params';

function check<S extends ZodSchema>(target: Target, schema: S, input: unknown): z.infer<S> {
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

/** Parses and validates a JSON body. A missing body is treated as `{}` so required-field messages show. */
export async function validJson<S extends ZodSchema>(c: Context, schema: S): Promise<z.infer<S>> {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > MAX_JSON_BYTES) throw new PayloadTooLargeError('Request body is too large');
  const text = await c.req.text();
  if (text.length > MAX_JSON_BYTES) throw new PayloadTooLargeError('Request body is too large');
  let body: unknown = {};
  if (text.trim() !== '') {
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
