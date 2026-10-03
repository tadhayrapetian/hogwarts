import type { CSSProperties } from 'react';
import type { Asset, Character, EnvelopeDesign, House, Layout, Postmark, Seal, Stamp } from '../core/types';
import type { RenderCtx } from '../render/context';
import { CrestArt, SchoolCrestArt } from '../render/crest';
import { EnvelopeBackArt } from '../render/envelope';
import { LayoutSVG } from '../render/LayoutSVG';
import { PostmarkArt, postmarkBox } from '../render/postmark';
import { SealArt } from '../render/seal';
import { StampArt } from '../render/stamp';
import { SymbolGlyph } from '../render/symbols';

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

/** Standalone SVG wrappers for showing design items inside the UI. */

export function StampView({ stamp, height = 90, asset, style }: { stamp: Stamp; height?: number; asset?: Asset; style?: CSSProperties }) {
  const w = (stamp.w / stamp.h) * height;
  return (
    <svg viewBox={`-1 -1 ${stamp.w + 2} ${stamp.h + 2}`} width={w} height={height} style={style} aria-label={stamp.name} role="img">
      <StampArt stamp={stamp} uid={nextId('st')} asset={asset} />
    </svg>
  );
}

export function SealView({ seal, size = 80, style }: { seal: Seal; size?: number; style?: CSSProperties }) {
  return (
    <svg viewBox="-6 -6 112 120" width={size} height={size * 1.07} style={style} aria-label={seal.name} role="img">
      <SealArt seal={seal} uid={nextId('se')} box={{ x: 0, y: 0, w: 100, h: 100 }} />
    </svg>
  );
}

export function PostmarkView({ pm, height = 80, date, style }: { pm: Postmark; height?: number; date?: string; style?: CSSProperties }) {
  const [W, H] = postmarkBox(pm);
  return (
    <svg viewBox={`${-W * 0.08} ${-H * 0.08} ${W * 1.16} ${H * 1.16}`} height={height} width={(W / H) * height} style={style} aria-label={pm.name} role="img">
      <PostmarkArt pm={pm} uid={nextId('pm')} date={date} />
    </svg>
  );
}

export function CrestView({ house, height = 80, showName = true }: { house: House; height?: number; showName?: boolean }) {
  return (
    <svg viewBox="0 0 100 120" height={height} width={(height * 100) / 120} role="img" aria-label={house.name}>
      <CrestArt house={house} uid={nextId('cr')} showName={showName} />
    </svg>
  );
}

export function SchoolCrestView({ houses, motto, height = 80 }: { houses: House[]; motto: string; height?: number }) {
  return (
    <svg viewBox="0 0 100 120" height={height} width={(height * 100) / 120} role="img" aria-label="crest">
      <SchoolCrestArt houses={houses} motto={motto} uid={nextId('sc')} />
    </svg>
  );
}

export function LayoutView({ layout, ctx, width, height, className, style }: { layout: Layout; ctx: RenderCtx; width?: number | string; height?: number | string; className?: string; style?: CSSProperties }) {
  return <LayoutSVG layout={layout} ctx={{ ...ctx, idPrefix: nextId(ctx.idPrefix) }} width={width} height={height} className={className} style={style} />;
}

export function EnvelopeBackView({ env, ctx, width, height, style }: { env: EnvelopeDesign; ctx: RenderCtx; width?: number | string; height?: number | string; style?: CSSProperties }) {
  return (
    <svg viewBox={`0 0 ${env.back.w} ${env.back.h}`} width={width} height={height} style={style}>
      <EnvelopeBackArt env={env} ctx={{ ...ctx, idPrefix: nextId('eb') }} />
    </svg>
  );
}

export function HouseChip({ house }: { house?: House }) {
  if (!house) return <span className="muted">—</span>;
  return (
    <span className="row gap-4" style={{ display: 'inline-flex' }}>
      <span className="swatch" style={{ background: house.primaryColor, borderColor: house.secondaryColor }} />
      {house.name}
    </span>
  );
}

export function Portrait({ character, assets, size = 56 }: { character: Character; assets?: Map<string, Asset>; size?: number }) {
  const a = character.portraitAssetId ? assets?.get(character.portraitAssetId) : undefined;
  if (a)
    return <img src={a.dataUrl} alt={character.name} width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--accent)' }} />;
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} role="img" aria-label={character.name}>
      <circle cx={30} cy={30} r={29} fill={character.portraitColor} stroke="#d4b06a" strokeWidth={2} />
      <circle cx={30} cy={30} r={24} fill="none" stroke="#d4b06a" strokeWidth={0.6} opacity={0.6} />
      <SymbolGlyph symbol={character.portraitSymbol || 'owl'} x={16} y={15} size={28} color="#f3e3c0" strokeWidth={1.6} />
    </svg>
  );
}
