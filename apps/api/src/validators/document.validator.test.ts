import { describe, expect, it } from 'vitest';
import { documentQuerySchema, uploadDocumentSchema } from './document.validator.js';

describe('uploadDocumentSchema', () => {
  it('accepts array fields as repeated values, JSON or comma-separated strings', () => {
    const repeated = uploadDocumentSchema.parse({
      title: 'T',
      tags: ['a', 'b'],
      jurisdictionIds: ['ON'],
    });
    const json = uploadDocumentSchema.parse({
      title: 'T',
      tags: '["a","b"]',
      jurisdictionIds: '["ON"]',
    });
    const csv = uploadDocumentSchema.parse({ title: 'T', tags: 'a, b', jurisdictionIds: 'ON' });
    for (const parsed of [repeated, json, csv]) {
      expect(parsed.tags).toEqual(['a', 'b']);
      expect(parsed.jurisdictionIds).toEqual(['ON']);
    }
  });

  it('de-duplicates tags case-insensitively and requires a jurisdiction', () => {
    expect(
      uploadDocumentSchema.parse({ title: 'T', tags: 'Lease, lease', jurisdictionIds: 'ON' }).tags,
    ).toEqual(['Lease']);
    expect(uploadDocumentSchema.safeParse({ title: 'T', jurisdictionIds: [] }).success).toBe(false);
  });
});

describe('documentQuerySchema', () => {
  it('applies defaults and maps snake_case sort keys', () => {
    expect(documentQuerySchema.parse({ sortBy: 'uploaded_at' })).toMatchObject({
      page: 1,
      pageSize: 20,
      sortBy: 'uploadedAt',
      sortOrder: 'desc',
    });
  });

  it('treats empty values as absent and rejects oversized pages', () => {
    expect(documentQuerySchema.parse({ fileType: '', search: ' ' }).fileType).toBeUndefined();
    expect(documentQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });

  it('makes a date-only dateTo inclusive of the whole day', () => {
    expect(documentQuerySchema.parse({ dateTo: '2026-01-31' }).dateTo?.toISOString()).toBe(
      '2026-01-31T23:59:59.999Z',
    );
  });
});
