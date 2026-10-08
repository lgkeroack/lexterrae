/**
 * Excel stores dates and times as numbers (days since 1900, or 1904); the cell's number format
 * says whether a number is a date. These helpers turn such numbers back into readable dates for
 * both .xlsx and .xls files.
 */

/** Built-in number formats that are dates, times or both (ECMA-376 §18.8.30 and locale variants). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/** True when a number format shows a date or time (e.g. "yyyy-mm-dd", "d-mmm-yy", "h:mm"). */
export function isDateFormat(numFmtId: number, formatCode?: string): boolean {
  if (BUILTIN_DATE_FORMATS.has(numFmtId)) return true;
  if (!formatCode) return false;
  const code = formatCode
    .split(';')[0]! // positive-number section
    .replace(/"[^"]*"/g, '') // quoted text
    .replace(/\\./g, '') // escaped characters
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '') // colours and locales, but not [h] [mm] [ss]
    .replace(/_.|\*./g, ''); // padding
  return /[dmyhs]/i.test(code) && !/^general$/i.test(code.trim());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Formats an Excel serial date as "2025-01-21", "2025-01-21 14:30" or, for a time alone, "14:30".
 * Handles the 1904 date system and Excel's 1900 leap-year quirk (serial 60 is 1900-02-29).
 */
export function formatExcelDate(serial: number, date1904 = false): string {
  if (!Number.isFinite(serial) || serial < 0) return String(serial);
  // Round to the second to undo floating-point drift (0.99999999 → next day 00:00)
  const totalSeconds = Math.round(serial * 86400);
  const days = Math.floor(totalSeconds / 86400);
  const seconds = totalSeconds - days * 86400;
  const time =
    `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}` +
    (seconds % 60 ? `:${pad(seconds % 60)}` : '');
  if (days === 0) return time; // a time of day on its own

  let date: string;
  if (!date1904 && days === 60) {
    date = '1900-02-29'; // Excel's fictitious day, kept for fidelity
  } else {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
    date = new Date(epoch + days * DAY_MS).toISOString().slice(0, 10);
  }
  return seconds ? `${date} ${time}` : date;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
