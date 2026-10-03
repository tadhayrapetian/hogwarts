import type { Asset, Stamp } from '../core/types';
import { fontStack } from './fonts';
import { SymbolGlyph } from './symbols';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Postage stamp artwork in millimetres (0,0)–(w,h). Rendered as a nested <svg>. */
export function StampArt({ stamp, uid, asset, box }: { stamp: Stamp; uid: string; asset?: Asset; box?: Box }) {
  const { w, h } = stamp;
  const perfR = 0.7;
  const pitch = 2.1;
  const m = stamp.shape === 'perforated' ? 1.9 : 1.2;
  const iw = w - m * 2;
  const ih = h - m * 2;
  const title = stamp.title;
  const titleSize = Math.min(3.1, (iw * 1.35) / Math.max(6, title.length));
  const symSize = Math.min(iw * 0.62, ih * 0.5);
  const id = (s: string) => `${uid}-${s}`;
  const clipShape = (() => {
    switch (stamp.shape) {
      case 'circle':
        return <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - m} />;
      case 'oval':
        return <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - m} ry={h / 2 - m} />;
      case 'triangle':
        return <path d={`M${w / 2} ${m} L${w - m} ${h - m} L${m} ${h - m} Z`} />;
      case 'rounded':
        return <rect x={m} y={m} width={iw} height={ih} rx={2.4} />;
      default:
        return <rect x={m} y={m} width={iw} height={ih} />;
    }
  })();

  const perfs: JSX.Element[] = [];
  if (stamp.shape === 'perforated') {
    const nx = Math.max(2, Math.round(w / pitch));
    const ny = Math.max(2, Math.round(h / pitch));
    for (let i = 0; i <= nx; i++) {
      const x = (i * w) / nx;
      perfs.push(<circle key={`t${i}`} cx={x} cy={0} r={perfR} />, <circle key={`b${i}`} cx={x} cy={h} r={perfR} />);
    }
    for (let j = 1; j < ny; j++) {
      const y = (j * h) / ny;
      perfs.push(<circle key={`l${j}`} cx={0} cy={y} r={perfR} />, <circle key={`r${j}`} cx={w} cy={y} r={perfR} />);
    }
  }

  const pattern = (() => {
    const c = stamp.accent;
    switch (stamp.pattern) {
      case 'lines':
        return Array.from({ length: Math.ceil((w + h) / 1.2) }, (_, i) => (
          <line key={i} x1={i * 1.2 - h} y1={h} x2={i * 1.2} y2={0} stroke={c} strokeWidth={0.12} opacity={0.35} />
        ));
      case 'dots':
        return Array.from({ length: Math.ceil(w / 1.6) * Math.ceil(h / 1.6) }, (_, i) => {
          const cols = Math.ceil(w / 1.6);
          return <circle key={i} cx={(i % cols) * 1.6 + 0.8} cy={Math.floor(i / cols) * 1.6 + 0.8} r={0.18} fill={c} opacity={0.35} />;
        });
      case 'rays':
        return Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * Math.PI * 2;
          return <line key={i} x1={w / 2} y1={h * 0.45} x2={w / 2 + Math.cos(a) * w} y2={h * 0.45 + Math.sin(a) * w} stroke={c} strokeWidth={0.35} opacity={0.22} />;
        });
      case 'guilloche':
        return Array.from({ length: 14 }, (_, i) => (
          <ellipse
            key={i}
            cx={w / 2}
            cy={h * 0.45}
            rx={iw * 0.48}
            ry={ih * 0.18}
            transform={`rotate(${(i * 180) / 14} ${w / 2} ${h * 0.45})`}
            fill="none"
            stroke={c}
            strokeWidth={0.1}
            opacity={0.45}
          />
        ));
      default:
        return null;
    }
  })();

  return (
    <svg viewBox={`0 0 ${w} ${h}`} x={box?.x} y={box?.y} width={box?.w ?? w} height={box?.h ?? h} overflow="visible">
      <defs>
        <mask id={id('perf')}>
          <rect x={-1} y={-1} width={w + 2} height={h + 2} fill="#fff" />
          <g fill="#000">{perfs}</g>
        </mask>
        <clipPath id={id('clip')}>{clipShape}</clipPath>
        <linearGradient id={id('sheen')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.18} />
          <stop offset="0.6" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>
      {stamp.shape === 'perforated' ? (
        <rect width={w} height={h} fill="#fbf8f1" mask={`url(#${id('perf')})`} />
      ) : (
        <g fill="#fbf8f1">
          {stamp.shape === 'circle' && <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2} />}
          {stamp.shape === 'oval' && <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />}
          {stamp.shape === 'triangle' && <path d={`M${w / 2} 0 L${w} ${h} L0 ${h} Z`} />}
          {stamp.shape === 'rounded' && <rect width={w} height={h} rx={3} />}
        </g>
      )}
      <g clipPath={`url(#${id('clip')})`}>
        <rect width={w} height={h} fill={stamp.bg} />
        {pattern}
        {asset ? (
          <image href={asset.dataUrl} x={m} y={m} width={iw} height={ih} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <SymbolGlyph symbol={stamp.symbol} x={w / 2 - symSize / 2} y={h * 0.47 - symSize / 2} size={symSize} color={stamp.ink} strokeWidth={1.4} />
        )}
        <rect width={w} height={h} fill={`url(#${id('sheen')})`} />
      </g>
      {stamp.shape !== 'triangle' && stamp.shape !== 'circle' && stamp.shape !== 'oval' && (
        <rect x={m + 0.6} y={m + 0.6} width={iw - 1.2} height={ih - 1.2} rx={stamp.shape === 'rounded' ? 1.8 : 0} fill="none" stroke={stamp.frame} strokeWidth={0.45} />
      )}
      <text
        x={w / 2}
        y={m + 0.9 + titleSize}
        textAnchor="middle"
        fontFamily={fontStack(stamp.font)}
        fontSize={titleSize}
        fontWeight={700}
        fill={stamp.ink}
        letterSpacing={0.15}
      >
        {title}
      </text>
      <text x={w - m - 1.2} y={h - m - 1.3} textAnchor="end" fontFamily={fontStack(stamp.font)} fontSize={Math.min(5.2, iw * 0.22)} fontWeight={700} fill={stamp.ink}>
        {stamp.value}
      </text>
      <text x={m + 1.3} y={h - m - 1.3} fontFamily={fontStack(stamp.font)} fontSize={Math.min(2.1, iw * 0.09)} fill={stamp.ink} opacity={0.9}>
        {stamp.subtitle}
      </text>
    </svg>
  );
}
