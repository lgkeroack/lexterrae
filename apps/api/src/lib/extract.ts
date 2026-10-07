import { unzipSync } from 'fflate';

/**
 * Plain-text extraction for Word (.docx), Excel (.xlsx) and RTF uploads, so their contents can be
 * searched and included in AI reference packages. Pure functions over the file's bytes; callers
 * bound the work by file size and catch failures.
 */

/** Largest single file read out of a .docx/.xlsx archive (guards against zip bombs). */
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;

function unzip(bytes: Uint8Array, names: (name: string) => boolean): Record<string, string> {
  const entries = unzipSync(bytes, {
    filter: (f) => names(f.name) && f.originalSize <= MAX_ENTRY_BYTES,
  });
  const decoder = new TextDecoder('utf-8');
  return Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, decoder.decode(v)]));
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** Tidies extracted text: no trailing spaces, at most one blank line in a row. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Word ─────────────────────────────────────────────────────────────────────

/**
 * WordprocessingML body to text: paragraphs separated by blank lines, table rows on one line
 * with cells separated by " | ". Deleted (tracked) text and field codes are left out.
 */
export function wordXmlToText(xml: string): string {
  let out = '';
  let inText = false;
  let cellDepth = 0;
  for (const token of xml.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (token[0] !== '<') {
      if (inText) out += decodeXml(token);
      continue;
    }
    const tag = /^<\/?([\w:]+)/.exec(token)?.[1];
    const closing = token[1] === '/';
    const selfClosing = token.endsWith('/>');
    switch (tag) {
      case 'w:t':
        inText = !closing && !selfClosing;
        break;
      case 'w:tab':
        if (!closing) out += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        if (!closing) out += cellDepth ? ' ' : '\n';
        break;
      case 'w:p':
        if (closing) out += cellDepth ? ' ' : '\n\n';
        break;
      case 'w:tc':
        if (closing) {
          cellDepth--;
          out = out.replace(/\s+$/, '') + ' | ';
        } else if (!selfClosing) cellDepth++;
        break;
      case 'w:tr':
        if (closing) out = out.replace(/ \| $/, '') + '\n';
        break;
      case 'w:tbl':
        if (closing) out += '\n';
        break;
    }
  }
  return out;
}

export function extractDocx(bytes: Uint8Array): string {
  const files = unzip(bytes, (n) => n === 'word/document.xml' || n === 'word/footnotes.xml');
  const body = files['word/document.xml'];
  if (body === undefined) throw new Error('Not a Word document (no word/document.xml)');
  let text = wordXmlToText(body);
  const footnotes = files['word/footnotes.xml'] && tidy(wordXmlToText(files['word/footnotes.xml']));
  if (footnotes) text += `\n\nFootnotes\n\n${footnotes}`;
  return tidy(text);
}

// ─── Excel ────────────────────────────────────────────────────────────────────

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]!) : undefined;
}

/** Text of every <t> inside a fragment (shared strings and inline strings, rich text included). */
function texts(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!)).join('');
}

/** "AB12" → 27 (zero-based column 27) */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Each sheet as "Sheet: name" followed by one line per row, cells separated by " | ". */
export function extractXlsx(bytes: Uint8Array): string {
  const files = unzip(
    bytes,
    (n) =>
      n === 'xl/workbook.xml' ||
      n === 'xl/_rels/workbook.xml.rels' ||
      n === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(n),
  );
  const workbook = files['xl/workbook.xml'];
  if (workbook === undefined) throw new Error('Not an Excel workbook (no xl/workbook.xml)');

  const shared = [...(files['xl/sharedStrings.xml'] ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => texts(m[1]!),
  );
  const targets = new Map(
    [...(files['xl/_rels/workbook.xml.rels'] ?? '').matchAll(/<Relationship\b[^>]*>/g)].map(
      (m) => [attr(m[0], 'Id'), attr(m[0], 'Target')] as const,
    ),
  );

  const sections: string[] = [];
  for (const [sheetTag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(sheetTag, 'name') ?? 'Sheet';
    const target = targets.get(attr(sheetTag, 'r:id'));
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const sheet = files[path];
    if (!sheet) continue;

    const lines: string[] = [];
    for (const [, rowXml] of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of rowXml!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = ` ${cell[1]}`;
        const inner = cell[2] ?? '';
        const type = attr(attrs, 't');
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (type === 's' && raw !== undefined) value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = texts(inner);
        else if (type === 'b' && raw !== undefined) value = raw === '1' ? 'TRUE' : 'FALSE';
        else if (raw !== undefined) value = decodeXml(raw);
        const ref = attr(attrs, 'r');
        const index = ref ? columnIndex(ref) : cells.length;
        while (cells.length < index) cells.push('');
        cells[index] = value.replace(/\s+/g, ' ').trim();
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) lines.push(cells.join(' | '));
    }
    if (lines.length) sections.push(`Sheet: ${name}\n\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

// ─── RTF ──────────────────────────────────────────────────────────────────────

/** Windows-1252 characters for bytes 0x80–0x9F (others match Latin-1). */
const CP1252: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function cp1252(byte: number): string {
  return CP1252[byte] ?? (byte >= 0x80 && byte <= 0x9f ? '' : String.fromCharCode(byte));
}

/** Groups whose content is not document text. */
const SKIPPED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'xmlnstbl',
  'header',
  'footer',
  'headerl',
  'headerr',
  'headerf',
  'footerl',
  'footerr',
  'footerf',
  'fldinst',
  'filetbl',
  'revtbl',
]);

const SYMBOLS: Record<string, string> = {
  par: '\n\n',
  line: '\n',
  sect: '\n\n',
  page: '\n\n',
  tab: '\t',
  cell: ' | ',
  row: '\n',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
};

export function rtfToText(rtf: string): string {
  let out = '';
  let skip = false;
  let uc = 1; // characters to skip after a \u escape
  let pendingSkip = 0;
  const stack: { skip: boolean; uc: number }[] = [];
  const emit = (text: string) => {
    if (skip) return;
    if (pendingSkip > 0) {
      pendingSkip--;
      return;
    }
    out += text;
  };

  for (let i = 0; i < rtf.length; ) {
    const ch = rtf[i]!;
    if (ch === '{') {
      stack.push({ skip, uc });
      i++;
      if (rtf.startsWith('\\*', i)) skip = true;
      continue;
    }
    if (ch === '}') {
      const prev = stack.pop();
      if (prev) ({ skip, uc } = prev);
      pendingSkip = 0; // a \u fallback never extends past its group
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch !== '\\') {
      emit(ch);
      i++;
      continue;
    }

    const next = rtf[i + 1];
    if (next === undefined) break;
    if (next === "'") {
      const byte = parseInt(rtf.slice(i + 2, i + 4), 16);
      if (!Number.isNaN(byte)) emit(cp1252(byte));
      i += 4;
      continue;
    }
    if (next === '\\' || next === '{' || next === '}') {
      emit(next);
      i += 2;
      continue;
    }
    if (next === '~') {
      emit(' ');
      i += 2;
      continue;
    }
    if (next === '_') {
      emit('-');
      i += 2;
      continue;
    }
    if (next === '\n' || next === '\r') {
      emit('\n\n');
      i += 2;
      continue;
    }
    if (!/[a-z]/i.test(next)) {
      // \* (handled at the group start), \- optional hyphen, \| and other symbols: ignore
      i += 2;
      continue;
    }

    const match = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 40))!;
    const word = match[1]!;
    const param = match[2] === undefined ? undefined : Number(match[2]);
    i += match[0].length;

    if (SKIPPED_DESTINATIONS.has(word)) {
      skip = true;
    } else if (word === 'uc' && param !== undefined) {
      uc = param;
    } else if (word === 'u' && param !== undefined) {
      if (!skip) {
        emit(String.fromCharCode(param < 0 ? param + 65536 : param));
        pendingSkip = uc;
      }
    } else if (SYMBOLS[word]) {
      emit(SYMBOLS[word]!);
    }
  }
  return tidy(out.replace(/ \| \n/g, '\n'));
}

export function extractRtf(bytes: Uint8Array): string {
  // RTF is 7-bit ASCII with escapes; decode bytes one to one
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  if (!text.startsWith('{\\rtf')) throw new Error('Not an RTF document');
  return rtfToText(text);
}
