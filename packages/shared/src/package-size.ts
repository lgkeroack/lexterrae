/**
 * Size estimates for AI reference packages, shared by the page (shown before download) and the
 * API (written into the package). An assistant counts text in tokens: about 4 characters each.
 */

/** Characters of instructions, contents table and closing note in every package. */
const PACKAGE_FIXED_CHARS = 4_800;
/** Heading, details and markers around each document. */
const DOCUMENT_OVERHEAD_CHARS = 400;
/** Paragraph labels such as "[D12 ¶34] " add roughly this share to the text. */
const LABEL_OVERHEAD = 1.05;

export const CHARS_PER_TOKEN = 4;

export function estimateDocumentTokens(textChars: number): number {
  return Math.ceil((DOCUMENT_OVERHEAD_CHARS + textChars * LABEL_OVERHEAD) / CHARS_PER_TOKEN);
}

export function estimatePackageTokens(docs: { textChars: number }[]): number {
  return (
    Math.ceil(PACKAGE_FIXED_CHARS / CHARS_PER_TOKEN) +
    docs.reduce((sum, d) => sum + estimateDocumentTokens(d.textChars), 0)
  );
}

/**
 * Roughly how much assistants read in full before they fall back to searching a file (and may
 * miss passages). Approximate and changing as assistants evolve: most read about 100k–200k
 * tokens in full; the largest-context ones (e.g. Gemini) about 1M.
 */
export const MOST_ASSISTANTS_TOKENS = 100_000;
export const LARGEST_ASSISTANTS_TOKENS = 900_000;

export type PackageFit = 'all' | 'largest' | 'none';

export function packageFit(tokens: number): PackageFit {
  if (tokens <= MOST_ASSISTANTS_TOKENS) return 'all';
  if (tokens <= LARGEST_ASSISTANTS_TOKENS) return 'largest';
  return 'none';
}

/** "about 12,000 tokens", "about 1.2 million tokens" */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `about ${(tokens / 1_000_000).toFixed(1)} million tokens`;
  const rounded =
    tokens >= 10_000 ? Math.round(tokens / 1000) * 1000 : Math.round(tokens / 100) * 100;
  return `about ${Math.max(rounded, 100).toLocaleString('en-CA')} tokens`;
}
