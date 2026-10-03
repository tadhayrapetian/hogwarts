import { emptyLayout, NO_BORDER, NO_WATERMARK, paperStyle } from '../core/defaults';
import type { DesignEl, DesignElType, Layout, TextEl } from '../core/types';
import { uid } from '../core/util';

export const ELEMENT_TYPES: DesignElType[] = ['text', 'image', 'signature', 'seal', 'stamp', 'postmark', 'badge', 'symbol', 'divider', 'shape', 'barcode'];

export function text(partial: Partial<TextEl> & Pick<TextEl, 'x' | 'y' | 'w' | 'h' | 'text'>): TextEl {
  return {
    id: uid(),
    type: 'text',
    font: 'garamond',
    size: 12,
    weight: 400,
    color: '#2b1d10',
    align: 'left',
    lineHeight: 1.35,
    ...partial,
  };
}

/** A new element of `type`, centred on the page with sensible defaults. */
export function newElement(type: DesignElType, layout: Pick<Layout, 'w' | 'h'>): DesignEl {
  const cx = layout.w / 2;
  const cy = layout.h / 2;
  const box = (w: number, h: number) => ({ id: uid(), x: +(cx - w / 2).toFixed(1), y: +(cy - h / 2).toFixed(1), w, h });
  switch (type) {
    case 'text':
      return text({ ...box(Math.min(120, layout.w * 0.7), 20), text: 'Dear {{preferred_name}},' });
    case 'image':
      return { ...box(40, 40), type: 'image', fit: 'contain', filter: 'none' };
    case 'signature':
      return { ...box(60, 26), type: 'signature', characterRef: '$sender', showName: true, showTitle: true };
    case 'seal':
      return { ...box(26, 26), type: 'seal', sealRef: '$project' };
    case 'stamp':
      return { ...box(26, 31), type: 'stamp', stampRef: '$project' };
    case 'postmark':
      return { ...box(30, 30), type: 'postmark', postmarkRef: '$project' };
    case 'badge':
      return { ...box(30, 36), type: 'badge', houseRef: '$school', showName: true };
    case 'symbol':
      return { ...box(16, 16), type: 'symbol', symbol: 'owl', color: '#6b4a2b', strokeWidth: 1.5 };
    case 'divider':
      return { ...box(Math.min(100, layout.w * 0.6), 6), type: 'divider', style: 'ornament', color: '#8a6a35', thickness: 0.4 };
    case 'shape':
      return { ...box(60, 30), type: 'shape', shape: 'rect', fill: '', stroke: '#8a6a35', strokeWidth: 0.5 };
    case 'barcode':
      return { ...box(50, 12), type: 'barcode', value: '{{tracking_number}}', showText: true, color: '#111111' };
  }
}

/** Address label layout (address, return line, optional tracking barcode). */
export function addressLabelLayout(w: number, h: number, opts: { returnLine?: string; barcode?: boolean } = {}): Layout {
  const pad = 3;
  const els: DesignEl[] = [];
  const hasReturn = !!opts.returnLine;
  if (hasReturn)
    els.push(text({ x: pad, y: pad, w: w - pad * 2, h: 3.2, text: opts.returnLine!.split('\n')[0], size: 5.5, font: 'inter', color: '#555' }));
  const barH = opts.barcode ? Math.min(9, h * 0.22) : 0;
  els.push(
    text({
      x: pad + 1,
      y: pad + (hasReturn ? 4 : 0.5),
      w: w - pad * 2 - 1,
      h: h - pad * 2 - (hasReturn ? 4 : 0) - barH,
      text: '{{address_block}}',
      size: Math.min(10, Math.max(6.5, h / 5)),
      font: 'inter',
      weight: 500,
      lineHeight: 1.2,
      autoFit: true,
      color: '#111',
    }),
  );
  if (opts.barcode) els.push({ id: uid(), type: 'barcode', x: w - pad - Math.min(46, w * 0.55), y: h - pad - barH, w: Math.min(46, w * 0.55), h: barH, value: '{{tracking_number}}', showText: true, color: '#111' });
  return { ...emptyLayout(w, h, 'white'), paper: paperStyle('white'), border: { ...NO_BORDER }, watermark: { ...NO_WATERMARK }, margins: { top: pad, right: pad, bottom: pad, left: pad }, elements: els };
}

/** Packing slip: what goes into the envelope plus a tick list for the assembler. */
export function packingSlipLayout(lines: { title: string; order: string; project: string; contents: string[]; notes: string }): Layout {
  const w = 105;
  const h = 148;
  const els: DesignEl[] = [
    text({ x: 8, y: 8, w: 89, h: 8, text: 'PACKING SLIP', font: 'cinzel', size: 13, weight: 700, color: '#5b1f1a' }),
    text({ x: 8, y: 17, w: 89, h: 12, text: `${lines.order}\n${lines.project}`, font: 'inter', size: 7.5, color: '#444', lineHeight: 1.3 }),
    { id: uid(), type: 'divider', x: 8, y: 29, w: 89, h: 3, style: 'line', color: '#b08d57', thickness: 0.3 },
    text({ x: 8, y: 33, w: 89, h: 26, text: `**{{full_name}}**\n{{address_block}}`, font: 'inter', size: 8, lineHeight: 1.3, autoFit: true }),
    { id: uid(), type: 'divider', x: 8, y: 60, w: 89, h: 3, style: 'line', color: '#b08d57', thickness: 0.3 },
    text({ x: 8, y: 64, w: 89, h: 58, text: lines.contents.map((c) => `☐  ${c}`).join('\n'), font: 'inter', size: 8.5, lineHeight: 1.55, autoFit: true }),
    text({ x: 8, y: 124, w: 89, h: 16, text: lines.notes, font: 'inter', size: 7, italic: true, color: '#666', autoFit: true }),
  ];
  return { ...emptyLayout(w, h, 'white'), paper: paperStyle('white'), elements: els };
}
