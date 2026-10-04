/** Placeholder shown when a value is missing or cannot be formatted. */
export const EMPTY_VALUE = '—';

/**
 * Format file size in bytes to human-readable string.
 * Returns an em dash for null/undefined/NaN/negative input.
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return EMPTY_VALUE;
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  // Sub-byte values (0 < bytes < 1) give a negative log; clamp to bytes.
  let i = Math.max(0, Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1));
  let size = bytes / Math.pow(k, i);
  // Avoid "1024.0 KB" when rounding pushes the value up to the next unit.
  if (i > 0 && i < units.length - 1 && Number(size.toFixed(1)) >= k) {
    i += 1;
    size = bytes / Math.pow(k, i);
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function toValidDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format a date to a localized display string (e.g. "Oct 4, 2026").
 * Rendered in the viewer's local timezone. Returns an em dash for
 * null/empty/invalid input instead of "Invalid Date".
 */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toValidDate(value);
  if (!date) return EMPTY_VALUE;
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a date to include time, in the viewer's local timezone.
 */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toValidDate(value);
  if (!date) return EMPTY_VALUE;
  return date.toLocaleString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * ISO string suitable for a <time dateTime> attribute, or undefined if invalid.
 */
export function toISODate(value: string | number | Date | null | undefined): string | undefined {
  return toValidDate(value)?.toISOString();
}

/**
 * Truncate a string to a max length with ellipsis.
 */
export function truncate(str: string | null | undefined, maxLength: number): string {
  if (!str) return '';
  if (maxLength <= 0) return '';
  if (str.length <= maxLength) return str;
  if (maxLength === 1) return '…';
  return str.slice(0, maxLength - 1) + '…';
}
