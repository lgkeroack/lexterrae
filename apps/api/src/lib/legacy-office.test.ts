import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { extractDoc, extractXls } from './legacy-office.js';

// Saved by LibreOffice as Word 97–2003 and Excel 97–2003
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url));

describe('extractDoc', () => {
  it('reads paragraphs, special characters and tables from a Word 97–2003 file', () => {
    expect(extractDoc(fixture('by-law.doc'))).toBe(
      'Squamish Tree By-law No. 2290\n\n' +
        'Section 5. A permit is required to cut a protected tree — fee: $150 (café “quotes”).\n\n' +
        'See schedule A\n\n' +
        'Species | Min. diameter | Permit\nDouglas fir | 30 cm | Yes\n\n' +
        'Final paragraph.',
    );
  });

  it('rejects files that are not Office 97–2003 documents', () => {
    expect(() => extractDoc(strToU8('not an office file'.repeat(40)))).toThrow(/Office 97–2003/);
  });
});

describe('extractXls', () => {
  it('reads every sheet with shared strings, numbers, dates, times, booleans and formulas', () => {
    expect(extractXls(fixture('hearings.xls'))).toBe(
      'Sheet: Hearings\n\n' +
        'Hearing | Date | Time | Fee | Paid\n' +
        'Rezoning | 2025-01-21 | 14:30 | 250.5 | TRUE | 501 | Rezoning hearing\n' +
        'Variance | 2025-03-04 09:15 |  | 1200 | FALSE\n\n' +
        'Sheet: Notes\n\nBylaw adopted | 2024-11-05',
    );
  });
});
