import type { EnvelopeDesign, FlapShape, LinerPattern } from '../core/types';
import type { RenderCtx } from './context';
import { LayoutContent } from './LayoutSVG';
import { PaperBackground } from './paper';
import { shade } from './seal';

/** Closed top flap outline on the back of an envelope (w×h coordinates). */
export function flapPath(shape: FlapShape, w: number, h: number): string {
  switch (shape) {
    case 'straight':
      return `M0 0 H${w} V${h * 0.34} H0 Z`;
    case 'wallet':
      return `M0 0 H${w} V${h * 0.4} Q${w} ${h * 0.46} ${w - h * 0.06} ${h * 0.46} H${h * 0.06} Q0 ${h * 0.46} 0 ${h * 0.4} Z`;
    case 'curved':
      return `M0 0 H${w} C${w * 0.8} ${h * 0.42} ${w * 0.62} ${h * 0.56} ${w / 2} ${h * 0.56} C${w * 0.38} ${h * 0.56} ${w * 0.2} ${h * 0.42} 0 0 Z`;
    default:
      return `M0 0 H${w} L${w / 2 + w * 0.03} ${h * 0.57} Q${w / 2} ${h * 0.6} ${w / 2 - w * 0.03} ${h * 0.57} Z`;
  }
}

/** Where the flap tip sits – the natural spot for a wax seal. */
export function flapTip(shape: FlapShape, w: number, h: number): [number, number] {
  switch (shape) {
    case 'straight':
      return [w / 2, h * 0.34];
    case 'wallet':
      return [w / 2, h * 0.46];
    case 'curved':
      return [w / 2, h * 0.56];
    default:
      return [w / 2, h * 0.585];
  }
}

export function LinerFill({ id, pattern, color, color2 }: { id: string; pattern: LinerPattern; color: string; color2: string }) {
  const s = 8;
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={s} height={s}>
      <rect width={s} height={s} fill={color} />
      {pattern === 'stripes' && <path d={`M0 ${s} L${s} 0 M-2 2 L2 -2 M${s - 2} ${s + 2} L${s + 2} ${s - 2}`} stroke={color2} strokeWidth={1.6} />}
      {pattern === 'dots' && <circle cx={s / 2} cy={s / 2} r={1.1} fill={color2} />}
      {pattern === 'stars' && <path d={`M4 1.5 L4.7 3.3 L6.6 3.3 L5.1 4.5 L5.7 6.4 L4 5.3 L2.3 6.4 L2.9 4.5 L1.4 3.3 L3.3 3.3 Z`} fill={color2} />}
      {pattern === 'diamonds' && <path d={`M4 0.8 L7.2 4 L4 7.2 L0.8 4 Z`} fill="none" stroke={color2} strokeWidth={0.5} />}
      {pattern === 'damask' && (
        <g fill="none" stroke={color2} strokeWidth={0.45}>
          <path d="M4 0.8 C6 2.5 6 5.5 4 7.2 C2 5.5 2 2.5 4 0.8 Z" />
          <circle cx={0} cy={0} r={1.2} />
          <circle cx={8} cy={0} r={1.2} />
          <circle cx={0} cy={8} r={1.2} />
          <circle cx={8} cy={8} r={1.2} />
        </g>
      )}
    </pattern>
  );
}

/** Back of the closed envelope: body, side/bottom flap folds, closed top flap and the back design. */
export function EnvelopeBackArt({ env, ctx, guides = true }: { env: EnvelopeDesign; ctx: RenderCtx; guides?: boolean }) {
  const { w, h } = env.back;
  const p = env.back.paper;
  const dark = shade(p.color, -0.18);
  const line = shade(p.color, -0.32);
  const id = `${ctx.idPrefix}-envb`;
  return (
    <g>
      <PaperBackground id={`${id}-paper`} w={w} h={h} paper={p} />
      {guides && (
        <g fill="none" stroke={line} strokeWidth={0.35} opacity={0.75}>
          <path d={`M0 ${h} L${w * 0.42} ${h * 0.5} M${w} ${h} L${w * 0.58} ${h * 0.5}`} />
          <path d={`M0 0 L${w * 0.4} ${h * 0.55} L${w * 0.6} ${h * 0.55} L${w} 0`} opacity={0.35} />
        </g>
      )}
      {guides && <path d={flapPath(env.flap, w, h)} fill={dark} opacity={0.12} />}
      <LayoutContent layout={env.back} ctx={ctx} background={false} />
      {guides && <path d={flapPath(env.flap, w, h)} fill="none" stroke={line} strokeWidth={0.45} />}
    </g>
  );
}

/** Opened envelope seen from the back: flap folded up showing the liner. */
export function EnvelopeOpenArt({ env, ctx, letterPeek }: { env: EnvelopeDesign; ctx: RenderCtx; letterPeek?: JSX.Element }) {
  const { w, h } = env.back;
  const p = env.back.paper;
  const id = `${ctx.idPrefix}-envo`;
  const flapH = flapTip(env.flap, w, h)[1];
  const liner = `${id}-liner`;
  return (
    <svg viewBox={`0 ${-flapH} ${w} ${h + flapH}`} width="100%" height="100%">
      <defs>
        <LinerFill id={liner} pattern={env.liner.pattern} color={env.liner.color} color2={env.liner.color2} />
        <linearGradient id={`${id}-shadow`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity={0.35} />
          <stop offset="1" stopColor="#000" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Opened flap (inside face, liner visible) */}
      <g transform={`translate(0 0) scale(1 -1)`}>
        <path d={flapPath(env.flap, w, h)} fill={p.color} />
        <path d={flapPath(env.flap, w, h)} fill={env.liner.pattern === 'none' ? shade(p.color, -0.08) : `url(#${liner})`} opacity={0.95} transform={`translate(${w * 0.03} 0) scale(0.94 0.92)`} />
      </g>
      {/* Inside back wall */}
      <rect x={0} y={0} width={w} height={h} fill={env.liner.pattern === 'none' ? shade(p.color, -0.12) : `url(#${liner})`} />
      <rect x={0} y={0} width={w} height={h * 0.25} fill={`url(#${id}-shadow)`} />
      {letterPeek}
      {/* Front pocket: side + bottom flaps */}
      <path d={`M0 0 L${w * 0.44} ${h * 0.52} L${w * 0.56} ${h * 0.52} L${w} 0 V${h} H0 Z`} fill={p.color} />
      <PaperBackgroundClip id={`${id}-pocket`} w={w} h={h} paper={p} path={`M0 0 L${w * 0.44} ${h * 0.52} L${w * 0.56} ${h * 0.52} L${w} 0 V${h} H0 Z`} />
      <path d={`M0 ${h} L${w * 0.42} ${h * 0.5} M${w} ${h} L${w * 0.58} ${h * 0.5}`} stroke={shade(p.color, -0.3)} strokeWidth={0.4} fill="none" />
      <path d={`M0 0 L${w * 0.44} ${h * 0.52} L${w * 0.56} ${h * 0.52} L${w} 0`} stroke={shade(p.color, -0.35)} strokeWidth={0.5} fill="none" />
    </svg>
  );
}

function PaperBackgroundClip({ id, w, h, paper, path }: { id: string; w: number; h: number; paper: EnvelopeDesign['back']['paper']; path: string }) {
  return (
    <g>
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={path} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <PaperBackground id={id} w={w} h={h} paper={paper} />
      </g>
    </g>
  );
}

// ───────────── Die-cut template (DIY envelope) ─────────────

export interface DielineGeometry {
  /** Overall template size (mm). */
  W: number;
  H: number;
  /** Offset of the centre (front) panel inside the template. */
  ox: number;
  oy: number;
  side: number;
  top: number;
  bottom: number;
}

export function dielineGeometry(w: number, h: number): DielineGeometry {
  const side = Math.max(14, w * 0.14);
  const top = h * 0.55;
  const bottom = h * 0.58;
  return { W: w + side * 2, H: h + top + bottom, ox: side, oy: top, side, top, bottom };
}

/**
 * Single-sheet envelope template. The front design is printed on the centre panel; the back
 * design is distributed over the flaps with the transforms that make it read correctly once folded
 * (horizontal folds rotate the artwork by 180°, vertical folds translate it).
 */
export function DielineArt({ env, ctx, marks = true }: { env: EnvelopeDesign; ctx: RenderCtx; marks?: boolean }) {
  const { w, h } = env.front;
  const g = dielineGeometry(w, h);
  const { ox, oy, side, top, bottom } = g;
  const id = `${ctx.idPrefix}-die`;
  const r = 3;
  const topFlap = `M${ox} ${oy} L${ox + w * 0.06} ${oy - top * 0.12} L${ox + w / 2 - 6} ${oy - top + 2} Q${ox + w / 2} ${oy - top - 1} ${ox + w / 2 + 6} ${oy - top + 2} L${ox + w - w * 0.06} ${oy - top * 0.12} L${ox + w} ${oy} Z`;
  const bottomFlap = `M${ox} ${oy + h} L${ox + r} ${oy + h + bottom * 0.85} Q${ox + w * 0.04} ${oy + h + bottom} ${ox + w * 0.12} ${oy + h + bottom} H${ox + w - w * 0.12} Q${ox + w - w * 0.04} ${oy + h + bottom} ${ox + w - r} ${oy + h + bottom * 0.85} L${ox + w} ${oy + h} Z`;
  const leftFlap = `M${ox} ${oy} L${ox - side * 0.85} ${oy + h * 0.12} Q${ox - side} ${oy + h * 0.2} ${ox - side} ${oy + h * 0.3} V${oy + h * 0.7} Q${ox - side} ${oy + h * 0.8} ${ox - side * 0.85} ${oy + h * 0.88} L${ox} ${oy + h} Z`;
  const rightFlap = `M${ox + w} ${oy} L${ox + w + side * 0.85} ${oy + h * 0.12} Q${ox + w + side} ${oy + h * 0.2} ${ox + w + side} ${oy + h * 0.3} V${oy + h * 0.7} Q${ox + w + side} ${oy + h * 0.8} ${ox + w + side * 0.85} ${oy + h * 0.88} L${ox + w} ${oy + h} Z`;
  const flaps = [
    { key: 'top', d: topFlap, t: `translate(${ox + w} ${oy}) scale(-1 -1)` },
    { key: 'bottom', d: bottomFlap, t: `translate(${ox + w} ${oy + h * 2}) scale(-1 -1)` },
    { key: 'left', d: leftFlap, t: `translate(${ox - w} ${oy})` },
    { key: 'right', d: rightFlap, t: `translate(${ox + w} ${oy})` },
  ];
  const glue = `M${ox + 4} ${oy + h + 3} L${ox + 8} ${oy + h + bottom * 0.75} M${ox + w - 4} ${oy + h + 3} L${ox + w - 8} ${oy + h + bottom * 0.75}`;
  return (
    <g>
      <defs>
        {flaps.map((f) => (
          <clipPath key={f.key} id={`${id}-${f.key}`}>
            <path d={f.d} />
          </clipPath>
        ))}
      </defs>
      {flaps.map((f) => (
        <g key={f.key} clipPath={`url(#${id}-${f.key})`}>
          <g transform={f.t}>
            <PaperBackground id={`${id}-${f.key}-p`} w={w} h={h} paper={env.back.paper} />
            <LayoutContent layout={env.back} ctx={{ ...ctx, idPrefix: `${ctx.idPrefix}-${f.key}` }} background={false} />
          </g>
        </g>
      ))}
      <g transform={`translate(${ox} ${oy})`}>
        <LayoutContent layout={env.front} ctx={{ ...ctx, idPrefix: `${ctx.idPrefix}-front` }} />
      </g>
      {marks && (
        <g fill="none">
          {flaps.map((f) => (
            <path key={f.key} d={f.d} stroke="#222" strokeWidth={0.25} />
          ))}
          <rect x={ox} y={oy} width={w} height={h} stroke="#666" strokeWidth={0.25} strokeDasharray="2 1.2" />
          <path d={glue} stroke="#9a7b4f" strokeWidth={2.2} strokeOpacity={0.25} strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}
