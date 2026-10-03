import type { TextEl } from '../core/types';
import { fontStack } from './fonts';

/** 1 typographic point in millimetres. */
export const PT = 0.3528;

export interface FontSpec {
  stack: string;
  weight: number;
  italic: boolean;
}

/** Returns the advance width (in px) of `text` set at 100px in the given font. */
export type MeasureFn = (text: string, font: FontSpec) => number;

let canvasCtx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

export const browserMeasure: MeasureFn = (text, font) => {
  const key = `${font.stack}|${font.weight}|${font.italic}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (canvasCtx === undefined) {
    try {
      canvasCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    } catch {
      canvasCtx = null;
    }
  }
  let w: number;
  if (canvasCtx) {
    canvasCtx.font = `${font.italic ? 'italic ' : ''}${font.weight} 100px ${font.stack}`;
    w = canvasCtx.measureText(text).width;
  } else {
    w = approxMeasure(text, font);
  }
  if (cache.size > 20000) cache.clear();
  cache.set(key, w);
  return w;
};

/** Font-independent approximation used in tests / non-browser environments. */
export const approxMeasure: MeasureFn = (text, font) => {
  let w = 0;
  for (const ch of text) w += ch === ' ' ? 26 : /[ilj.,'|!:;]/.test(ch) ? 24 : /[mwMW]/.test(ch) ? 80 : /[A-Z]/.test(ch) ? 64 : 50;
  return w * (font.weight >= 600 ? 1.06 : 1);
};

export function clearMeasureCache() {
  cache.clear();
}

export interface Run {
  x: number;
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface LaidLine {
  /** Baseline y (mm, relative to element top). */
  y: number;
  runs: Run[];
  width: number;
}

export interface TextLayoutResult {
  lines: LaidLine[];
  fontSize: number;
  lineAdvance: number;
  height: number;
  overflow: boolean;
  dropCap?: { char: string; x: number; y: number; size: number };
}

interface Seg {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Parses **bold** and *italic* markers into styled segments. */
export function parseInline(s: string): Seg[] {
  const out: Seg[] = [];
  let bold = false;
  let italic = false;
  let buf = '';
  const flush = () => {
    if (buf) out.push({ text: buf, bold, italic });
    buf = '';
  };
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '*' && s[i + 1] === '*') {
      flush();
      bold = !bold;
      i++;
      continue;
    }
    if (s[i] === '*') {
      flush();
      italic = !italic;
      continue;
    }
    buf += s[i];
  }
  flush();
  return out;
}

type Word = Seg[];

function splitWords(segs: Seg[]): Word[] {
  const words: Word[] = [];
  let cur: Word = [];
  for (const seg of segs) {
    const parts = seg.text.split(/(\s+)/);
    for (const p of parts) {
      if (p === '') continue;
      if (/^\s+$/.test(p)) {
        if (cur.length) words.push(cur);
        cur = [];
      } else cur.push({ ...seg, text: p });
    }
  }
  if (cur.length) words.push(cur);
  return words;
}

export function applyTransform(text: string, t: TextEl['transform']): string {
  if (t === 'uppercase') return text.toLocaleUpperCase();
  if (t === 'lowercase') return text.toLocaleLowerCase();
  return text;
}

export function layoutText(el: TextEl, rawText: string, measure: MeasureFn = browserMeasure, scale = 1): TextLayoutResult {
  const text = applyTransform(rawText, el.transform);
  const stack = fontStack(el.font);
  const size = el.size * PT * scale;
  const ls = (el.letterSpacing ?? 0) * size;
  const lineAdvance = size * (el.lineHeight || 1.3);
  const paraSpacing = (el.paragraphSpacing ?? 0) * size;
  const spec = (s: Seg): FontSpec => ({ stack, weight: s.bold ? 700 : el.weight, italic: !!(s.italic !== !!el.italic) });
  const segWidth = (s: Seg) => (measure(s.text, spec(s)) * size) / 100 + ls * Array.from(s.text).length;
  const wordWidth = (w: Word) => w.reduce((a, s) => a + segWidth(s), 0);
  const spaceWidth = (measure(' ', { stack, weight: el.weight, italic: !!el.italic }) * size) / 100 + ls;

  const paragraphs = text.split('\n');
  const lines: LaidLine[] = [];
  let overflow = false;
  let y = 0;
  let dropCap: TextLayoutResult['dropCap'];
  let indentLines = 0;
  let indent = 0;

  paragraphs.forEach((para, pIdx) => {
    let segs = parseInline(para);
    if (el.dropCap && pIdx === paragraphs.findIndex((p) => p.trim()) && !dropCap) {
      const first = segs.find((s) => s.text.trim());
      if (first) {
        const trimmed = first.text.replace(/^\s+/, '');
        const ch = Array.from(trimmed)[0];
        if (ch) {
          first.text = trimmed.slice(ch.length);
          const dropSize = lineAdvance * 2 + size * 0.72;
          const capSize = dropSize / 0.72;
          const w = (measure(ch, { stack, weight: el.weight, italic: false }) * capSize) / 100;
          indent = w + size * 0.35;
          indentLines = 3;
          dropCap = { char: ch, x: 0, y: y + lineAdvance * 2 + size * 0.85, size: capSize };
          segs = segs.filter((s) => s.text !== '');
        }
      }
    }
    const words = splitWords(segs);
    if (!words.length) {
      y += lineAdvance;
      return;
    }
    let lineWords: { w: Word; width: number }[] = [];
    let lineWidth = 0;
    const flush = (last: boolean) => {
      const lineIdx = lines.length;
      const avail = el.w - (lineIdx < indentLines ? indent : 0);
      const offset = lineIdx < indentLines ? indent : 0;
      const natural = lineWords.reduce((a, x) => a + x.width, 0) + spaceWidth * Math.max(0, lineWords.length - 1);
      let gap = spaceWidth;
      let x0 = offset;
      const align = el.align;
      if (align === 'justify' && !last && lineWords.length > 1) gap = spaceWidth + (avail - natural) / (lineWords.length - 1);
      else if (align === 'center') x0 = offset + (avail - natural) / 2;
      else if (align === 'right') x0 = offset + avail - natural;
      if (natural > avail + 0.01) overflow = true;
      const runs: Run[] = [];
      let x = x0;
      for (const lw of lineWords) {
        let sx = x;
        for (const s of lw.w) {
          runs.push({ x: sx, text: s.text, bold: s.bold, italic: s.italic });
          sx += segWidth(s);
        }
        x += lw.width + gap;
      }
      const baseline = y + (lineAdvance - size) / 2 + size * 0.8;
      lines.push({ y: baseline, runs, width: natural });
      y += lineAdvance;
      lineWords = [];
      lineWidth = 0;
    };
    for (const w of words) {
      let width = wordWidth(w);
      const lineIdx = lines.length;
      const avail = el.w - (lineIdx < indentLines ? indent : 0);
      if (width > avail && w.length === 1) {
        // Hard-break very long words (URLs, codes).
        if (lineWords.length) flush(false);
        const chars = Array.from(w[0].text);
        let chunk = '';
        for (const ch of chars) {
          const test = { ...w[0], text: chunk + ch };
          if (segWidth(test) > el.w - (lines.length < indentLines ? indent : 0) && chunk) {
            lineWords = [{ w: [{ ...w[0], text: chunk }], width: segWidth({ ...w[0], text: chunk }) }];
            flush(false);
            chunk = ch;
          } else chunk += ch;
        }
        width = segWidth({ ...w[0], text: chunk });
        lineWords = [{ w: [{ ...w[0], text: chunk }], width }];
        lineWidth = width;
        continue;
      }
      const needed = lineWidth + (lineWords.length ? spaceWidth : 0) + width;
      if (needed > avail && lineWords.length) {
        flush(false);
      }
      lineWords.push({ w, width });
      lineWidth += (lineWords.length > 1 ? spaceWidth : 0) + width;
    }
    if (lineWords.length) flush(true);
    y += paraSpacing;
  });
  if (dropCap && lines.length < indentLines) y = Math.max(y, dropCap.y + size * 0.3);
  const height = y - paraSpacing;
  if (height > el.h + 0.5) overflow = true;
  return { lines, fontSize: size, lineAdvance, height, overflow, dropCap };
}

/** Lays out text, shrinking the font (down to 40%) when `autoFit` is on and it overflows. */
export function layoutTextFit(el: TextEl, rawText: string, measure: MeasureFn = browserMeasure): TextLayoutResult {
  let res = layoutText(el, rawText, measure);
  if (!el.autoFit || !res.overflow) return res;
  let lo = 0.4;
  let hi = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const r = layoutText(el, rawText, measure, mid);
    if (r.overflow) hi = mid;
    else {
      lo = mid;
      res = r;
    }
  }
  if (res.overflow) res = layoutText(el, rawText, measure, lo);
  return res;
}
