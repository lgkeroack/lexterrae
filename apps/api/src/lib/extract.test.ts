import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { decodeXml, extractDocx, extractRtf, extractXlsx, rtfToText } from './extract.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

describe('extractDocx', () => {
  it('keeps paragraphs, tabs, tables and footnotes, and drops deleted text', () => {
    const body = `<w:document ${W}><w:body>
      <w:p><w:r><w:t>Section 1.</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">Definitions &amp; terms</w:t></w:r></w:p>
      <w:p><w:r><w:delText>old words</w:delText><w:t>"Lot" means a parcel.</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Zone</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Height</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>R-1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>9 m</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const footnotes = `<w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>Amended 2024.</w:t></w:r></w:p></w:footnote></w:footnotes>`;
    const docx = zipSync({
      'word/document.xml': strToU8(body),
      'word/footnotes.xml': strToU8(footnotes),
      'word/styles.xml': strToU8('<ignored/>'),
    });
    expect(extractDocx(docx)).toBe(
      'Section 1.\tDefinitions & terms\n\n"Lot" means a parcel.\n\nZone | Height\nR-1 | 9 m\n\nFootnotes\n\nAmended 2024.',
    );
  });

  it('rejects archives that are not Word documents', () => {
    expect(() => extractDocx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/Not a Word/);
  });
});

describe('extractXlsx', () => {
  it('reads every sheet with shared, inline, numeric and boolean cells in column order', () => {
    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Fees &amp; Fines" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>Permit</t></si><si><r><t>Fee </t></r><r><t>($)</t></r></si></sst>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>Building</t></is></c><c r="B2" t="b"><v>1</v></c><c r="C2"><v>250.5</v></c></row>' +
          '<row r="3"><c r="A3"/></row></sheetData></worksheet>',
      ),
      'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData/></worksheet>'),
    });
    expect(extractXlsx(xlsx)).toBe(
      'Sheet: Fees & Fines\n\nPermit |  | Fee ($)\nBuilding | TRUE | 250.5',
    );
  });
});

describe('RTF', () => {
  it('extracts text, escapes and Unicode, and skips tables of fonts and colours', () => {
    const rtf =
      '{\\rtf1\\ansi\\uc1{\\fonttbl{\\f0 Times;}}{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Word;}' +
      "\\pard Section 2.\\tab Fees\\par Caf\\'e9 \\u8212? curly \\ldblquote quotes\\rdblquote  and \\{braces\\}\\par" +
      '{\\header Page header}Last line.}';
    expect(rtfToText(rtf)).toBe(
      'Section 2.\tFees\n\nCafé — curly “quotes” and {braces}\n\nLast line.',
    );
    expect(extractRtf(strToU8(rtf))).toContain('Café');
    expect(() => extractRtf(strToU8('plain text'))).toThrow(/Not an RTF/);
    // A \u inside a skipped group must not swallow the next visible character
    expect(rtfToText('{\\rtf1{\\*\\userprops \\u8212?}Squamish}')).toBe('Squamish');
  });
});

describe('decodeXml', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXml('a &lt;b&gt; &#233;&#x2014; &unknown;')).toBe('a <b> é— &unknown;');
  });
});
