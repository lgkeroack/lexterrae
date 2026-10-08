import { formatExcelDate, isDateFormat } from './excel-dates.js';
import { cp1252, tidy } from './extract.js';

/**
 * Text extraction for legacy binary Office files: Word 97–2003 (.doc) and Excel 97–2003 (.xls).
 * Both are OLE compound files (a small FAT file system); the text lives in the WordDocument and
 * Workbook streams. Older formats (Word 6/95, Excel 5/95) and encrypted files are rejected.
 */

// ─── Compound File Binary (MS-CFB) ───────────────────────────────────────────

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;

class CompoundFile {
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[] = [];
  private readonly entries: { name: string; type: number; start: number; size: number }[] = [];
  private readonly miniStream: Uint8Array;
  private readonly miniCutoff: number;

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length < 512 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
      throw new Error('Not an Office 97–2003 file');
    }
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.sectorSize = 1 << this.u16(0x1e);
    if (this.sectorSize !== 512 && this.sectorSize !== 4096) throw new Error('Bad sector size');
    this.miniCutoff = this.u32(0x38);

    // FAT sector numbers: 109 in the header, the rest in a chain of DIFAT sectors
    const fatSectors: number[] = [];
    for (let i = 0; i < 109; i++) fatSectors.push(this.u32(0x4c + i * 4));
    let difat = this.u32(0x44);
    for (let n = 0; n < this.u32(0x48) && difat < END_OF_CHAIN; n++) {
      const base = this.offset(difat);
      const perSector = this.sectorSize / 4 - 1;
      for (let i = 0; i < perSector; i++) fatSectors.push(this.u32(base + i * 4));
      difat = this.u32(base + perSector * 4);
    }
    for (const sector of fatSectors.slice(0, this.u32(0x2c))) {
      if (sector >= END_OF_CHAIN) continue;
      const base = this.offset(sector);
      for (let i = 0; i < this.sectorSize / 4; i++) this.fat.push(this.u32(base + i * 4));
    }

    const miniFatBytes = this.chain(this.u32(0x3c));
    for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) {
      this.miniFat.push(new DataView(miniFatBytes.buffer).getUint32(i, true));
    }

    const dir = this.chain(this.u32(0x30));
    const dirView = new DataView(dir.buffer);
    for (let off = 0; off + 128 <= dir.length; off += 128) {
      const nameLength = Math.min(dirView.getUint16(off + 0x40, true), 64);
      let name = '';
      for (let i = 0; i + 2 < nameLength; i += 2)
        name += String.fromCharCode(dirView.getUint16(off + i, true));
      this.entries.push({
        name,
        type: dir[off + 0x42]!,
        start: dirView.getUint32(off + 0x74, true),
        size: dirView.getUint32(off + 0x78, true),
      });
    }
    const root = this.entries[0];
    this.miniStream = root ? this.chain(root.start, root.size) : new Uint8Array();
  }

  private u16(off: number) {
    return this.view.getUint16(off, true);
  }

  private u32(off: number) {
    return this.view.getUint32(off, true);
  }

  private offset(sector: number): number {
    const off = (sector + 1) * this.sectorSize;
    if (off + this.sectorSize > this.bytes.length) throw new Error('Sector outside the file');
    return off;
  }

  /** Follows a FAT chain (bounded, so a looping chain can't hang the Worker). */
  private chain(start: number, size?: number): Uint8Array {
    const parts: Uint8Array[] = [];
    const maxSectors = Math.ceil(this.bytes.length / this.sectorSize);
    for (let s = start, n = 0; s < END_OF_CHAIN && s !== FREE_SECT && n < maxSectors; n++) {
      const off = this.offset(s);
      parts.push(this.bytes.subarray(off, off + this.sectorSize));
      s = this.fat[s] ?? END_OF_CHAIN;
    }
    return concat(parts, size);
  }

  private miniChain(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = [];
    const maxSectors = Math.ceil(this.miniStream.length / 64);
    for (let s = start, n = 0; s < END_OF_CHAIN && n < maxSectors; n++) {
      parts.push(this.miniStream.subarray(s * 64, s * 64 + 64));
      s = this.miniFat[s] ?? END_OF_CHAIN;
    }
    return concat(parts, size);
  }

  /** A stream by name (null when absent). */
  stream(name: string): Uint8Array | null {
    const entry = this.entries.find((e) => e.type === 2 && e.name === name);
    if (!entry) return null;
    return entry.size < this.miniCutoff
      ? this.miniChain(entry.start, entry.size)
      : this.chain(entry.start, entry.size);
  }
}

function concat(parts: Uint8Array[], size?: number): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return size === undefined ? out : out.subarray(0, Math.min(size, total));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// ─── Word 97–2003 (MS-DOC) ───────────────────────────────────────────────────

/** Word's control characters to plain text; field instructions are dropped, results kept. */
function cleanWordText(raw: string): string {
  let out = '';
  const fields: boolean[] = []; // per open field: still in its instruction part?
  for (const ch of raw) {
    if (ch === '\u0013') {
      fields.push(true);
      continue;
    }
    if (ch === '\u0014') {
      if (fields.length) fields[fields.length - 1] = false;
      continue;
    }
    if (ch === '\u0015') {
      fields.pop();
      continue;
    }
    if (fields.some((inInstruction) => inInstruction)) continue;
    out += ch;
  }
  return out
    .replace(/\u0007\u0007(?!\r?[^\r\u0007]*\u0007)/g, '\n\n') // end of the table's last row
    .replace(/\u0007\u0007/g, '\n') // end of a table cell, then end of the row
    .replace(/\u0007/g, ' | ') // end of a table cell
    .replace(/\r/g, '\n\n') // paragraph
    .replace(/[\u000b]/g, '\n') // line break
    .replace(/[\u000c\u000e]/g, '\n\n') // page and column breaks
    .replace(/\u001e/g, '-') // non-breaking hyphen
    .replace(/[\u0000-\u0008\u000f-\u001f]/g, '') // objects, footnote marks, optional hyphens…
    .replace(/ \| \n/g, '\n');
}

export function extractDoc(bytes: Uint8Array): string {
  const cfb = new CompoundFile(bytes);
  const word = cfb.stream('WordDocument');
  if (!word || word.length < 0x200) throw new Error('Not a Word 97–2003 document');
  const w = view(word);
  if (w.getUint16(0, true) !== 0xa5ec) throw new Error('Not a Word 97–2003 document');
  const flags = w.getUint16(0x0a, true);
  if (flags & 0x0100) throw new Error('Encrypted Word document');

  // FIB: FibBase (32 bytes), then FibRgW, FibRgLw and FibRgFcLcb, each prefixed by its count
  const cswEnd = 32 + 2 + w.getUint16(32, true) * 2;
  const lwStart = cswEnd + 2;
  const ccpText = w.getInt32(lwStart + 3 * 4, true);
  const ccpFtn = w.getInt32(lwStart + 4 * 4, true);
  const fcLcbStart = lwStart + w.getUint16(cswEnd, true) * 4 + 2;
  const fcClx = w.getUint32(fcLcbStart + 33 * 8, true);
  const lcbClx = w.getUint32(fcLcbStart + 33 * 8 + 4, true);

  const table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table || fcClx + lcbClx > table.length) throw new Error('Word table stream missing');
  const t = view(table);

  // Clx: skip Prc entries (0x01) to the piece table (0x02)
  let pos = fcClx;
  while (pos < fcClx + lcbClx && table[pos] === 0x01) pos += 3 + t.getInt16(pos + 1, true);
  if (table[pos] !== 0x02) throw new Error('Word piece table missing');
  const lcb = t.getUint32(pos + 1, true);
  const plc = pos + 5;
  const pieces = Math.floor((lcb - 4) / 12);

  let text = '';
  const wanted = ccpText + Math.max(ccpFtn, 0);
  for (let i = 0; i < pieces && text.length < wanted; i++) {
    const cpStart = t.getUint32(plc + i * 4, true);
    const cpEnd = t.getUint32(plc + (i + 1) * 4, true);
    const fc = t.getUint32(plc + (pieces + 1) * 4 + i * 8 + 2, true);
    const count = cpEnd - cpStart;
    if (fc & 0x40000000) {
      const start = (fc & 0x3fffffff) / 2;
      for (let k = 0; k < count && start + k < word.length; k++) text += cp1252(word[start + k]!);
    } else {
      for (let k = 0; k < count && fc + k * 2 + 1 < word.length; k++) {
        text += String.fromCharCode(w.getUint16(fc + k * 2, true));
      }
    }
  }

  let result = cleanWordText(text.slice(0, ccpText));
  if (ccpFtn > 0) {
    const footnotes = cleanWordText(text.slice(ccpText, ccpText + ccpFtn)).trim();
    if (footnotes) result += `\n\nFootnotes\n\n${footnotes}`;
  }
  return tidy(result);
}

// ─── Excel 97–2003 (MS-XLS, BIFF8) ───────────────────────────────────────────

interface BiffRecord {
  type: number;
  data: Uint8Array;
  /** Offset of the record header in the stream. */
  offset: number;
}

function* records(stream: Uint8Array, start = 0): Generator<BiffRecord> {
  const v = view(stream);
  for (let off = start; off + 4 <= stream.length; ) {
    const type = v.getUint16(off, true);
    const length = v.getUint16(off + 2, true);
    yield { type, data: stream.subarray(off + 4, off + 4 + length), offset: off };
    off += 4 + length;
  }
}

/** Reads strings that may continue across CONTINUE records (SST, STRING). */
class ChunkReader {
  private chunk = 0;
  private pos = 0;

  constructor(private readonly chunks: Uint8Array[]) {}

  private ensure(): boolean {
    while (this.chunk < this.chunks.length && this.pos >= this.chunks[this.chunk]!.length) {
      this.chunk++;
      this.pos = 0;
    }
    return this.chunk < this.chunks.length;
  }

  u8(): number {
    if (!this.ensure()) throw new Error('Unexpected end of string data');
    return this.chunks[this.chunk]![this.pos++]!;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(n: number): void {
    for (let i = 0; i < n; i++) this.u8();
  }

  /** An XLUnicodeRichExtendedString; a continuation restarts with its own flags byte. */
  string(): string {
    const cch = this.u16();
    const flags = this.u8();
    let high = flags & 0x01;
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    let out = '';
    for (let i = 0; i < cch; i++) {
      if (
        this.pos >= (this.chunks[this.chunk]?.length ?? 0) &&
        this.chunk + 1 < this.chunks.length
      ) {
        this.chunk++;
        this.pos = 0;
        high = this.u8() & 0x01;
      }
      out += String.fromCharCode(high ? this.u16() : this.u8());
    }
    this.skip(runs * 4 + ext);
    return out;
  }
}

/** XLUnicodeString inside one record: cch, flags, characters. */
function shortString(data: Uint8Array, off: number, cchBytes: 1 | 2): string {
  const v = view(data);
  const cch = cchBytes === 1 ? data[off]! : v.getUint16(off, true);
  const high = data[off + cchBytes]! & 0x01;
  let out = '';
  for (let i = 0, p = off + cchBytes + 1; i < cch && p < data.length; i++) {
    out += String.fromCharCode(high ? v.getUint16(p, true) : data[p]!);
    p += high ? 2 : 1;
  }
  return out;
}

function decodeRk(rk: number): number {
  let value: number;
  if (rk & 0x02) {
    value = rk >> 2; // 30-bit signed integer
  } else {
    const v = new DataView(new ArrayBuffer(8));
    v.setUint32(4, rk & 0xfffffffc, true);
    value = v.getFloat64(0, true);
  }
  return rk & 0x01 ? value / 100 : value;
}

export function extractXls(bytes: Uint8Array): string {
  const cfb = new CompoundFile(bytes);
  const stream = cfb.stream('Workbook');
  if (!stream) {
    if (cfb.stream('Book')) throw new Error('Excel 5/95 workbooks are not supported');
    throw new Error('Not an Excel 97–2003 workbook');
  }

  // Workbook globals: date system, number formats, cell styles, sheets and shared strings
  let date1904 = false;
  const formats = new Map<number, string>();
  const xfFormats: number[] = [];
  const sheets: { name: string; offset: number }[] = [];
  let shared: string[] = [];
  const all = [...records(stream)];
  for (let i = 0; i < all.length; i++) {
    const { type, data } = all[i]!;
    const v = view(data);
    if (type === 0x2f) throw new Error('Encrypted Excel workbook'); // FILEPASS
    if (type === 0x22 && data.length >= 2) date1904 = v.getUint16(0, true) === 1;
    else if (type === 0x41e && data.length >= 5)
      formats.set(v.getUint16(0, true), shortString(data, 2, 2));
    else if (type === 0xe0 && data.length >= 4) xfFormats.push(v.getUint16(2, true));
    else if (type === 0x85 && data.length >= 8 && data[5] === 0) {
      sheets.push({ offset: v.getUint32(0, true), name: shortString(data, 6, 1) });
    } else if (type === 0xfc) {
      const chunks = [data];
      while (all[i + 1]?.type === 0x3c) chunks.push(all[++i]!.data);
      const reader = new ChunkReader(chunks);
      reader.skip(4);
      const count = reader.u32();
      shared = [];
      try {
        for (let n = 0; n < count; n++) shared.push(reader.string());
      } catch {
        // Truncated table: keep the strings read so far
      }
    } else if (type === 0x0a) break; // EOF of the globals
  }

  const isDate = (xf: number) => {
    const fmt = xfFormats[xf];
    return fmt !== undefined && isDateFormat(fmt, formats.get(fmt));
  };
  const number = (value: number, xf: number) =>
    isDate(xf) ? formatExcelDate(value, date1904) : String(value);

  const sections: string[] = [];
  for (const sheet of sheets) {
    const rows = new Map<number, string[]>();
    const set = (row: number, col: number, value: string) => {
      const cells = rows.get(row) ?? [];
      cells[col] = value.replace(/\s+/g, ' ').trim();
      rows.set(row, cells);
    };
    let pendingFormula: { row: number; col: number } | null = null;

    for (const { type, data } of records(stream, sheet.offset)) {
      if (type === 0x0a) break; // EOF of this sheet
      if (type === 0x207) {
        // STRING: the text result of the preceding formula
        if (pendingFormula) set(pendingFormula.row, pendingFormula.col, shortString(data, 0, 2));
        pendingFormula = null;
        continue;
      }
      if (data.length < 6) continue;
      const v = view(data);
      const row = v.getUint16(0, true);
      const col = v.getUint16(2, true);
      const xf = v.getUint16(4, true);
      switch (type) {
        case 0xfd: // LABELSST
          if (data.length >= 10) set(row, col, shared[v.getUint32(6, true)] ?? '');
          break;
        case 0x204: // LABEL
          set(row, col, shortString(data, 6, 2));
          break;
        case 0x203: // NUMBER
          if (data.length >= 14) set(row, col, number(v.getFloat64(6, true), xf));
          break;
        case 0x27e: // RK
          if (data.length >= 10) set(row, col, number(decodeRk(v.getUint32(6, true)), xf));
          break;
        case 0xbd: {
          // MULRK: several RK cells in one row
          const count = (data.length - 6) / 6;
          for (let k = 0; k < count; k++) {
            const off = 4 + k * 6;
            set(row, col + k, number(decodeRk(v.getUint32(off + 2, true)), v.getUint16(off, true)));
          }
          break;
        }
        case 0x205: // BOOLERR
          if (data.length >= 8 && data[7] === 0) set(row, col, data[6] ? 'TRUE' : 'FALSE');
          break;
        case 0x06: {
          // FORMULA: the cached result
          if (data.length < 14) break;
          if (v.getUint16(12, true) !== 0xffff) set(row, col, number(v.getFloat64(6, true), xf));
          else if (data[6] === 0)
            pendingFormula = { row, col }; // text follows in STRING
          else if (data[6] === 1) set(row, col, data[8] ? 'TRUE' : 'FALSE');
          break;
        }
      }
    }

    const lines = [...rows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, cells]) => {
        const filled = Array.from(cells, (c) => c ?? '');
        while (filled.length && !filled[filled.length - 1]) filled.pop();
        return filled.join(' | ');
      })
      .filter(Boolean);
    if (lines.length) sections.push(`Sheet: ${sheet.name}\n\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}
