import { forwardRef, type ReactNode, type SVGProps } from 'react';
import { renderTemplate } from '../core/template';
import type { DesignEl, Layout, TextEl } from '../core/types';
import { BarcodeArt } from './barcode';
import { resolveCharacter, resolveHouse, resolvePostmark, resolveSeal, resolveStamp, type RenderCtx } from './context';
import { CrestArt, SchoolCrestArt } from './crest';
import { fontStack } from './fonts';
import { PageBorder, PaperBackground, Watermark } from './paper';
import { PostmarkArt } from './postmark';
import { SealArt } from './seal';
import { StampArt } from './stamp';
import { SymbolGlyph } from './symbols';
import { browserMeasure, layoutTextFit } from './textLayout';

function Placeholder({ el, label }: { el: DesignEl; label: string }) {
  return (
    <g>
      <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="#b08d57" fillOpacity={0.08} stroke="#b08d57" strokeWidth={0.3} strokeDasharray="1.2 0.8" />
      <text x={el.x + el.w / 2} y={el.y + el.h / 2} textAnchor="middle" dominantBaseline="middle" fontFamily="Inter, sans-serif" fontSize={Math.min(3, el.h / 3)} fill="#8a6a35">
        {label}
      </text>
    </g>
  );
}

export function TextElement({ el, ctx }: { el: TextEl; ctx: RenderCtx }) {
  const text = renderTemplate(el.text, ctx.vars, !!ctx.editor && false);
  const res = layoutTextFit(el, text, ctx.measure ?? browserMeasure);
  const stack = fontStack(el.font);
  const valign = el.valign ?? 'top';
  const offY = valign === 'middle' ? (el.h - res.height) / 2 : valign === 'bottom' ? el.h - res.height : 0;
  const ls = (el.letterSpacing ?? 0) * res.fontSize;
  const mirror = el.transform === 'mirror';
  return (
    <g transform={mirror ? `translate(${el.x * 2 + el.w} 0) scale(-1 1)` : undefined}>
      {res.dropCap && (
        <text
          x={el.x + res.dropCap.x}
          y={el.y + offY + res.dropCap.y}
          fontFamily={`'Cinzel', ${stack}`}
          fontSize={res.dropCap.size}
          fontWeight={700}
          fill={el.dropCapColor || el.color}
        >
          {res.dropCap.char}
        </text>
      )}
      <text fontFamily={stack} fontSize={res.fontSize} fontWeight={el.weight} fontStyle={el.italic ? 'italic' : undefined} fill={el.color} letterSpacing={ls || undefined}>
        {res.lines.map((line, li) =>
          line.runs.map((run, ri) => (
            <tspan
              key={`${li}-${ri}`}
              x={(el.x + run.x).toFixed(3)}
              y={(el.y + offY + line.y).toFixed(3)}
              fontWeight={run.bold ? 700 : undefined}
              fontStyle={run.italic ? (el.italic ? 'normal' : 'italic') : undefined}
            >
              {run.text}
            </tspan>
          )),
        )}
      </text>
      {ctx.editor && res.overflow && <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="none" stroke="#c0392b" strokeWidth={0.35} strokeDasharray="1 0.6" />}
    </g>
  );
}

function SignatureElement({ el, ctx }: { el: Extract<DesignEl, { type: 'signature' }>; ctx: RenderCtx }) {
  const ch = resolveCharacter(el.characterRef, ctx);
  if (!ch) return ctx.editor ? <Placeholder el={el} label="Signature" /> : null;
  const lines = (el.showName ? 1 : 0) + (el.showTitle ? 1 : 0);
  const sigH = el.h * (lines ? (lines === 2 ? 0.58 : 0.7) : 1);
  const font = fontStack(ch.signatureFont);
  const size = Math.min(sigH * 0.8, (el.w * 1.6) / Math.max(5, ch.signatureText.length));
  const small = Math.min(3.6, (el.h - sigH) / Math.max(1, lines) * 0.62);
  const cx = el.x + el.w / 2;
  const baseY = el.y + sigH * 0.78;
  return (
    <g>
      <text x={cx} y={baseY} textAnchor="middle" fontFamily={font} fontSize={size} fill={ch.signatureColor}>
        {ch.signatureText}
      </text>
      <path
        d={`M${cx - el.w * 0.32} ${baseY + size * 0.18} C${cx - el.w * 0.1} ${baseY + size * 0.32} ${cx + el.w * 0.12} ${baseY + size * 0.05} ${cx + el.w * 0.34} ${baseY + size * 0.22}`}
        fill="none"
        stroke={ch.signatureColor}
        strokeWidth={0.32}
        strokeLinecap="round"
        opacity={0.85}
      />
      {el.showName && (
        <text x={cx} y={el.y + sigH + small * 1.25} textAnchor="middle" fontFamily={fontStack('garamond')} fontSize={small} fontWeight={600} fill="#3b2a1a">
          {ch.name}
        </text>
      )}
      {el.showTitle && (
        <text x={cx} y={el.y + sigH + small * (el.showName ? 2.55 : 1.25)} textAnchor="middle" fontFamily={fontStack('garamond')} fontSize={small * 0.88} fontStyle="italic" fill="#5a4630">
          {ch.title}
        </text>
      )}
    </g>
  );
}

function Divider({ el }: { el: Extract<DesignEl, { type: 'divider' }> }) {
  const y = el.y + el.h / 2;
  const { x, w, color, thickness: t } = el;
  switch (el.style) {
    case 'double':
      return (
        <g stroke={color}>
          <line x1={x} x2={x + w} y1={y - t * 1.2} y2={y - t * 1.2} strokeWidth={t} />
          <line x1={x} x2={x + w} y1={y + t * 1.2} y2={y + t * 1.2} strokeWidth={t * 0.6} />
        </g>
      );
    case 'dotted':
      return <line x1={x} x2={x + w} y1={y} y2={y} stroke={color} strokeWidth={t * 1.4} strokeDasharray={`0 ${t * 3.5}`} strokeLinecap="round" />;
    case 'diamond':
      return (
        <g stroke={color} fill={color}>
          <line x1={x} x2={x + w / 2 - 2.5} y1={y} y2={y} strokeWidth={t} />
          <line x1={x + w / 2 + 2.5} x2={x + w} y1={y} y2={y} strokeWidth={t} />
          <rect x={x + w / 2 - 1.3} y={y - 1.3} width={2.6} height={2.6} transform={`rotate(45 ${x + w / 2} ${y})`} />
        </g>
      );
    case 'ornament': {
      const c = x + w / 2;
      return (
        <g stroke={color} fill="none" strokeWidth={t} strokeLinecap="round">
          <line x1={x} x2={c - 9} y1={y} y2={y} />
          <line x1={c + 9} x2={x + w} y1={y} y2={y} />
          <path d={`M${c - 9} ${y} C${c - 6} ${y - 3} ${c - 3} ${y - 3} ${c} ${y} C${c + 3} ${y + 3} ${c + 6} ${y + 3} ${c + 9} ${y}`} />
          <path d={`M${c - 9} ${y} C${c - 6} ${y + 3} ${c - 3} ${y + 3} ${c} ${y} C${c + 3} ${y - 3} ${c + 6} ${y - 3} ${c + 9} ${y}`} />
          <circle cx={c} cy={y} r={0.9} fill={color} />
        </g>
      );
    }
    case 'flourish': {
      const c = x + w / 2;
      return (
        <g stroke={color} fill="none" strokeWidth={t} strokeLinecap="round">
          <path d={`M${x} ${y} Q${x + w * 0.25} ${y - 2.5} ${c - 4} ${y} T${c} ${y}`} />
          <path d={`M${x + w} ${y} Q${x + w * 0.75} ${y - 2.5} ${c + 4} ${y} T${c} ${y}`} />
          <circle cx={c} cy={y - 2.4} r={1.1} />
          <path d={`M${c - 2} ${y + 1.5} q2 1.8 4 0`} />
        </g>
      );
    }
    default:
      return <line x1={x} x2={x + w} y1={y} y2={y} stroke={color} strokeWidth={t} />;
  }
}

function Shape({ el }: { el: Extract<DesignEl, { type: 'shape' }> }) {
  const common = { fill: el.fill || 'none', stroke: el.stroke || 'none', strokeWidth: el.strokeWidth, strokeDasharray: el.dashed ? `${el.strokeWidth * 4} ${el.strokeWidth * 3}` : undefined };
  switch (el.shape) {
    case 'ellipse':
      return <ellipse cx={el.x + el.w / 2} cy={el.y + el.h / 2} rx={el.w / 2} ry={el.h / 2} {...common} />;
    case 'roundrect':
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={Math.min(el.w, el.h) * 0.12} {...common} />;
    case 'banner': {
      const n = Math.min(el.h * 0.5, el.w * 0.08);
      return (
        <path
          d={`M${el.x} ${el.y} H${el.x + el.w} L${el.x + el.w - n} ${el.y + el.h / 2} L${el.x + el.w} ${el.y + el.h} H${el.x} L${el.x + n} ${el.y + el.h / 2} Z`}
          {...common}
        />
      );
    }
    case 'ornateframe': {
      const c = Math.min(el.w, el.h) * 0.12;
      const { x, y, w, h } = el;
      return (
        <g>
          <path d={`M${x + c} ${y} H${x + w - c} A${c} ${c} 0 0 0 ${x + w} ${y + c} V${y + h - c} A${c} ${c} 0 0 0 ${x + w - c} ${y + h} H${x + c} A${c} ${c} 0 0 0 ${x} ${y + h - c} V${y + c} A${c} ${c} 0 0 0 ${x + c} ${y} Z`} {...common} />
          <rect x={x + c * 0.45} y={y + c * 0.45} width={w - c * 0.9} height={h - c * 0.9} fill="none" stroke={el.stroke} strokeWidth={el.strokeWidth * 0.5} />
        </g>
      );
    }
    default:
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} {...common} />;
  }
}

export function ElementView({ el, ctx }: { el: DesignEl; ctx: RenderCtx }) {
  const uid = `${ctx.idPrefix}-${el.id.slice(0, 8)}`;
  const box = { x: el.x, y: el.y, w: el.w, h: el.h };
  switch (el.type) {
    case 'text':
      return <TextElement el={el} ctx={ctx} />;
    case 'image': {
      const a = el.assetId ? ctx.lib.assets.get(el.assetId) : undefined;
      if (!a) return ctx.editor ? <Placeholder el={el} label="Image" /> : null;
      return (
        <image
          href={a.dataUrl}
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          preserveAspectRatio={el.fit === 'stretch' ? 'none' : el.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
          filter={el.filter && el.filter !== 'none' ? `url(#${ctx.idPrefix}-${el.filter})` : undefined}
        />
      );
    }
    case 'signature':
      return <SignatureElement el={el} ctx={ctx} />;
    case 'seal': {
      const s = resolveSeal(el.sealRef, ctx);
      if (!s) return ctx.editor ? <Placeholder el={el} label="Seal" /> : null;
      return <SealArt seal={s} uid={uid} box={box} />;
    }
    case 'stamp': {
      const s = resolveStamp(el.stampRef, ctx);
      if (!s) return ctx.editor ? <Placeholder el={el} label="Stamp" /> : null;
      return <StampArt stamp={s} uid={uid} box={box} asset={s.assetId ? ctx.lib.assets.get(s.assetId) : undefined} />;
    }
    case 'postmark': {
      const p = resolvePostmark(el.postmarkRef, ctx);
      if (!p) return ctx.editor ? <Placeholder el={el} label="Postmark" /> : null;
      const date = p.dateSource === 'ship' ? ctx.refs.shipDate ?? ctx.refs.postmarkDate : ctx.refs.postmarkDate;
      return <PostmarkArt pm={p} uid={uid} box={box} date={date} locale={ctx.locale} />;
    }
    case 'badge': {
      const h = resolveHouse(el.houseRef, ctx);
      if (h === 'school')
        return <SchoolCrestArt houses={ctx.lib.houseList} motto={ctx.lib.settings?.company.motto ?? ''} uid={uid} box={box} showName={el.showName} />;
      if (!h) return ctx.editor ? <Placeholder el={el} label="Crest" /> : <SchoolCrestArt houses={ctx.lib.houseList} motto={ctx.lib.settings?.company.motto ?? ''} uid={uid} box={box} showName={el.showName} />;
      return <CrestArt house={h} uid={uid} box={box} showName={el.showName} />;
    }
    case 'symbol': {
      const size = Math.min(el.w, el.h);
      return <SymbolGlyph symbol={el.symbol} x={el.x + (el.w - size) / 2} y={el.y + (el.h - size) / 2} size={size} color={el.color} strokeWidth={el.strokeWidth} />;
    }
    case 'divider':
      return <Divider el={el} />;
    case 'shape':
      return <Shape el={el} />;
    case 'barcode': {
      const value = renderTemplate(el.value, ctx.vars) || (ctx.editor ? 'SAMPLE123' : '');
      if (!value) return null;
      return (
        <g transform={`translate(${el.x} ${el.y})`}>
          <BarcodeArt value={value} w={el.w} h={el.h} color={el.color} showText={el.showText} />
        </g>
      );
    }
  }
}

export function ElementFrame({ el, ctx }: { el: DesignEl; ctx: RenderCtx }) {
  if (el.hidden) return null;
  const rot = el.rotation ? `rotate(${el.rotation} ${el.x + el.w / 2} ${el.y + el.h / 2})` : undefined;
  return (
    <g transform={rot} opacity={el.opacity ?? 1} data-el={el.id}>
      <ElementView el={el} ctx={ctx} />
    </g>
  );
}

/** Background, border, watermark and all elements – embeddable inside any SVG. */
export function LayoutContent({ layout, ctx, background = true }: { layout: Layout; ctx: RenderCtx; background?: boolean }) {
  const p = ctx.idPrefix;
  const wmHouse = layout.watermark.kind === 'badge' ? resolveHouse(layout.watermark.value || '$school', ctx) : undefined;
  const wmBadge =
    layout.watermark.kind === 'badge'
      ? (box: { x: number; y: number; w: number; h: number }) =>
          wmHouse && wmHouse !== 'school' ? (
            <CrestArt house={wmHouse} uid={`${p}-wm`} showName={false} box={box} />
          ) : (
            <SchoolCrestArt houses={ctx.lib.houseList} motto="" uid={`${p}-wm`} showName={false} box={box} />
          )
      : null;
  return (
    <g>
      <defs>
        <filter id={`${p}-sepia`}>
          <feColorMatrix type="matrix" values="0.39 0.77 0.19 0 0  0.35 0.69 0.17 0 0  0.27 0.53 0.13 0 0  0 0 0 1 0" />
        </filter>
        <filter id={`${p}-grayscale`}>
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>
      {background && <PaperBackground id={`${p}-paper`} w={layout.w} h={layout.h} paper={layout.paper} />}
      <Watermark w={layout.w} h={layout.h} wm={layout.watermark} badge={wmBadge} />
      <PageBorder w={layout.w} h={layout.h} border={layout.border} />
      {layout.elements.map((el) => (
        <ElementFrame key={el.id} el={el} ctx={ctx} />
      ))}
    </g>
  );
}

type SvgProps = Omit<SVGProps<SVGSVGElement>, 'ref'>;

/** Stand-alone SVG of a layout. `children` are drawn on top (editor overlays). */
export const LayoutSVG = forwardRef<SVGSVGElement, { layout: Layout; ctx: RenderCtx; children?: ReactNode; background?: boolean } & SvgProps>(function LayoutSVG(
  { layout, ctx, children, background, ...rest },
  ref,
) {
  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${layout.w} ${layout.h}`} {...rest}>
      <LayoutContent layout={layout} ctx={ctx} background={background} />
      {children}
    </svg>
  );
});
