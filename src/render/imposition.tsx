import { LABEL_PRESET_SPECS, PAPER_DIMENSIONS } from '../core/defaults';
import type { FoldStyle, PrintSettings } from '../core/types';

/** A printable item in its own millimetre coordinate system (0..w, 0..h). */
export interface PrintItem {
  id: string;
  label: string;
  w: number;
  h: number;
  fold?: FoldStyle;
  /** Paper colour used to extend the background into the bleed. */
  bleedColor?: string;
  render: (uid: string) => JSX.Element;
}

export type SectionMode = 'grid' | 'direct' | 'labels';

export interface PrintSection {
  key: string;
  title: string;
  mode: SectionMode;
  items: PrintItem[];
}

export interface Placement {
  item: PrintItem;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface PrintPage {
  section: string;
  title: string;
  w: number;
  h: number;
  placements: Placement[];
  /** Placements may carry crop marks only when there is room between items. */
  marks: { crop: boolean; cut: boolean; fold: boolean; safe: boolean; bleed: number };
}

export function paperSize(s: PrintSettings): [number, number] {
  if (s.paper === 'custom') return [s.paperW, s.paperH];
  return PAPER_DIMENSIONS[s.paper];
}

function gridFit(pw: number, ph: number, margin: number, iw: number, ih: number, gap: number) {
  const uw = pw - margin * 2;
  const uh = ph - margin * 2;
  const cols = Math.floor((uw + gap) / (iw + gap));
  const rows = Math.floor((uh + gap) / (ih + gap));
  return { cols: Math.max(0, cols), rows: Math.max(0, rows), count: Math.max(0, cols) * Math.max(0, rows) };
}

export function imposeSection(section: PrintSection, s: PrintSettings): PrintPage[] {
  const scale = (s.scale || 100) / 100;
  const bleed = s.bleed || 0;
  const marks = { crop: s.cropMarks, cut: s.cutLines, fold: s.foldLines, safe: s.safeArea, bleed };
  const pages: PrintPage[] = [];
  if (!section.items.length) return pages;

  if (section.mode === 'direct') {
    for (const item of section.items) {
      pages.push({
        section: section.key,
        title: section.title,
        w: item.w,
        h: item.h,
        placements: [{ item, x: 0, y: 0, w: item.w, h: item.h, rotated: false }],
        marks: { ...marks, crop: false, cut: false },
      });
    }
    return pages;
  }

  if (section.mode === 'labels') {
    const spec =
      s.labelPreset === 'custom'
        ? { w: s.labelW, h: s.labelH, cols: s.labelCols, rows: s.labelRows, gap: s.labelGap }
        : LABEL_PRESET_SPECS[s.labelPreset];
    const [pw, ph] = paperSize(s);
    const gridW = spec.cols * spec.w + (spec.cols - 1) * spec.gap;
    const gridH = spec.rows * spec.h + (spec.rows - 1) * spec.gap * 0;
    const x0 = (pw - gridW) / 2;
    const y0 = (ph - gridH) / 2;
    const per = spec.cols * spec.rows;
    for (let p = 0; p * per < section.items.length; p++) {
      const placements: Placement[] = section.items.slice(p * per, p * per + per).map((item, i) => {
        const c = i % spec.cols;
        const r = Math.floor(i / spec.cols);
        return { item, x: x0 + c * (spec.w + spec.gap), y: y0 + r * spec.h, w: spec.w, h: spec.h, rotated: false };
      });
      pages.push({ section: section.key, title: section.title, w: pw, h: ph, placements, marks: { ...marks, crop: false, fold: false, bleed: 0 } });
    }
    return pages;
  }

  // Grid mode: group by item size so mixed documents still impose sensibly.
  const groups = new Map<string, PrintItem[]>();
  for (const it of section.items) {
    const key = `${it.w.toFixed(1)}x${it.h.toFixed(1)}`;
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }
  const [bw, bh] = paperSize(s);
  for (const items of groups.values()) {
    const iw0 = items[0].w * scale;
    const ih0 = items[0].h * scale;
    const gap = s.cropMarks ? Math.max(10, bleed * 2 + 6) : s.cutLines ? 2 + bleed * 2 : bleed * 2;
    const orientations: [number, number][] =
      s.orientation === 'portrait' ? [[Math.min(bw, bh), Math.max(bw, bh)]] : s.orientation === 'landscape' ? [[Math.max(bw, bh), Math.min(bw, bh)]] : [
        [Math.min(bw, bh), Math.max(bw, bh)],
        [Math.max(bw, bh), Math.min(bw, bh)],
      ];
    let best: { pw: number; ph: number; iw: number; ih: number; rotated: boolean; cols: number; rows: number } | null = null;
    for (const [pw, ph] of orientations) {
      for (const rotated of [false, true]) {
        const iw = rotated ? ih0 : iw0;
        const ih = rotated ? iw0 : ih0;
        const fit = gridFit(pw, ph, s.margins + bleed, iw, ih, gap);
        if (fit.count > 0 && (!best || fit.count > best.cols * best.rows)) best = { pw, ph, iw, ih, rotated, cols: fit.cols, rows: fit.rows };
      }
    }
    if (!best) {
      // Item does not fit inside the printable area: one per page, centred, scaled down if needed.
      for (const [pw, ph] of orientations.slice(0, 1)) {
        const portraitItem = ih0 >= iw0;
        const [PW, PH] = portraitItem === ph >= pw ? [pw, ph] : [ph, pw];
        const k = Math.min(1, PW / iw0, PH / ih0);
        for (const item of items) {
          const w = iw0 * k;
          const h = ih0 * k;
          pages.push({
            section: section.key,
            title: section.title,
            w: PW,
            h: PH,
            placements: [{ item, x: (PW - w) / 2, y: (PH - h) / 2, w, h, rotated: false }],
            marks: { ...marks, crop: false, cut: w < PW - 1 || h < PH - 1 ? marks.cut : false },
          });
        }
      }
      continue;
    }
    const { pw, ph, iw, ih, cols, rows, rotated } = best;
    const per = cols * rows;
    const gridW = cols * iw + (cols - 1) * gap;
    const gridH = rows * ih + (rows - 1) * gap;
    const x0 = (pw - gridW) / 2;
    const y0 = (ph - gridH) / 2;
    for (let p = 0; p * per < items.length; p++) {
      const placements = items.slice(p * per, p * per + per).map((item, i) => ({
        item,
        x: x0 + (i % cols) * (iw + gap),
        y: y0 + Math.floor(i / cols) * (ih + gap),
        w: iw,
        h: ih,
        rotated,
      }));
      pages.push({ section: section.key, title: section.title, w: pw, h: ph, placements, marks });
    }
  }
  return pages;
}

function foldPositions(fold: FoldStyle | undefined, h: number): number[] {
  if (fold === 'half') return [h / 2];
  if (fold === 'trifold') return [h / 3, (h * 2) / 3];
  return [];
}

function PlacementMarks({ pl, marks }: { pl: Placement; marks: PrintPage['marks'] }) {
  const { x, y, w, h } = pl;
  const len = 4;
  const off = 1.5 + marks.bleed;
  const els: JSX.Element[] = [];
  if (marks.crop) {
    const corners: [number, number, number, number][] = [
      [x, y, -1, -1],
      [x + w, y, 1, -1],
      [x, y + h, -1, 1],
      [x + w, y + h, 1, 1],
    ];
    corners.forEach(([cx, cy, sx, sy], i) => {
      els.push(<line key={`ch${i}`} x1={cx + sx * off} x2={cx + sx * (off + len)} y1={cy} y2={cy} />);
      els.push(<line key={`cv${i}`} x1={cx} x2={cx} y1={cy + sy * off} y2={cy + sy * (off + len)} />);
    });
  }
  if (marks.cut) els.push(<rect key="cut" x={x} y={y} width={w} height={h} fill="none" strokeDasharray="1.5 1" opacity={0.6} />);
  if (marks.fold && pl.item.fold && pl.item.fold !== 'none') {
    const along = pl.rotated ? w : h;
    for (const f of foldPositions(pl.item.fold, along)) {
      if (pl.rotated) {
        els.push(<line key={`f${f}`} x1={x + f} x2={x + f} y1={y} y2={y + h} strokeDasharray="0.6 1.4" opacity={0.35} />);
        els.push(<line key={`ft${f}`} x1={x + f} x2={x + f} y1={y - 5} y2={y - 1.5} />);
      } else {
        els.push(<line key={`f${f}`} x1={x} x2={x + w} y1={y + f} y2={y + f} strokeDasharray="0.6 1.4" opacity={0.35} />);
        els.push(<line key={`fl${f}`} x1={x - 5} x2={x - 1.5} y1={y + f} y2={y + f} />);
        els.push(<line key={`fr${f}`} x1={x + w + 1.5} x2={x + w + 5} y1={y + f} y2={y + f} />);
      }
    }
  }
  if (marks.safe) els.push(<rect key="safe" x={x + 5} y={y + 5} width={w - 10} height={h - 10} fill="none" stroke="#2f80ed" strokeDasharray="0.8 0.8" opacity={0.7} />);
  return (
    <g stroke="#222" strokeWidth={0.2} fill="none">
      {els}
    </g>
  );
}

/** Renders one imposed page as an SVG element sized in millimetres. */
export function PageSVG({ page, uid, className, style }: { page: PrintPage; uid: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${page.w} ${page.h}`} width={`${page.w}mm`} height={`${page.h}mm`} className={className} style={style}>
      <rect width={page.w} height={page.h} fill="#fff" />
      {page.placements.map((pl, i) => {
        const b = page.marks.bleed;
        const it = pl.item;
        const inner = (
          <svg x={0} y={0} width={it.w} height={it.h} viewBox={`0 0 ${it.w} ${it.h}`} overflow="hidden">
            {it.render(`${uid}-${i}`)}
          </svg>
        );
        const sx = (pl.rotated ? pl.h : pl.w) / it.w;
        const sy = (pl.rotated ? pl.w : pl.h) / it.h;
        return (
          <g key={i}>
            {b > 0 && it.bleedColor && <rect x={pl.x - b} y={pl.y - b} width={pl.w + b * 2} height={pl.h + b * 2} fill={it.bleedColor} />}
            <g transform={pl.rotated ? `translate(${pl.x + pl.w} ${pl.y}) rotate(90) scale(${sx} ${sy})` : `translate(${pl.x} ${pl.y}) scale(${sx} ${sy})`}>{inner}</g>
            <PlacementMarks pl={pl} marks={page.marks} />
          </g>
        );
      })}
    </svg>
  );
}
