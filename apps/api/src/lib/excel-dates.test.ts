import { describe, expect, it } from 'vitest';
import { formatExcelDate, isDateFormat } from './excel-dates.js';

describe('isDateFormat', () => {
  it('recognizes built-in and custom date and time formats', () => {
    expect(isDateFormat(14)).toBe(true);
    expect(isDateFormat(164, 'yyyy-mm-dd')).toBe(true);
    expect(isDateFormat(165, '[$-409]d-mmm-yy;@')).toBe(true);
    expect(isDateFormat(166, '[h]:mm:ss')).toBe(true);
  });

  it('leaves numbers, currency and text formats alone', () => {
    expect(isDateFormat(0)).toBe(false);
    expect(isDateFormat(4)).toBe(false);
    expect(isDateFormat(164, '#,##0.00 "days"')).toBe(false);
    expect(isDateFormat(165, '[Red]0.00')).toBe(false);
    expect(isDateFormat(166, 'General')).toBe(false);
  });
});

describe('formatExcelDate', () => {
  it('converts serials in the 1900 system, including the leap-year quirk', () => {
    expect(formatExcelDate(1)).toBe('1900-01-01');
    expect(formatExcelDate(59)).toBe('1900-02-28');
    expect(formatExcelDate(60)).toBe('1900-02-29');
    expect(formatExcelDate(61)).toBe('1900-03-01');
    expect(formatExcelDate(45678)).toBe('2025-01-21');
    expect(formatExcelDate(45678.604166666664)).toBe('2025-01-21 14:30');
    expect(formatExcelDate(0.5)).toBe('12:00');
    expect(formatExcelDate(45677.99999999)).toBe('2025-01-21');
  });

  it('converts serials in the 1904 system', () => {
    expect(formatExcelDate(1, true)).toBe('1904-01-02');
    expect(formatExcelDate(44216, true)).toBe('2025-01-21');
  });
});
