import type { Seal, SealShape } from '../core/types';
import { hashString, seededRandom } from '../core/util';
import { InkWearFilter } from './postmark';
import type { Box } from './stamp';
import { SymbolGlyph } from './symbols';

/** Shade a hex colour: amount -1..1 (negative = darker). */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Smooth closed path through points (Catmull-Rom → cubic Bézier). */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + 'Z';
}

/** Outline of a seal in a 100×100 box. */
export function sealOutline(shape: SealShape, seed: string, r = 46): string {
  const cx = 50;
  const cy = 50;
  switch (shape) {
    case 'irregular': {
      const rnd = seededRandom(seed);
      const pts: [number, number][] = [];
      const n = 22;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = r * (0.9 + rnd() * 0.14) + (rnd() > 0.82 ? rnd() * 4 : 0);
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      return smoothPath(pts);
    }
    case 'scalloped': {
      const n = 24;
      let d = '';
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const p0 = [cx + Math.cos(a0) * r * 0.93, cy + Math.sin(a0) * r * 0.93];
        const p1 = [cx + Math.cos(a1) * r * 0.93, cy + Math.sin(a1) * r * 0.93];
        const c = [cx + Math.cos(am) * r * 1.09, cy + Math.sin(am) * r * 1.09];
        d += `${i === 0 ? `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}` : ''} Q${c[0].toFixed(2)} ${c[1].toFixed(2)} ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
      }
      return d + 'Z';
    }
    case 'octagon': {
      const pts = Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
      });
      return `M${pts.join(' L')}Z`;
    }
    case 'shield':
      return `M${cx - r * 0.86} ${cy - r * 0.86} H${cx + r * 0.86} V${cy - r * 0.1} C${cx + r * 0.86} ${cy + r * 0.55} ${cx + r * 0.35} ${cy + r * 0.85} ${cx} ${cy + r} C${cx - r * 0.35} ${cy + r * 0.85} ${cx - r * 0.86} ${cy + r * 0.55} ${cx - r * 0.86} ${cy - r * 0.1} Z`;
    default:
      return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
  }
}

/** Seal artwork in a 100×100 viewBox (scaled by the caller to `seal.size` mm). */
export function SealArt({ seal, uid, box }: { seal: Seal; uid: string; box?: Box }) {
  const id = (s: string) => `${uid}-${s}`;
  const seed = seal.id + seal.shape;
  const c = seal.color;
  const ringText = seal.text.trim().toUpperCase();
  const outline = sealOutline(seal.type === 'wax' && seal.shape === 'round' ? 'irregular' : seal.shape, seed, seal.type === 'official' ? 40 : 46);
  const centerLabel = seal.initials.trim();
  const hasSymbol = !!seal.symbol;
  const symSize = centerLabel ? 26 : 34;
  const symY = centerLabel ? 30 : 33;

  const ringPath = (r: number) => (
    <path id={id('ring')} d={`M${50 - r} 50 A${r} ${r} 0 1 1 ${50 + r} 50 A${r} ${r} 0 1 1 ${50 - r} 50`} />
  );
  const ring = (color: string, size = 7.2) =>
    ringText ? (
      <text fontFamily="'Cinzel', 'Cormorant Garamond', 'Noto Serif Armenian', serif" fontSize={size} fontWeight={700} fill={color} letterSpacing={0.6}>
        <textPath href={`#${id('ring')}`} startOffset="25%" textAnchor="middle">
          {ringText}
        </textPath>
      </text>
    ) : null;

  const content = (fill: string, opts: { emboss?: boolean; light?: string; dark?: string } = {}) => {
    const fit = ringText ? ' translate(50 50) scale(0.64) translate(-50 -50)' : '';
    const layer = (dx: number, dy: number, color: string, op = 1) => (
      <g transform={`translate(${dx} ${dy})${fit}`} opacity={op}>
        {hasSymbol && <SymbolGlyph symbol={seal.symbol} x={50 - symSize / 2} y={symY - symSize / 2 + (centerLabel ? 2 : 17)} size={symSize} color={color} strokeWidth={2.1} />}
        {centerLabel && (
          <text x={50} y={hasSymbol ? 68 : 60} textAnchor="middle" fontFamily="'Cinzel', 'Cormorant Garamond', serif" fontSize={hasSymbol ? 14 : 24} fontWeight={700} fill={color}>
            {centerLabel}
          </text>
        )}
        {seal.year && (
          <text x={50} y={hasSymbol || centerLabel ? 79 : 58} textAnchor="middle" fontFamily="'Cinzel', serif" fontSize={6.5} fontWeight={600} fill={color}>
            {seal.year}
          </text>
        )}
      </g>
    );
    if (opts.emboss)
      return (
        <>
          {layer(0.9, 0.9, opts.dark ?? '#000', 0.55)}
          {layer(-0.6, -0.6, opts.light ?? '#fff', 0.6)}
          {layer(0, 0, fill)}
        </>
      );
    return layer(0, 0, fill);
  };

  if (seal.type === 'wax') {
    return (
      <svg viewBox="0 0 100 100" x={box?.x} y={box?.y} width={box?.w ?? seal.size} height={box?.h ?? seal.size} overflow="visible">
        <defs>
          <radialGradient id={id('wax')} cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor={shade(c, 0.35)} />
            <stop offset="0.45" stopColor={c} />
            <stop offset="1" stopColor={shade(c, -0.45)} />
          </radialGradient>
          <radialGradient id={id('press')} cx="45%" cy="40%" r="65%">
            <stop offset="0" stopColor={shade(c, -0.05)} />
            <stop offset="1" stopColor={shade(c, -0.3)} />
          </radialGradient>
          {ringPath(29.5)}
        </defs>
        <path d={outline} fill="#000" opacity={0.25} transform="translate(1.6 2.2)" />
        <path d={outline} fill={`url(#${id('wax')})`} />
        <circle cx={50} cy={50} r={35} fill={`url(#${id('press')})`} />
        <circle cx={50} cy={50} r={35} fill="none" stroke={shade(c, -0.55)} strokeWidth={1.4} opacity={0.6} />
        <circle cx={50} cy={50} r={36.2} fill="none" stroke={shade(c, 0.4)} strokeWidth={0.9} opacity={0.55} />
        {ring(shade(c, -0.5), 6.2)}
        {ringText && <circle cx={50} cy={50} r={24} fill="none" stroke={shade(c, -0.45)} strokeWidth={0.7} />}
        {content(shade(c, -0.15), { emboss: true, light: shade(c, 0.45), dark: shade(c, -0.6) })}
        <ellipse cx={36} cy={28} rx={9} ry={4} fill="#fff" opacity={0.18} transform="rotate(-30 36 28)" />
      </svg>
    );
  }
  if (seal.type === 'embossed') {
    const paper = c;
    return (
      <svg viewBox="0 0 100 100" x={box?.x} y={box?.y} width={box?.w ?? seal.size} height={box?.h ?? seal.size} overflow="visible">
        <defs>{ringPath(36)}</defs>
        <path d={outline} fill={paper} />
        <path d={outline} fill="none" stroke="#000" strokeOpacity={0.22} strokeWidth={1.4} transform="translate(0.7 0.7)" />
        <path d={outline} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.2} transform="translate(-0.5 -0.5)" />
        <circle cx={50} cy={50} r={30} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={0.8} transform="translate(0.5 0.5)" />
        <circle cx={50} cy={50} r={30} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={0.8} />
        {ring(shade(paper, -0.12), 6.6)}
        {content(shade(paper, -0.06), { emboss: true, light: '#ffffff', dark: shade(paper, -0.45) })}
      </svg>
    );
  }
  if (seal.type === 'ink') {
    const seedN = hashString(uid + seal.id);
    return (
      <svg viewBox="0 0 100 100" x={box?.x} y={box?.y} width={box?.w ?? seal.size} height={box?.h ?? seal.size} overflow="visible">
        <defs>
          <InkWearFilter id={id('wear')} wear={0.45} seed={seedN} />
          {ringPath(37)}
        </defs>
        <g filter={`url(#${id('wear')})`} opacity={0.9}>
          <path d={outline} fill="none" stroke={c} strokeWidth={2.6} />
          <circle cx={50} cy={50} r={29} fill="none" stroke={c} strokeWidth={1.2} />
          {ring(c, 7)}
          {content(c)}
        </g>
      </svg>
    );
  }
  // Official: gold foil rosette with optional ribbons.
  const rays = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    const r1 = i % 2 ? 44 : 49;
    return `${(50 + Math.cos(a) * r1).toFixed(2)} ${(50 + Math.sin(a) * r1).toFixed(2)}`;
  });
  return (
    <svg viewBox="0 0 100 100" x={box?.x} y={box?.y} width={box?.w ?? seal.size} height={box?.h ?? seal.size} overflow="visible">
      <defs>
        <linearGradient id={id('foil')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={shade(c, 0.45)} />
          <stop offset="0.35" stopColor={c} />
          <stop offset="0.55" stopColor={shade(c, 0.5)} />
          <stop offset="0.8" stopColor={shade(c, -0.25)} />
          <stop offset="1" stopColor={shade(c, 0.2)} />
        </linearGradient>
        {ringPath(30.5)}
      </defs>
      {seal.ribbons && (
        <g>
          <path d="M36 66 L24 104 L32 99 L37 108 L46 72 Z" fill="#7b1f1a" />
          <path d="M64 66 L76 104 L68 99 L63 108 L54 72 Z" fill="#1f3d6b" />
        </g>
      )}
      <path d={`M${rays.join(' L')}Z`} fill={`url(#${id('foil')})`} stroke={shade(c, -0.35)} strokeWidth={0.5} />
      <circle cx={50} cy={50} r={37.5} fill={`url(#${id('foil')})`} stroke={shade(c, -0.4)} strokeWidth={0.8} />
      <circle cx={50} cy={50} r={23} fill="none" stroke={shade(c, -0.4)} strokeWidth={0.6} />
      {ring(shade(c, -0.55), 6.4)}
      {content(shade(c, -0.5), { emboss: true, light: shade(c, 0.6), dark: shade(c, -0.6) })}
    </svg>
  );
}
