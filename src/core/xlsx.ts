import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * Minimal, dependency-light XLSX reader/writer (Office Open XML SpreadsheetML).
 * Supports shared strings, inline strings, numbers, booleans and date-formatted cells.
 */

export interface Sheet {
  name: string;
  rows: string[][];
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function byTag(root: Document | Element, tag: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', tag));
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function excelSerialToISO(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial * 86400000));
  return d.toISOString().slice(0, 10);
}

function textOf(el: Element): string {
  // Concatenate all <t> descendants, skipping phonetic runs (<rPh>).
  return byTag(el, 't')
    .filter((t) => t.parentElement?.localName !== 'rPh')
    .map((t) => t.textContent ?? '')
    .join('');
}

export function readXlsx(data: ArrayBuffer | Uint8Array): Sheet[] {
  const files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  const get = (path: string) => (files[path] ? strFromU8(files[path]) : undefined);

  const shared: string[] = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) for (const si of byTag(parseXml(sst), 'si')) shared.push(textOf(si));

  const dateStyles = new Set<number>();
  const styles = get('xl/styles.xml');
  if (styles) {
    const doc = parseXml(styles);
    const custom = new Map<number, string>();
    for (const nf of byTag(doc, 'numFmt')) custom.set(Number(nf.getAttribute('numFmtId')), nf.getAttribute('formatCode') ?? '');
    const cellXfs = byTag(doc, 'cellXfs')[0];
    if (cellXfs) {
      Array.from(cellXfs.children).forEach((xf, idx) => {
        const id = Number(xf.getAttribute('numFmtId') ?? 0);
        const code = custom.get(id);
        const cleaned = code?.replace(/"[^"]*"|\[[^\]]*\]/g, '') ?? '';
        if (BUILTIN_DATE_FORMATS.has(id) || (code && /[dy]/i.test(cleaned) && !/^[#0.,%]+$/.test(cleaned))) dateStyles.add(idx);
      });
    }
  }

  const wb = parseXml(get('xl/workbook.xml') ?? '<workbook/>');
  const rels = parseXml(get('xl/_rels/workbook.xml.rels') ?? '<Relationships/>');
  const relMap = new Map<string, string>();
  for (const r of byTag(rels, 'Relationship')) relMap.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');

  const sheets: Sheet[] = [];
  const sheetEls = byTag(wb, 'sheet');
  sheetEls.forEach((s, i) => {
    const rid = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '';
    let target = relMap.get(rid) ?? `worksheets/sheet${i + 1}.xml`;
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const xml = get(`xl/${target}`);
    if (!xml) return;
    const doc = parseXml(xml);
    const rows: string[][] = [];
    for (const rowEl of byTag(doc, 'row')) {
      const rIdx = Number(rowEl.getAttribute('r') ?? rows.length + 1) - 1;
      const row: string[] = [];
      let nextCol = 0;
      for (const c of Array.from(rowEl.children).filter((e) => e.localName === 'c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? colIndex(ref) : nextCol;
        nextCol = ci + 1;
        const t = c.getAttribute('t');
        const style = Number(c.getAttribute('s') ?? -1);
        const v = byTag(c, 'v')[0]?.textContent ?? '';
        let value = '';
        if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') value = textOf(c);
        else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'str' || t === 'e') value = v;
        else if (v !== '') {
          const num = Number(v);
          value = dateStyles.has(style) && !isNaN(num) ? excelSerialToISO(num) : v;
        }
        row[ci] = value;
      }
      for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = '';
      rows[rIdx] = row;
    }
    const dense = Array.from(rows, (r) => r ?? []).filter((r) => r.some((c) => String(c).trim() !== ''));
    sheets.push({ name: s.getAttribute('name') ?? `Sheet${i + 1}`, rows: dense });
  });
  return sheets;
}

function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function writeXlsx(sheets: { name: string; rows: unknown[][] }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const sheetEntries = sheets.map((s, i) => ({ ...s, idx: i + 1, safeName: esc(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`) }));
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries
      .map((s) => `<Override PartName="/xl/worksheets/sheet${s.idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries
      .map((s) => `<sheet name="${s.safeName}" sheetId="${s.idx}" r:id="rId${s.idx}"/>`)
      .join('')}</sheets></workbook>`,
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries
      .map((s) => `<Relationship Id="rId${s.idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.idx}.xml"/>`)
      .join('')}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
  );
  for (const s of sheetEntries) {
    const rowsXml = s.rows
      .map((row, ri) => {
        const cells = row
          .map((v, ci) => {
            if (v === undefined || v === null || v === '') return '';
            const ref = `${colName(ci)}${ri + 1}`;
            const style = ri === 0 ? ' s="1"' : '';
            if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
            if (typeof v === 'boolean') return `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`;
            return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
          })
          .join('');
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join('');
    files[`xl/worksheets/sheet${s.idx}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rowsXml}</sheetData></worksheet>`,
    );
  }
  return zipSync(files, { level: 6 });
}
