import type { House } from '../core/types';
import { shade } from './seal';
import type { Box } from './stamp';
import { SymbolGlyph } from './symbols';

const SHIELD = 'M12 10 H88 V52 C88 82 70 100 50 110 C30 100 12 82 12 52 Z';

/** House crest artwork in a 100×120 viewBox. */
export function CrestArt({ house, uid, showName = true, box }: { house: House; uid: string; showName?: boolean; box?: Box }) {
  const id = (s: string) => `${uid}-${s}`;
  const p = house.primaryColor;
  const s2 = house.secondaryColor;
  const a = house.accentColor;
  const name = house.name.toUpperCase();
  if (house.crestStyle === 'round') {
    return (
      <svg viewBox="0 0 100 120" x={box?.x} y={box?.y} width={box?.w ?? 100} height={box?.h ?? 120} overflow="visible">
        <defs>
          <path id={id('ring')} d="M14 55 A36 36 0 1 1 86 55 A36 36 0 1 1 14 55" />
        </defs>
        <circle cx={50} cy={55} r={46} fill={s2} />
        <circle cx={50} cy={55} r={43} fill={p} stroke={a} strokeWidth={1.4} />
        <circle cx={50} cy={55} r={29} fill={shade(p, -0.2)} stroke={a} strokeWidth={1} />
        <SymbolGlyph symbol={house.symbol} x={32} y={37} size={36} color={a} strokeWidth={1.7} />
        {showName && (
          <text fontFamily="'Cinzel', 'Cormorant Garamond', 'Noto Serif Armenian', serif" fontSize={8} fontWeight={700} fill={a} letterSpacing={1}>
            <textPath href={`#${id('ring')}`} startOffset="25%" textAnchor="middle">
              {name}
            </textPath>
          </text>
        )}
      </svg>
    );
  }
  if (house.crestStyle === 'banner') {
    return (
      <svg viewBox="0 0 100 120" x={box?.x} y={box?.y} width={box?.w ?? 100} height={box?.h ?? 120} overflow="visible">
        <path d="M22 4 H78 V96 L50 116 L22 96 Z" fill={p} stroke={s2} strokeWidth={2} />
        <path d="M22 4 H78 V18 H22 Z" fill={s2} />
        <path d="M28 4 V92 M72 4 V92" stroke={a} strokeWidth={0.8} opacity={0.6} />
        <SymbolGlyph symbol={house.symbol} x={30} y={36} size={40} color={a} strokeWidth={1.7} />
        {showName && (
          <text x={50} y={14} textAnchor="middle" fontFamily="'Cinzel', 'Cormorant Garamond', serif" fontSize={7} fontWeight={700} fill={a} letterSpacing={0.8}>
            {name}
          </text>
        )}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 120" x={box?.x} y={box?.y} width={box?.w ?? 100} height={box?.h ?? 120} overflow="visible">
      <defs>
        <clipPath id={id('clip')}>
          <path d={SHIELD} />
        </clipPath>
        <linearGradient id={id('g')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(p, 0.12)} />
          <stop offset="1" stopColor={shade(p, -0.18)} />
        </linearGradient>
      </defs>
      <path d={SHIELD} fill={`url(#${id('g')})`} />
      <g clipPath={`url(#${id('clip')})`}>
        <path d="M12 10 L50 38 L88 10 V22 L50 50 L12 22 Z" fill={s2} opacity={0.95} />
      </g>
      <path d={SHIELD} fill="none" stroke={a} strokeWidth={2.4} />
      <path d={SHIELD} fill="none" stroke={shade(a, -0.4)} strokeWidth={0.6} transform="translate(50 60) scale(0.9) translate(-50 -60)" />
      <SymbolGlyph symbol={house.symbol} x={31} y={48} size={38} color={a} strokeWidth={1.8} />
      {showName && (
        <g>
          <path d="M4 98 L14 92 H86 L96 98 L86 104 L90 112 H10 L14 104 Z" fill={s2} stroke={shade(s2, -0.35)} strokeWidth={0.6} />
          <text x={50} y={105} textAnchor="middle" fontFamily="'Cinzel', 'Cormorant Garamond', 'Noto Serif Armenian', serif" fontSize={Math.min(8, 70 / Math.max(4, name.length * 0.62))} fontWeight={700} fill={a} letterSpacing={0.6}>
            {name}
          </text>
        </g>
      )}
    </svg>
  );
}

/** The school crest: a shield quartered with every house's colours and symbols. */
export function SchoolCrestArt({ houses, motto, uid, showName = true, box }: { houses: House[]; motto: string; uid: string; showName?: boolean; box?: Box }) {
  const id = (s: string) => `${uid}-${s}`;
  const list = houses.slice(0, 4);
  const quads = [
    [12, 10, 38, 50],
    [50, 10, 38, 50],
    [12, 60, 38, 52],
    [50, 60, 38, 52],
  ];
  return (
    <svg viewBox="0 0 100 120" x={box?.x} y={box?.y} width={box?.w ?? 100} height={box?.h ?? 120} overflow="visible">
      <defs>
        <clipPath id={id('clip')}>
          <path d={SHIELD} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id('clip')})`}>
        <rect x={0} y={0} width={100} height={120} fill="#3a2a1a" />
        {quads.map(([x, y, w, h], i) => {
          const hs = list[i];
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} fill={hs?.primaryColor ?? ['#5b1f1a', '#1f3d6b', '#2f5233', '#6b4a1f'][i]} />
              <SymbolGlyph symbol={hs?.symbol ?? 'star'} x={x + w / 2 - 11} y={y + h / 2 - 13} size={22} color={hs?.accentColor ?? '#e8c97a'} strokeWidth={1.8} />
            </g>
          );
        })}
        <path d="M50 10 V112 M12 60 H88" stroke="#d9b968" strokeWidth={3} />
      </g>
      <path d={SHIELD} fill="none" stroke="#d9b968" strokeWidth={2.6} />
      <circle cx={50} cy={60} r={11} fill="#2a1c10" stroke="#d9b968" strokeWidth={1.6} />
      <SymbolGlyph symbol="owl" x={42} y={52} size={16} color="#e8c97a" strokeWidth={1.8} />
      {showName && motto && (
        <g>
          <path d="M2 100 L12 94 H88 L98 100 L88 106 L92 114 H8 L12 106 Z" fill="#efe1c0" stroke="#8a6a35" strokeWidth={0.6} />
          <text x={50} y={107} textAnchor="middle" fontFamily="'Cinzel', 'Cormorant Garamond', serif" fontSize={Math.min(7.5, 72 / Math.max(4, motto.length * 0.6))} fontWeight={700} fill="#5b3a18" letterSpacing={0.6}>
            {motto.toUpperCase()}
          </text>
        </g>
      )}
    </svg>
  );
}
