import { describe, expect, it } from 'vitest';
import { defaultPrintSettings, fitsEnvelope, foldedSize } from '../src/core/defaults';
import type { TextEl } from '../src/core/types';
import { code128B, CODE128_PATTERNS } from '../src/render/barcode';
import { dielineGeometry } from '../src/render/envelope';
import { imposeSection, type PrintItem } from '../src/render/imposition';
import { approxMeasure, layoutText, layoutTextFit, parseInline } from '../src/render/textLayout';

const el = (p: Partial<TextEl> = {}): TextEl => ({ id: 't', type: 'text', x: 0, y: 0, w: 60, h: 40, text: '', font: 'garamond', size: 12, weight: 400, color: '#000', align: 'left', lineHeight: 1.3, ...p });

describe('text layout', () => {
  it('parses inline emphasis', () => {
    expect(parseInline('a **b** *c*')).toEqual([
      { text: 'a ', bold: false, italic: false },
      { text: 'b', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'c', bold: false, italic: true },
    ]);
  });
  it('wraps words within the box and justifies inner lines', () => {
    const text = 'The owls in the tower have been practising a birthday song since dawn and they are not very good at it.';
    const res = layoutText(el({ align: 'justify' }), text, approxMeasure);
    expect(res.lines.length).toBeGreaterThan(2);
    for (const line of res.lines.slice(0, -1)) {
      const last = line.runs[line.runs.length - 1];
      expect(last.x).toBeLessThanOrEqual(60);
    }
    expect(res.overflow).toBe(false);
  });
  it('detects overflow and shrinks with autoFit', () => {
    const long = Array.from({ length: 80 }, () => 'magic').join(' ');
    expect(layoutText(el({ h: 10 }), long, approxMeasure).overflow).toBe(true);
    const fit = layoutTextFit(el({ h: 30, autoFit: true }), Array.from({ length: 30 }, () => 'magic').join(' '), approxMeasure);
    expect(fit.overflow).toBe(false);
    expect(fit.fontSize).toBeLessThan(12 * 0.3528);
  });
  it('indents the first lines for a drop cap', () => {
    const res = layoutText(el({ dropCap: true }), 'Once upon a time there was an owl who carried letters across the moonlit sky every night.', approxMeasure);
    expect(res.dropCap?.char).toBe('O');
    expect(res.lines[0].runs[0].x).toBeGreaterThan(0);
  });
});

describe('barcode', () => {
  it('uses valid Code 128 module widths', () => {
    CODE128_PATTERNS.slice(0, 106).forEach((p) => expect(p.split('').reduce((a, b) => a + Number(b), 0)).toBe(11));
    const modules = code128B('OWL123');
    // start + 6 chars + checksum = 8 symbols × 6 elements + stop (7)
    expect(modules).toHaveLength(8 * 6 + 7);
  });
});

describe('envelopes & folding', () => {
  it('checks letter fit for common envelope sizes', () => {
    expect(fitsEnvelope(foldedSize(210, 297, 'trifold'), [220, 110])).toBe(true);
    expect(fitsEnvelope(foldedSize(210, 297, 'half'), [229, 162])).toBe(true);
    expect(fitsEnvelope(foldedSize(210, 297, 'none'), [229, 162])).toBe(false);
  });
  it('computes a die-cut template bigger than the envelope', () => {
    const g = dielineGeometry(162, 114);
    expect(g.W).toBeGreaterThan(162);
    expect(g.H).toBeGreaterThan(114 * 2);
  });
});

describe('imposition', () => {
  const items = (n: number, w: number, h: number): PrintItem[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, label: '', w, h, render: () => null as unknown as JSX.Element }));
  it('fits multiple small cards per sheet', () => {
    const s = { ...defaultPrintSettings(), cropMarks: false, cutLines: true, margins: 5 };
    const pages = imposeSection({ key: 'cards', title: '', mode: 'grid', items: items(12, 85.6, 54) }, s);
    expect(pages[0].placements.length).toBeGreaterThanOrEqual(8);
    expect(pages.reduce((a, p) => a + p.placements.length, 0)).toBe(12);
  });
  it('places full-size letters one per page', () => {
    const pages = imposeSection({ key: 'letters', title: '', mode: 'grid', items: items(3, 210, 297) }, defaultPrintSettings());
    expect(pages).toHaveLength(3);
    expect(pages[0].w).toBe(210);
  });
  it('lays out address labels on a label preset', () => {
    const s = { ...defaultPrintSettings(), labelPreset: 'L7163' as const };
    const pages = imposeSection({ key: 'labels', title: '', mode: 'labels', items: items(20, 99.1, 38.1) }, s);
    expect(pages).toHaveLength(2);
    expect(pages[0].placements).toHaveLength(14);
  });
  it('gives each envelope its own page in direct mode', () => {
    const pages = imposeSection({ key: 'env', title: '', mode: 'direct', items: items(2, 220, 110) }, defaultPrintSettings());
    expect(pages.map((p) => [p.w, p.h])).toEqual([
      [220, 110],
      [220, 110],
    ]);
  });
});
