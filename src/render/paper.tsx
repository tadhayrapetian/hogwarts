import type { BorderSpec, PaperStyle, WatermarkSpec } from '../core/types';
import { seededRandom } from '../core/util';
import { SymbolGlyph } from './symbols';

/** Grain tiles are generated once on a canvas and reused as SVG patterns (cheap to paint, exportable). */
const tileCache = new Map<string, string | null>();

export function paperTile(kind: string, intensity: number): string | null {
  const key = `${kind}:${intensity.toFixed(2)}`;
  if (tileCache.has(key)) return tileCache.get(key)!;
  let url: string | null = null;
  try {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (ctx) {
      const rnd = seededRandom(key);
      const img = ctx.createImageData(size, size);
      const dark = kind === 'midnight';
      for (let i = 0; i < img.data.length; i += 4) {
        const n = rnd();
        const v = dark ? 255 : 60 + n * 60;
        img.data[i] = v;
        img.data[i + 1] = v * (dark ? 1 : 0.85);
        img.data[i + 2] = v * (dark ? 1 : 0.6);
        img.data[i + 3] = Math.round(n * n * 70 * intensity);
      }
      ctx.putImageData(img, 0, 0);
      // Fibres.
      ctx.globalAlpha = 0.12 * intensity;
      ctx.strokeStyle = dark ? '#ffffff' : '#6b4a2b';
      ctx.lineWidth = 0.6;
      for (let i = 0; i < 70; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const a = rnd() * Math.PI;
        const l = 4 + rnd() * 18;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 3, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
      url = c.toDataURL('image/png');
    }
  } catch {
    url = null;
  }
  tileCache.set(key, url);
  return url;
}

export function PaperBackground({ id, w, h, paper, rounded = 0 }: { id: string; w: number; h: number; paper: PaperStyle; rounded?: number }) {
  const tile = paper.texture > 0.01 ? paperTile(paper.kind, paper.texture) : null;
  const rnd = seededRandom(id + paper.kind);
  const stains = paper.stains
    ? Array.from({ length: 4 }, () => ({ cx: rnd() * w, cy: rnd() * h, r: 8 + rnd() * Math.min(w, h) * 0.18, o: 0.05 + rnd() * 0.08 }))
    : [];
  const dark = paper.kind === 'midnight';
  return (
    <g>
      <defs>
        {tile && (
          <pattern id={`${id}-grain`} patternUnits="userSpaceOnUse" width={40} height={40}>
            <image href={tile} width={40} height={40} preserveAspectRatio="none" />
          </pattern>
        )}
        <radialGradient id={`${id}-vig`} cx="50%" cy="50%" r="72%">
          <stop offset="55%" stopColor={dark ? '#000' : '#7a5228'} stopOpacity={0} />
          <stop offset="100%" stopColor={dark ? '#000' : '#5c3a17'} stopOpacity={paper.vignette * (dark ? 0.6 : 0.45)} />
        </radialGradient>
        {stains.length > 0 && (
          <radialGradient id={`${id}-stain`}>
            <stop offset="0%" stopColor="#8a5a2b" stopOpacity={0} />
            <stop offset="78%" stopColor="#8a5a2b" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#8a5a2b" stopOpacity={0} />
          </radialGradient>
        )}
      </defs>
      <rect width={w} height={h} rx={rounded} fill={paper.color} />
      {tile && <rect width={w} height={h} rx={rounded} fill={`url(#${id}-grain)`} />}
      {stains.map((s, i) => (
        <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={`url(#${id}-stain)`} opacity={s.o * 3} />
      ))}
      {paper.vignette > 0.01 && <rect width={w} height={h} rx={rounded} fill={`url(#${id}-vig)`} />}
    </g>
  );
}

function Corner({ x, y, sx, sy, color, sw, size }: { x: number; y: number; sx: number; sy: number; color: string; sw: number; size: number }) {
  const s = size;
  return (
    <g transform={`translate(${x} ${y}) scale(${sx} ${sy})`} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
      <path d={`M0 ${s} C0 ${s * 0.4} ${s * 0.4} 0 ${s} 0`} />
      <path d={`M${s * 0.25} ${s * 0.9} C${s * 0.25} ${s * 0.5} ${s * 0.5} ${s * 0.25} ${s * 0.9} ${s * 0.25}`} />
      <circle cx={s * 0.42} cy={s * 0.42} r={s * 0.08} fill={color} stroke="none" />
      <path d={`M${s} 0 q${s * 0.25} ${s * 0.12} ${s * 0.45} 0 M0 ${s} q${s * 0.12} ${s * 0.25} 0 ${s * 0.45}`} />
    </g>
  );
}

export function PageBorder({ w, h, border }: { w: number; h: number; border: BorderSpec }) {
  if (border.style === 'none') return null;
  const i = border.inset;
  const c = border.color;
  const sw = border.width;
  const iw = w - i * 2;
  const ih = h - i * 2;
  if (iw <= 0 || ih <= 0) return null;
  switch (border.style) {
    case 'single':
      return <rect x={i} y={i} width={iw} height={ih} fill="none" stroke={c} strokeWidth={sw} />;
    case 'dashed':
      return <rect x={i} y={i} width={iw} height={ih} fill="none" stroke={c} strokeWidth={sw} strokeDasharray={`${sw * 6} ${sw * 4}`} />;
    case 'double':
      return (
        <g fill="none" stroke={c}>
          <rect x={i} y={i} width={iw} height={ih} strokeWidth={sw * 1.6} />
          <rect x={i + sw * 3} y={i + sw * 3} width={iw - sw * 6} height={ih - sw * 6} strokeWidth={sw * 0.6} />
        </g>
      );
    case 'stamp': {
      const r = Math.max(0.6, sw);
      const step = r * 3.2;
      const dots: JSX.Element[] = [];
      for (let x = i; x <= w - i + 0.01; x += step) dots.push(<circle key={`t${x}`} cx={x} cy={i} r={r} />, <circle key={`b${x}`} cx={x} cy={h - i} r={r} />);
      for (let y = i + step; y < h - i; y += step) dots.push(<circle key={`l${y}`} cx={i} cy={y} r={r} />, <circle key={`r${y}`} cx={w - i} cy={y} r={r} />);
      return <g fill={c}>{dots}</g>;
    }
    case 'deco': {
      const s = Math.min(iw, ih) * 0.06;
      const path = `M${i + s} ${i} H${w - i - s} L${w - i} ${i + s} V${h - i - s} L${w - i - s} ${h - i} H${i + s} L${i} ${h - i - s} V${i + s} Z`;
      const j = i + sw * 4;
      const s2 = s * 0.7;
      const inner = `M${j + s2} ${j} H${w - j - s2} L${w - j} ${j + s2} V${h - j - s2} L${w - j - s2} ${h - j} H${j + s2} L${j} ${h - j - s2} V${j + s2} Z`;
      return (
        <g fill="none" stroke={c}>
          <path d={path} strokeWidth={sw * 1.4} />
          <path d={inner} strokeWidth={sw * 0.6} />
          {[
            [w / 2, i],
            [w / 2, h - i],
          ].map(([x, y], k) => (
            <path key={k} d={`M${x - s} ${y} L${x} ${y + (k ? -s * 0.6 : s * 0.6)} L${x + s} ${y}`} strokeWidth={sw} />
          ))}
        </g>
      );
    }
    case 'ornate':
    case 'filigree': {
      const size = Math.min(iw, ih) * (border.style === 'ornate' ? 0.11 : 0.08);
      const off = sw * 3.5;
      return (
        <g>
          <rect x={i} y={i} width={iw} height={ih} fill="none" stroke={c} strokeWidth={sw * 1.4} />
          <rect x={i + off} y={i + off} width={iw - off * 2} height={ih - off * 2} fill="none" stroke={c} strokeWidth={sw * 0.5} />
          <Corner x={i + off} y={i + off} sx={1} sy={1} color={c} sw={sw * 0.8} size={size} />
          <Corner x={w - i - off} y={i + off} sx={-1} sy={1} color={c} sw={sw * 0.8} size={size} />
          <Corner x={i + off} y={h - i - off} sx={1} sy={-1} color={c} sw={sw * 0.8} size={size} />
          <Corner x={w - i - off} y={h - i - off} sx={-1} sy={-1} color={c} sw={sw * 0.8} size={size} />
          {border.style === 'filigree' &&
            [
              [w / 2, i + off],
              [w / 2, h - i - off],
              [i + off, h / 2],
              [w - i - off, h / 2],
            ].map(([x, y], k) => <rect key={k} x={x - size * 0.12} y={y - size * 0.12} width={size * 0.24} height={size * 0.24} transform={`rotate(45 ${x} ${y})`} fill={c} />)}
        </g>
      );
    }
    default:
      return null;
  }
}

export function Watermark({ w, h, wm, badge }: { w: number; h: number; wm: WatermarkSpec; badge?: ((box: { x: number; y: number; w: number; h: number }) => JSX.Element) | null }) {
  if (wm.kind === 'none') return null;
  const size = Math.min(wm.size, Math.min(w, h) * 0.95);
  const cx = w / 2;
  const cy = h / 2;
  return (
    <g opacity={wm.opacity} transform={`rotate(${wm.rotation || 0} ${cx} ${cy})`} pointerEvents="none">
      {wm.kind === 'symbol' && <SymbolGlyph symbol={wm.value || 'owl'} x={cx - size / 2} y={cy - size / 2} size={size} color={wm.color} strokeWidth={0.8} />}
      {wm.kind === 'text' && (
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontFamily="'Cinzel', 'Cormorant Garamond', serif" fontSize={size / Math.max(4, (wm.value || '').length * 0.7)} fill={wm.color} letterSpacing={2}>
          {wm.value}
        </text>
      )}
      {wm.kind === 'badge' && badge && badge({ x: cx - (size * 0.83) / 2, y: cy - size / 2, w: size * 0.83, h: size })}
    </g>
  );
}
