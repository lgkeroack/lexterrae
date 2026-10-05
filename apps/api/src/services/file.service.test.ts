import { describe, expect, it } from 'vitest';
import { FileTypeError, ValidationError } from '../lib/errors.js';
import { sanitizeFilename, validateFileType } from './file.service.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

describe('validateFileType', () => {
  it('detects types by content and requires a matching extension', async () => {
    await expect(validateFileType(PDF, 'statute.pdf')).resolves.toEqual({
      mimeType: 'application/pdf',
      extension: 'pdf',
    });
    await expect(validateFileType(PNG, 'scan.png')).resolves.toMatchObject({ extension: 'png' });
    await expect(validateFileType(PNG, 'renamed.pdf')).rejects.toBeInstanceOf(FileTypeError);
  });

  it('accepts UTF-8 text only for text extensions', async () => {
    const text = new TextEncoder().encode('Section 1. Short title.');
    await expect(validateFileType(text, 'notes.txt')).resolves.toMatchObject({ extension: 'txt' });
    await expect(validateFileType(text, 'notes.exe')).rejects.toBeInstanceOf(FileTypeError);
    await expect(
      validateFileType(new Uint8Array([0x41, 0x00, 0x42]), 'bin.txt'),
    ).rejects.toBeInstanceOf(FileTypeError);
  });

  it('rejects empty files', async () => {
    await expect(validateFileType(new Uint8Array(), 'a.pdf')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('sanitizeFilename', () => {
  it('strips paths, traversal and unsafe characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\docs\\a<b>.pdf')).toBe('a_b_.pdf');
    expect(sanitizeFilename('\u0000')).toBe('unnamed_file');
    expect(sanitizeFilename(`${'x'.repeat(300)}.pdf`)).toHaveLength(200);
  });
});
