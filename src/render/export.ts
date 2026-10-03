import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { zipSync } from 'fflate';
import { downloadBlob, safeFileName } from '../core/util';
import { embeddedFontCSS, ensureFontsLoaded } from './fonts';
import { PageSVG, type PrintPage } from './imposition';

/** Serialises an SVG React element to a standalone SVG document with fonts embedded. */
export async function svgMarkup(el: ReactElement, opts: { embedFonts?: boolean } = {}): Promise<string> {
  await ensureFontsLoaded();
  let svg = renderToStaticMarkup(el);
  if (!svg.startsWith('<svg')) svg = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  if (!/xmlns=/.test(svg.slice(0, 200))) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/xmlns:xlink=/.test(svg.slice(0, 300))) svg = svg.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  if (opts.embedFonts !== false) {
    const css = await embeddedFontCSS(svg);
    if (css) svg = svg.replace(/^<svg([^>]*)>/, `<svg$1><defs><style>${css}</style></defs>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
}

export function pageElement(page: PrintPage, uid: string): ReactElement {
  return createElement(PageSVG, { page, uid });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = url;
  });
}

/** Rasterises an SVG document onto a canvas at the given size in pixels. */
export async function rasterize(svg: string, pxW: number, pxH: number, background = '#ffffff'): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(pxW));
    canvas.height = Math.max(1, Math.round(pxH));
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const mmToPx = (mm: number, dpi: number) => (mm / 25.4) * dpi;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), type, quality));
}

export type ExportFormat = 'pdf' | 'png' | 'jpg' | 'svg';

export interface ExportProgress {
  (done: number, total: number): void;
}

/** Renders pages → raster images. */
async function rasterPages(pages: PrintPage[], dpi: number, type: 'image/png' | 'image/jpeg', progress?: ExportProgress) {
  const out: { blob: Blob; pxW: number; pxH: number; page: PrintPage }[] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const svg = await svgMarkup(pageElement(p, `x${i}`));
    const pxW = mmToPx(p.w, dpi);
    const pxH = mmToPx(p.h, dpi);
    const canvas = await rasterize(svg, pxW, pxH, type === 'image/jpeg' ? '#ffffff' : '');
    out.push({ blob: await canvasBlob(canvas, type, 0.92), pxW: canvas.width, pxH: canvas.height, page: p });
    progress?.(i + 1, pages.length);
  }
  return out;
}

// ───────────── Minimal PDF writer (JPEG pages) ─────────────

export async function buildPdf(pages: { jpeg: Uint8Array; pxW: number; pxH: number; wMM: number; hMM: number }[], title = 'Print package'): Promise<Blob> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };
  const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, '?')})`;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // 1 catalog, 2 pages, 3 info, then 3 objects per page (page, content, image).
  const pageObj = (i: number) => 4 + i * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`);
  obj(3, `<< /Title ${pdfString(title)} /Producer (Hogwarts Mail Management System) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`);
  pages.forEach((p, i) => {
    const wPt = (p.wMM / 25.4) * 72;
    const hPt = (p.hMM / 25.4) * 72;
    const po = pageObj(i);
    obj(po, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im${i} ${po + 2} 0 R >> >> /Contents ${po + 1} 0 R >>`);
    const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im${i} Do Q`;
    obj(po + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(po + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const xrefStart = length;
  const total = 4 + n * 3;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

export async function exportPages(pages: PrintPage[], format: ExportFormat, dpi: number, baseName: string, progress?: ExportProgress) {
  const name = safeFileName(baseName);
  if (format === 'pdf') {
    const rasters = await rasterPages(pages, dpi, 'image/jpeg', progress);
    const pdfPages = await Promise.all(
      rasters.map(async (r) => ({ jpeg: new Uint8Array(await r.blob.arrayBuffer()), pxW: r.pxW, pxH: r.pxH, wMM: r.page.w, hMM: r.page.h })),
    );
    downloadBlob(await buildPdf(pdfPages, baseName), `${name}.pdf`);
    return;
  }
  const files: { name: string; data: Uint8Array }[] = [];
  if (format === 'svg') {
    for (let i = 0; i < pages.length; i++) {
      const svg = await svgMarkup(pageElement(pages[i], `x${i}`));
      files.push({ name: `${name}-${String(i + 1).padStart(3, '0')}.svg`, data: new TextEncoder().encode(svg) });
      progress?.(i + 1, pages.length);
    }
  } else {
    const rasters = await rasterPages(pages, dpi, format === 'png' ? 'image/png' : 'image/jpeg', progress);
    for (let i = 0; i < rasters.length; i++)
      files.push({ name: `${name}-${String(i + 1).padStart(3, '0')}.${format}`, data: new Uint8Array(await rasters[i].blob.arrayBuffer()) });
  }
  if (files.length === 1) {
    const mime = format === 'svg' ? 'image/svg+xml' : format === 'png' ? 'image/png' : 'image/jpeg';
    downloadBlob(new Blob([files[0].data as BlobPart], { type: mime }), files[0].name);
    return;
  }
  const zipped = zipSync(Object.fromEntries(files.map((f) => [f.name, f.data])), { level: 0 });
  downloadBlob(new Blob([zipped as BlobPart], { type: 'application/zip' }), `${name}.zip`);
}

/** Exports a single design (letter, stamp, seal …) given as an SVG element of w×h mm. */
export async function exportSingle(el: ReactElement, wMM: number, hMM: number, format: ExportFormat, dpi: number, baseName: string) {
  const name = safeFileName(baseName);
  const svg = await svgMarkup(el);
  if (format === 'svg') {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}.svg`);
    return;
  }
  const canvas = await rasterize(svg, mmToPx(wMM, dpi), mmToPx(hMM, dpi), format === 'png' ? '' : '#ffffff');
  if (format === 'pdf') {
    const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.92);
    const pdf = await buildPdf([{ jpeg: new Uint8Array(await jpeg.arrayBuffer()), pxW: canvas.width, pxH: canvas.height, wMM, hMM }], baseName);
    downloadBlob(pdf, `${name}.pdf`);
    return;
  }
  downloadBlob(await canvasBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92), `${name}.${format}`);
}

/** Thumbnail data URL (PNG) of an SVG element – used for previews and file attachments. */
export async function svgToDataUrl(el: ReactElement, wMM: number, hMM: number, dpi = 60): Promise<string> {
  const svg = await svgMarkup(el);
  const canvas = await rasterize(svg, mmToPx(wMM, dpi), mmToPx(hMM, dpi), '');
  return canvas.toDataURL('image/png');
}

/**
 * Browser printing (vector quality). Pages are rendered into #print-root and the app is hidden
 * by print CSS. All pages in one job must share a page size, so callers print per section.
 */
export async function printPages(pages: PrintPage[]) {
  if (!pages.length) return;
  await ensureFontsLoaded();
  const root = document.getElementById('print-root');
  if (!root) return;
  const { w, h } = pages[0];
  const style = document.createElement('style');
  style.id = 'print-page-size';
  style.textContent = `@page { size: ${w}mm ${h}mm; margin: 0; }`;
  document.getElementById('print-page-size')?.remove();
  document.head.appendChild(style);
  root.innerHTML = pages.map((p, i) => `<div class="print-page" style="width:${p.w}mm;height:${p.h}mm">${renderToStaticMarkup(pageElement(p, `pr${i}`))}</div>`).join('');
  document.body.classList.add('printing');
  await new Promise((r) => setTimeout(r, 250));
  const cleanup = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 60000);
}
