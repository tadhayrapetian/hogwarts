import type { Postmark } from '../core/types';
import { hashString, monthShort, parseISODate } from '../core/util';
import { fontStack } from './fonts';
import type { Box } from './stamp';

export function formatPostmarkDate(pm: Postmark, isoDate: string | undefined, locale = 'en'): string {
  const d = parseISODate(isoDate ?? '') ?? new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const mon = monthShort(d.getMonth(), locale).toUpperCase();
  const y = d.getFullYear();
  switch (pm.dateFormat) {
    case 'DD.MM.YYYY':
      return `${dd}.${mm}.${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${mm}-${dd}`;
    case 'MMM DD YYYY':
      return `${mon} ${dd} ${y}`;
    case 'DD MMM':
      return `${dd} ${mon}`;
    default:
      return `${dd} ${mon} ${y}`;
  }
}

/** Size of the postmark artwork in mm (width, height). */
export function postmarkBox(pm: Postmark): [number, number] {
  const s = pm.size;
  switch (pm.shape) {
    case 'oval':
      return [s * 1.25, s * 0.8];
    case 'rect':
      return [s * 1.3, s * 0.7];
    case 'duplex':
      return [s * 2.3, s];
    case 'wavy':
      return [s * 2.7, s];
    default:
      return [s, s];
  }
}

/** Ink-wear filter: rough edges + patchy, uneven ink like an old hand stamp. */
export function InkWearFilter({ id, wear, seed }: { id: string; wear: number; seed: number }) {
  const w = Math.max(0, Math.min(1, wear));
  return (
    <filter id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves={2} seed={seed % 997} result="fine" />
      <feDisplacementMap in="SourceGraphic" in2="fine" scale={0.15 + w * 0.45} xChannelSelector="R" yChannelSelector="G" result="rough" />
      <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves={3} seed={(seed + 7) % 997} result="blot" />
      <feColorMatrix in="blot" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  6 0 0 0 ${-(0.9 + w * 2.1)}`} result="mask" />
      <feComposite in="rough" in2="mask" operator="in" />
    </filter>
  );
}

export function PostmarkArt({ pm, date, uid, locale = 'en', box }: { pm: Postmark; date?: string; uid: string; locale?: string; box?: Box }) {
  const [W, H] = postmarkBox(pm);
  const s = pm.size;
  const color = pm.color;
  const font = fontStack(pm.font);
  const dateText = formatPostmarkDate(pm, pm.dateSource === 'fixed' ? pm.fixedDate : date, locale);
  const fid = `${uid}-wear`;
  const seed = hashString(pm.id + uid);
  const sw = Math.max(0.35, s * 0.018);

  const ring = (cx: number, cy: number, R: number) => {
    const r0 = R * 0.62;
    const mid = (R + r0) / 2;
    const fs = Math.min((R - r0) * 0.62, (Math.PI * mid) / Math.max(8, pm.text.length * 0.62));
    const fsB = Math.min((R - r0) * 0.62, (Math.PI * mid) / Math.max(8, pm.location.length * 0.62));
    const rt = mid - fs * 0.35;
    const rb = mid + fsB * 0.35;
    return (
      <g>
        <defs>
          <path id={`${uid}-top`} d={`M${cx - rt} ${cy} A${rt} ${rt} 0 0 1 ${cx + rt} ${cy}`} />
          <path id={`${uid}-bot`} d={`M${cx - rb} ${cy} A${rb} ${rb} 0 0 0 ${cx + rb} ${cy}`} />
        </defs>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={color} strokeWidth={sw * 1.3} />
        {pm.shape === 'double' && <circle cx={cx} cy={cy} r={R - sw * 2.2} fill="none" stroke={color} strokeWidth={sw * 0.6} />}
        <circle cx={cx} cy={cy} r={r0} fill="none" stroke={color} strokeWidth={sw} />
        <text fontFamily={font} fontSize={fs} fontWeight={700} fill={color} letterSpacing={fs * 0.12}>
          <textPath href={`#${uid}-top`} startOffset="50%" textAnchor="middle">
            {pm.text.toUpperCase()}
          </textPath>
        </text>
        <text fontFamily={font} fontSize={fsB} fontWeight={700} fill={color} letterSpacing={fsB * 0.12}>
          <textPath href={`#${uid}-bot`} startOffset="50%" textAnchor="middle">
            {pm.location.toUpperCase()}
          </textPath>
        </text>
        <text x={cx} y={cy + (pm.number ? -r0 * 0.05 : r0 * 0.12)} textAnchor="middle" fontFamily={font} fontSize={Math.min(r0 * 0.42, (r0 * 3.2) / Math.max(6, dateText.length))} fontWeight={700} fill={color}>
          {dateText}
        </text>
        {pm.number && (
          <text x={cx} y={cy + r0 * 0.5} textAnchor="middle" fontFamily={font} fontSize={r0 * 0.28} fill={color}>
            {pm.number}
          </text>
        )}
        {[-1, 1].map((k) => (
          <circle key={k} cx={cx + k * mid} cy={cy} r={sw * 0.9} fill={color} />
        ))}
      </g>
    );
  };

  let body: JSX.Element;
  switch (pm.shape) {
    case 'oval': {
      const rx = W / 2 - sw;
      const ry = H / 2 - sw;
      const fs = ry * 0.26;
      body = (
        <g>
          <ellipse cx={W / 2} cy={H / 2} rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={sw * 1.3} />
          <ellipse cx={W / 2} cy={H / 2} rx={rx * 0.86} ry={ry * 0.78} fill="none" stroke={color} strokeWidth={sw * 0.6} />
          <text x={W / 2} y={H / 2 - ry * 0.32} textAnchor="middle" fontFamily={font} fontSize={fs} fontWeight={700} fill={color} letterSpacing={fs * 0.1}>
            {pm.text.toUpperCase()}
          </text>
          <text x={W / 2} y={H / 2 + fs * 0.4} textAnchor="middle" fontFamily={font} fontSize={fs * 1.05} fontWeight={700} fill={color}>
            {dateText}
          </text>
          <text x={W / 2} y={H / 2 + ry * 0.55} textAnchor="middle" fontFamily={font} fontSize={fs * 0.85} fill={color} letterSpacing={fs * 0.1}>
            {[pm.location, pm.number].filter(Boolean).join(' · ').toUpperCase()}
          </text>
        </g>
      );
      break;
    }
    case 'rect':
    case 'octagon': {
      const pad = sw * 1.5;
      const fs = H * 0.17;
      const c = Math.min(W, H) * 0.18;
      const outline =
        pm.shape === 'octagon' ? (
          <path
            d={`M${pad + c} ${pad} H${W - pad - c} L${W - pad} ${pad + c} V${H - pad - c} L${W - pad - c} ${H - pad} H${pad + c} L${pad} ${H - pad - c} V${pad + c} Z`}
            fill="none"
            stroke={color}
            strokeWidth={sw * 1.3}
          />
        ) : (
          <rect x={pad} y={pad} width={W - pad * 2} height={H - pad * 2} rx={1.2} fill="none" stroke={color} strokeWidth={sw * 1.3} />
        );
      body = (
        <g>
          {outline}
          <line x1={pad * 2.5} x2={W - pad * 2.5} y1={H * 0.36} y2={H * 0.36} stroke={color} strokeWidth={sw * 0.6} />
          <line x1={pad * 2.5} x2={W - pad * 2.5} y1={H * 0.66} y2={H * 0.66} stroke={color} strokeWidth={sw * 0.6} />
          <text x={W / 2} y={H * 0.29} textAnchor="middle" fontFamily={font} fontSize={fs} fontWeight={700} fill={color} letterSpacing={fs * 0.1}>
            {pm.text.toUpperCase()}
          </text>
          <text x={W / 2} y={H * 0.58} textAnchor="middle" fontFamily={font} fontSize={fs * 1.1} fontWeight={700} fill={color}>
            {dateText}
          </text>
          <text x={W / 2} y={H * 0.84} textAnchor="middle" fontFamily={font} fontSize={fs * 0.85} fill={color}>
            {[pm.location, pm.number].filter(Boolean).join(' · ').toUpperCase()}
          </text>
        </g>
      );
      break;
    }
    case 'duplex':
    case 'wavy': {
      const R = s / 2 - sw;
      const lines = 6;
      const x0 = s + s * 0.08;
      const x1 = W - sw;
      const bars = Array.from({ length: lines }, (_, i) => {
        const y = H * 0.18 + (i * H * 0.64) / (lines - 1);
        if (pm.shape === 'duplex') return <line key={i} x1={x0} y1={y} x2={x1} y2={y} stroke={color} strokeWidth={sw * 1.6} />;
        const amp = H * 0.05;
        const per = s * 0.32;
        let d = `M${x0} ${y}`;
        for (let x = x0; x < x1; x += per) d += ` q${per / 4} ${-amp} ${per / 2} 0 t${per / 2} 0`;
        return <path key={i} d={d} fill="none" stroke={color} strokeWidth={sw * 1.3} />;
      });
      body = (
        <g>
          {ring(s / 2, H / 2, R)}
          {bars}
        </g>
      );
      break;
    }
    default:
      body = ring(W / 2, H / 2, s / 2 - sw);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} x={box?.x} y={box?.y} width={box?.w ?? W} height={box?.h ?? H} overflow="visible">
      <defs>{pm.inkWear > 0.02 && <InkWearFilter id={fid} wear={pm.inkWear} seed={seed} />}</defs>
      <g opacity={pm.opacity} filter={pm.inkWear > 0.02 ? `url(#${fid})` : undefined} transform={`rotate(${pm.rotation} ${W / 2} ${H / 2})`}>
        {body}
      </g>
    </svg>
  );
}
