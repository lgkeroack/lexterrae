import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodIssue, type ZodSchema } from 'zod';

type ValidationTarget = 'body' | 'query' | 'params';

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const targets: ValidationTarget[] = ['body', 'query', 'params'];
    const issues: ZodIssue[] = [];

    for (const target of targets) {
      const schema = schemas[target];
      if (!schema) continue;

      // A missing body (e.g. no Content-Type) is treated as an empty object so the
      // schema reports which fields are required instead of "Expected object".
      const input: unknown = target === 'body' ? (req.body ?? {}) : req[target];
      const result = schema.safeParse(input);
      if (!result.success) {
        // Prefix paths with the target so the client knows where the problem is (e.g. "body.email")
        issues.push(...result.error.errors.map((issue) => ({ ...issue, path: [target, ...issue.path] })));
      } else {
        // Replace with parsed (and potentially transformed) data
        req[target] = result.data;
      }
    }

    if (issues.length > 0) {
      next(new ZodError(issues));
      return;
    }

    next();
  };
}
