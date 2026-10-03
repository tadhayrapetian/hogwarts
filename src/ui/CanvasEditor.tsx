import {
  ArrowDown,
  ArrowUp,
  Barcode,
  BringToFront,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Grid3x3,
  Image as ImageIcon,
  Lock,
  Maximize,
  Minus,
  PenLine,
  Redo2,
  SendToBack,
  Shield,
  Sparkles,
  Square,
  Stamp as StampIcon,
  Trash2,
  Type,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { PAPER_COLORS, paperStyle } from '../core/defaults';
import { ALL_VARIABLES, VARIABLE_GROUPS } from '../core/template';
import { BORDER_STYLES, FONT_KEYS, PAPER_KINDS, type DesignEl, type DesignElType, type Layout, type PaperKind, type TextEl } from '../core/types';
import { clone, readFileAsDataURL, round, uid } from '../core/util';
import { saveAsset } from '../db/services';
import { useFeedback } from '../app/feedback';
import { useI18n } from '../i18n';
import type { RenderCtx } from '../render/context';
import { ELEMENT_TYPES, newElement } from '../render/elements';
import { FONTS } from '../render/fonts';
import { LayoutSVG } from '../render/LayoutSVG';
import { SYMBOLS, SymbolGlyph } from '../render/symbols';
import { ColorInput, Field, NumberInput, Range, Toggle } from './kit';

const TYPE_ICONS: Record<DesignElType, ReactNode> = {
  text: <Type />,
  image: <ImageIcon />,
  signature: <PenLine />,
  seal: <Circle />,
  stamp: <StampIcon />,
  postmark: <Grid3x3 />,
  badge: <Shield />,
  symbol: <Sparkles />,
  divider: <Minus />,
  shape: <Square />,
  barcode: <Barcode />,
};

export const PAGE_PRESETS: { key: string; w: number; h: number }[] = [
  { key: 'A4', w: 210, h: 297 },
  { key: 'A5', w: 148, h: 210 },
  { key: 'A6', w: 105, h: 148 },
  { key: 'Letter', w: 215.9, h: 279.4 },
  { key: 'DL', w: 99, h: 210 },
  { key: 'Square', w: 150, h: 150 },
  { key: 'Card', w: 85.6, h: 54 },
  { key: 'Postcard', w: 148, h: 105 },
];

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

interface DragState {
  mode: 'move' | 'resize';
  handle?: Handle;
  id: string;
  start: { x: number; y: number };
  orig: DesignEl;
  snapshot: Layout;
  moved: boolean;
}

export interface CanvasEditorProps {
  layout: Layout;
  onChange: (l: Layout) => void;
  ctx: RenderCtx;
  overlay?: ReactNode;
  lockSize?: boolean;
  allowed?: DesignElType[];
  toolbarExtra?: ReactNode;
  className?: string;
}

export function VariablePicker({ onPick }: { onPick: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <select
      className="select sm"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
      aria-label={t('editor.insertVariable')}
    >
      <option value="">{t('editor.insertVariable')}…</option>
      {VARIABLE_GROUPS.map((g) => (
        <optgroup key={g.group} label={t(`vargroup.${g.group}`)}>
          {g.keys.map((k) => (
            <option key={k} value={k}>
              {`{{${k}}}`} — {t(`var.${k}`)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function CanvasEditor({ layout, onChange, ctx, overlay, lockSize, allowed = ELEMENT_TYPES, toolbarExtra, className = '' }: CanvasEditorProps) {
  const { t } = useI18n();
  const { toast, contextMenu } = useFeedback();
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [fitZoom, setFitZoom] = useState(2.5);
  const [guides, setGuides] = useState(true);
  const [snapLines, setSnapLines] = useState<{ x?: number; y?: number }>({});
  const undo = useRef<Layout[]>([]);
  const redo = useRef<Layout[]>([]);
  const drag = useRef<DragState | null>(null);
  const clipboard = useRef<DesignEl | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [, force] = useState(0);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const scale = zoom === 'fit' ? fitZoom : zoom;
  const selected = layout.elements.find((e) => e.id === sel) ?? null;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - 80;
      const h = el.clientHeight - 110;
      setFitZoom(Math.max(0.4, Math.min(8, Math.min(w / layout.w, h / layout.h))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.w, layout.h]);

  const commit = useCallback(
    (next: Layout, snapshot?: Layout) => {
      undo.current.push(snapshot ?? layoutRef.current);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
      onChange(next);
      force((n) => n + 1);
    },
    [onChange],
  );

  const updateEl = useCallback(
    (id: string, patch: Partial<DesignEl>, live = false) => {
      const next = { ...layoutRef.current, elements: layoutRef.current.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignEl) : e)) };
      if (live) onChange(next);
      else commit(next);
    },
    [commit, onChange],
  );

  const setLayout = (patch: Partial<Layout>) => commit({ ...layoutRef.current, ...patch });

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(layoutRef.current);
    onChange(prev);
    force((n) => n + 1);
  };
  const doRedo = () => {
    const nx = redo.current.pop();
    if (!nx) return;
    undo.current.push(layoutRef.current);
    onChange(nx);
    force((n) => n + 1);
  };

  const add = (type: DesignElType) => {
    const el = newElement(type, layout);
    commit({ ...layout, elements: [...layout.elements, el] });
    setSel(el.id);
  };
  const remove = (id: string) => {
    commit({ ...layout, elements: layout.elements.filter((e) => e.id !== id) });
    setSel(null);
  };
  const duplicate = (id: string) => {
    const e = layout.elements.find((x) => x.id === id);
    if (!e) return;
    const copy = { ...clone(e), id: uid(), x: e.x + 4, y: e.y + 4, locked: false };
    commit({ ...layout, elements: [...layout.elements, copy] });
    setSel(copy.id);
  };
  const reorder = (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => {
    const els = [...layout.elements];
    const i = els.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [e] = els.splice(i, 1);
    const j = dir === 'top' ? els.length : dir === 'bottom' ? 0 : dir === 'up' ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
    els.splice(j, 0, e);
    commit({ ...layout, elements: els });
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if (!canvasRef.current?.closest('.editor')?.contains(document.activeElement) && document.activeElement !== document.body) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doRedo();
        return;
      }
      if (!sel) return;
      const el = layoutRef.current.elements.find((x) => x.id === sel);
      if (!el) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(sel);
      } else if (e.key === 'Escape') setSel(null);
      else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate(sel);
      } else if (mod && e.key.toLowerCase() === 'c') clipboard.current = clone(el);
      else if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
        const copy = { ...clone(clipboard.current), id: uid(), x: clipboard.current.x + 5, y: clipboard.current.y + 5 };
        commit({ ...layoutRef.current, elements: [...layoutRef.current.elements, copy] });
        setSel(copy.id);
      } else if (e.key.startsWith('Arrow') && !el.locked) {
        e.preventDefault();
        const d = e.shiftKey ? 5 : 0.5;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        updateEl(sel, { x: round(el.x + dx, 1), y: round(el.y + dy, 1) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toMM = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const startDrag = (e: RPointerEvent, id: string, mode: DragState['mode'], handle?: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    setSel(id);
    (e.currentTarget as Element).closest('.editor')?.querySelector<HTMLElement>('.editor-canvas')?.focus({ preventScroll: true });
    const el = layoutRef.current.elements.find((x) => x.id === id);
    if (!el || (el.locked && mode === 'move') || el.locked) {
      drag.current = null;
      return;
    }
    drag.current = { mode, handle, id, start: toMM(e.clientX, e.clientY), orig: clone(el), snapshot: layoutRef.current, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toMM(e.clientX, e.clientY);
    let dx = p.x - d.start.x;
    let dy = p.y - d.start.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 0.4) return;
    d.moved = true;
    const o = d.orig;
    const L = layoutRef.current;
    const snap = (v: number) => Math.round(v * 2) / 2;
    if (d.mode === 'move') {
      let x = snap(o.x + dx);
      let y = snap(o.y + dy);
      const lines: { x?: number; y?: number } = {};
      const cx = x + o.w / 2;
      const cy = y + o.h / 2;
      const thr = 1.5;
      if (Math.abs(cx - L.w / 2) < thr) {
        x = L.w / 2 - o.w / 2;
        lines.x = L.w / 2;
      } else if (Math.abs(x - L.margins.left) < thr) {
        x = L.margins.left;
        lines.x = x;
      } else if (Math.abs(x + o.w - (L.w - L.margins.right)) < thr) {
        x = L.w - L.margins.right - o.w;
        lines.x = L.w - L.margins.right;
      }
      if (Math.abs(cy - L.h / 2) < thr) {
        y = L.h / 2 - o.h / 2;
        lines.y = L.h / 2;
      } else if (Math.abs(y - L.margins.top) < thr) {
        y = L.margins.top;
        lines.y = y;
      }
      setSnapLines(lines);
      updateEl(d.id, { x: round(x, 2), y: round(y, 2) }, true);
      return;
    }
    const h = d.handle!;
    if (h === 'rot') {
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      let ang = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      else ang = Math.round(ang);
      if (Math.abs(ang) < 2 || Math.abs(ang - 360) < 2) ang = 0;
      updateEl(d.id, { rotation: ((ang + 540) % 360) - 180 }, true);
      return;
    }
    let { x, y, w, h: hh } = o;
    if (h.includes('e')) w = Math.max(2, o.w + dx);
    if (h.includes('s')) hh = Math.max(2, o.h + dy);
    if (h.includes('w')) {
      w = Math.max(2, o.w - dx);
      x = o.x + o.w - w;
    }
    if (h.includes('n')) {
      hh = Math.max(2, o.h - dy);
      y = o.y + o.h - hh;
    }
    const keepRatio = e.shiftKey || ['seal', 'stamp', 'postmark', 'badge', 'symbol'].includes(o.type);
    if (keepRatio && h.length === 2) {
      const r = o.w / o.h;
      if (w / hh > r) w = hh * r;
      else hh = w / r;
      if (h.includes('w')) x = o.x + o.w - w;
      if (h.includes('n')) y = o.y + o.h - hh;
    }
    dx = 0;
    dy = 0;
    updateEl(d.id, { x: round(x, 2), y: round(y, 2), w: round(w, 2), h: round(hh, 2) }, true);
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    setSnapLines({});
    if (d?.moved) {
      undo.current.push(d.snapshot);
      redo.current = [];
      force((n) => n + 1);
    }
  };

  const onCanvasContext = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setSel(id);
    const el = layout.elements.find((x) => x.id === id);
    contextMenu(e, [
      { label: t('editor.duplicate'), icon: <Copy />, onClick: () => duplicate(id) },
      { label: t('editor.bringFront'), icon: <BringToFront />, onClick: () => reorder(id, 'top') },
      { label: t('editor.sendBack'), icon: <SendToBack />, onClick: () => reorder(id, 'bottom') },
      { label: el?.locked ? t('editor.unlock') : t('editor.lock'), icon: el?.locked ? <Unlock /> : <Lock />, onClick: () => updateEl(id, { locked: !el?.locked }) },
      { divider: true, label: '' },
      { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => remove(id) },
    ]);
  };

  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const hpos = (h: Handle, el: DesignEl) => {
    const x = h.includes('w') ? el.x : h.includes('e') ? el.x + el.w : el.x + el.w / 2;
    const y = h.includes('n') ? el.y : h.includes('s') ? el.y + el.h : el.y + el.h / 2;
    return { x, y };
  };
  const hs = 8 / scale;
  const cursor: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab' };

  return (
    <div className={`editor ${className}`}>
      <div className="editor-tools" role="toolbar" aria-label={t('editor.addElement')}>
        {allowed.map((type) => (
          <button key={type} onClick={() => add(type)} title={t(`el.${type}`)} aria-label={t(`el.${type}`)}>
            {TYPE_ICONS[type]}
          </button>
        ))}
      </div>
      <div className="editor-canvas" ref={canvasRef} tabIndex={0} onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setZoom(Math.max(0.3, Math.min(12, scale * (e.deltaY < 0 ? 1.1 : 0.9))));
        }
      }}>
        <div className="editor-bar">
          <button className="btn icon sm ghost" onClick={doUndo} disabled={!undo.current.length} title={`${t('editor.undo')} (Ctrl+Z)`}>
            <Undo2 />
          </button>
          <button className="btn icon sm ghost" onClick={doRedo} disabled={!redo.current.length} title={`${t('editor.redo')} (Ctrl+Y)`}>
            <Redo2 />
          </button>
          <span className="divider-v" />
          <button className="btn icon sm ghost" onClick={() => setZoom(Math.max(0.3, scale / 1.2))} title={t('editor.zoomOut')}>
            <ZoomOut />
          </button>
          <span className="small num" style={{ minWidth: 44, textAlign: 'center' }}>
            {Math.round((scale / 3.78) * 100)}%
          </span>
          <button className="btn icon sm ghost" onClick={() => setZoom(Math.min(12, scale * 1.2))} title={t('editor.zoomIn')}>
            <ZoomIn />
          </button>
          <button className="btn icon sm ghost" onClick={() => setZoom('fit')} title={t('editor.fit')}>
            <Maximize />
          </button>
          <span className="divider-v" />
          <Toggle checked={guides} onChange={setGuides} label={<span className="small">{t('editor.guides')}</span>} />
          <span className="grow" />
          <span className="small muted">
            {round(layout.w, 1)} × {round(layout.h, 1)} mm
          </span>
          {toolbarExtra}
        </div>
        <div className="stage" onPointerDown={() => setSel(null)}>
          <LayoutSVG
            ref={svgRef}
            layout={layout}
            ctx={ctx}
            className="page"
            width={layout.w * scale}
            height={layout.h * scale}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {overlay}
            {guides && (
              <rect
                x={layout.margins.left}
                y={layout.margins.top}
                width={Math.max(0, layout.w - layout.margins.left - layout.margins.right)}
                height={Math.max(0, layout.h - layout.margins.top - layout.margins.bottom)}
                fill="none"
                stroke="#2f80ed"
                strokeOpacity={0.35}
                strokeWidth={0.6 / scale}
                strokeDasharray={`${4 / scale} ${3 / scale}`}
                pointerEvents="none"
              />
            )}
            {snapLines.x !== undefined && <line x1={snapLines.x} x2={snapLines.x} y1={0} y2={layout.h} stroke="#e0457b" strokeWidth={1 / scale} pointerEvents="none" />}
            {snapLines.y !== undefined && <line y1={snapLines.y} y2={snapLines.y} x1={0} x2={layout.w} stroke="#e0457b" strokeWidth={1 / scale} pointerEvents="none" />}
            {layout.elements.map((el) =>
              el.hidden ? null : (
                <rect
                  key={el.id}
                  x={el.x}
                  y={el.y}
                  width={Math.max(1, el.w)}
                  height={Math.max(1, el.h)}
                  fill="transparent"
                  stroke={el.id === sel ? 'none' : 'transparent'}
                  transform={el.rotation ? `rotate(${el.rotation} ${el.x + el.w / 2} ${el.y + el.h / 2})` : undefined}
                  style={{ cursor: el.locked ? 'default' : 'move' }}
                  onPointerDown={(e) => startDrag(e, el.id, 'move')}
                  onDoubleClick={() => el.type === 'text' && setTimeout(() => textRef.current?.focus(), 0)}
                  onContextMenu={(e) => onCanvasContext(e, el.id)}
                />
              ),
            )}
            {selected && !selected.hidden && (
              <g transform={selected.rotation ? `rotate(${selected.rotation} ${selected.x + selected.w / 2} ${selected.y + selected.h / 2})` : undefined}>
                <rect x={selected.x} y={selected.y} width={selected.w} height={selected.h} fill="none" stroke="#2f80ed" strokeWidth={1.2 / scale} pointerEvents="none" />
                {!selected.locked && (
                  <>
                    <line x1={selected.x + selected.w / 2} x2={selected.x + selected.w / 2} y1={selected.y} y2={selected.y - 18 / scale} stroke="#2f80ed" strokeWidth={1 / scale} />
                    <circle
                      cx={selected.x + selected.w / 2}
                      cy={selected.y - 18 / scale}
                      r={hs * 0.65}
                      fill="#fff"
                      stroke="#2f80ed"
                      strokeWidth={1.2 / scale}
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => startDrag(e, selected.id, 'resize', 'rot')}
                    />
                    {handles.map((h) => {
                      const p = hpos(h, selected);
                      return (
                        <rect
                          key={h}
                          x={p.x - hs / 2}
                          y={p.y - hs / 2}
                          width={hs}
                          height={hs}
                          fill="#fff"
                          stroke="#2f80ed"
                          strokeWidth={1.2 / scale}
                          style={{ cursor: cursor[h] }}
                          onPointerDown={(e) => startDrag(e, selected.id, 'resize', h)}
                        />
                      );
                    })}
                  </>
                )}
              </g>
            )}
          </LayoutSVG>
        </div>
      </div>
      <div className="editor-props">
        {selected ? (
          <ElementProps el={selected} layout={layout} ctx={ctx} onChange={(p, live) => updateEl(selected.id, p, live)} textRef={textRef}>
            <div className="row wrap">
              <button className="btn sm" onClick={() => duplicate(selected.id)} title="Ctrl+D">
                <Copy /> {t('editor.duplicate')}
              </button>
              <button className="btn sm icon" onClick={() => reorder(selected.id, 'up')} title={t('editor.forward')}>
                <ArrowUp />
              </button>
              <button className="btn sm icon" onClick={() => reorder(selected.id, 'down')} title={t('editor.backward')}>
                <ArrowDown />
              </button>
              <button className="btn sm icon" onClick={() => updateEl(selected.id, { locked: !selected.locked })} title={selected.locked ? t('editor.unlock') : t('editor.lock')}>
                {selected.locked ? <Lock /> : <Unlock />}
              </button>
              <button className="btn sm icon danger" onClick={() => remove(selected.id)} title={t('common.delete')}>
                <Trash2 />
              </button>
            </div>
          </ElementProps>
        ) : (
          <PageProps layout={layout} lockSize={lockSize} onChange={setLayout} />
        )}
        <div>
          <h4>{t('editor.layers')}</h4>
          <LayerList layout={layout} sel={sel} onSelect={setSel} onReorder={(els) => commit({ ...layout, elements: els })} onToggle={(id, patch) => updateEl(id, patch)} />
        </div>
        {!selected && (
          <div className="muted tiny">
            {t('editor.shortcuts')}: <kbd>Del</kbd> <kbd>Ctrl+D</kbd> <kbd>Ctrl+Z</kbd> <kbd>←↑→↓</kbd> <kbd>Shift</kbd>
          </div>
        )}
      </div>
    </div>
  );
}

function LayerList({ layout, sel, onSelect, onReorder, onToggle }: { layout: Layout; sel: string | null; onSelect: (id: string) => void; onReorder: (els: DesignEl[]) => void; onToggle: (id: string, p: Partial<DesignEl>) => void }) {
  const { t } = useI18n();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const list = [...layout.elements].reverse();
  return (
    <div className="layers">
      {list.map((el) => (
        <div
          key={el.id}
          className={`layer ${el.id === sel ? 'sel' : ''} ${over === el.id ? 'dragover' : ''}`}
          onClick={() => onSelect(el.id)}
          draggable
          onDragStart={() => setDragId(el.id)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(el.id);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={() => {
            setOver(null);
            if (!dragId || dragId === el.id) return;
            const els = [...layout.elements];
            const from = els.findIndex((x) => x.id === dragId);
            const [moved] = els.splice(from, 1);
            const to = els.findIndex((x) => x.id === el.id);
            els.splice(to + 1, 0, moved);
            onReorder(els);
            setDragId(null);
          }}
        >
          {TYPE_ICONS[el.type]}
          <span className="nm">{el.name || (el.type === 'text' ? (el as TextEl).text.split('\n')[0].slice(0, 40) || t('el.text') : t(`el.${el.type}`))}</span>
          <button className="btn ghost icon xs" onClick={(e) => (e.stopPropagation(), onToggle(el.id, { hidden: !el.hidden }))} aria-label={t('editor.visibility')}>
            {el.hidden ? <EyeOff /> : <Eye />}
          </button>
          {el.locked && <Lock />}
        </div>
      ))}
      {!list.length && <div className="muted small">{t('editor.noElements')}</div>}
    </div>
  );
}

function PageProps({ layout, onChange, lockSize }: { layout: Layout; onChange: (p: Partial<Layout>) => void; lockSize?: boolean }) {
  const { t } = useI18n();
  const preset = PAGE_PRESETS.find((p) => (Math.abs(p.w - layout.w) < 0.5 && Math.abs(p.h - layout.h) < 0.5) || (Math.abs(p.h - layout.w) < 0.5 && Math.abs(p.w - layout.h) < 0.5));
  return (
    <>
      <div>
        <h4>{t('editor.page')}</h4>
        {!lockSize && (
          <div className="prop-grid mt-8">
            <Field label={t('editor.size')} className="full">
              <div className="row">
                <select
                  className="select sm"
                  value={preset?.key ?? 'custom'}
                  onChange={(e) => {
                    const p = PAGE_PRESETS.find((x) => x.key === e.target.value);
                    if (p) onChange(layout.w > layout.h && p.h > p.w === false ? { w: p.h, h: p.w } : { w: p.w, h: p.h });
                  }}
                >
                  {PAGE_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key} ({p.w}×{p.h})
                    </option>
                  ))}
                  <option value="custom">{t('common.custom')}</option>
                </select>
                <button className="btn sm" onClick={() => onChange({ w: layout.h, h: layout.w })} title={t('editor.rotatePage')}>
                  ⟲
                </button>
              </div>
            </Field>
            <Field label="W (mm)">
              <NumberInput className="input sm" value={layout.w} onChange={(v) => v && onChange({ w: v })} min={20} max={600} />
            </Field>
            <Field label="H (mm)">
              <NumberInput className="input sm" value={layout.h} onChange={(v) => v && onChange({ h: v })} min={20} max={600} />
            </Field>
          </div>
        )}
      </div>
      <div>
        <h4>{t('editor.paper')}</h4>
        <div className="prop-grid mt-8">
          <Field label={t('editor.paperKind')}>
            <select className="select sm" value={layout.paper.kind} onChange={(e) => onChange({ paper: paperStyle(e.target.value as PaperKind, e.target.value === 'custom' ? { color: layout.paper.color } : {}) })}>
              {PAPER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`paper.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.color')}>
            <ColorInput value={layout.paper.color} onChange={(c) => onChange({ paper: { ...layout.paper, kind: c === PAPER_COLORS[layout.paper.kind] ? layout.paper.kind : 'custom', color: c } })} />
          </Field>
          <Field label={t('editor.texture')} className="full">
            <Range value={layout.paper.texture} min={0} max={1} step={0.05} onChange={(v) => onChange({ paper: { ...layout.paper, texture: v } })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Field label={t('editor.vignette')} className="full">
            <Range value={layout.paper.vignette} min={0} max={1} step={0.05} onChange={(v) => onChange({ paper: { ...layout.paper, vignette: v } })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <div className="full">
            <Toggle checked={layout.paper.stains} onChange={(v) => onChange({ paper: { ...layout.paper, stains: v } })} label={t('editor.stains')} />
          </div>
        </div>
      </div>
      <div>
        <h4>{t('editor.border')}</h4>
        <div className="prop-grid mt-8">
          <Field label={t('editor.style')}>
            <select className="select sm" value={layout.border.style} onChange={(e) => onChange({ border: { ...layout.border, style: e.target.value as Layout['border']['style'] } })}>
              {BORDER_STYLES.map((b) => (
                <option key={b} value={b}>
                  {t(`border.${b}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.color')}>
            <ColorInput value={layout.border.color} onChange={(c) => onChange({ border: { ...layout.border, color: c } })} />
          </Field>
          <Field label={t('editor.thickness')}>
            <NumberInput className="input sm" step={0.1} min={0.1} max={4} value={layout.border.width} onChange={(v) => onChange({ border: { ...layout.border, width: v ?? 0.5 } })} />
          </Field>
          <Field label={t('editor.inset')}>
            <NumberInput className="input sm" step={0.5} min={0} max={50} value={layout.border.inset} onChange={(v) => onChange({ border: { ...layout.border, inset: v ?? 0 } })} />
          </Field>
        </div>
      </div>
      <div>
        <h4>{t('editor.watermark')}</h4>
        <div className="prop-grid mt-8">
          <Field label={t('editor.kind')}>
            <select className="select sm" value={layout.watermark.kind} onChange={(e) => onChange({ watermark: { ...layout.watermark, kind: e.target.value as Layout['watermark']['kind'], value: e.target.value === 'symbol' ? 'owl' : e.target.value === 'badge' ? '$school' : layout.watermark.value } })}>
              {['none', 'symbol', 'text', 'badge'].map((k) => (
                <option key={k} value={k}>
                  {t(`watermark.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          {layout.watermark.kind === 'symbol' && (
            <Field label={t('el.symbol')}>
              <select className="select sm" value={layout.watermark.value} onChange={(e) => onChange({ watermark: { ...layout.watermark, value: e.target.value } })}>
                {SYMBOLS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {t(`symbol.${s.key}`)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {layout.watermark.kind === 'text' && (
            <Field label={t('editor.text')}>
              <input className="input sm" value={layout.watermark.value} onChange={(e) => onChange({ watermark: { ...layout.watermark, value: e.target.value } })} />
            </Field>
          )}
          {layout.watermark.kind !== 'none' && (
            <>
              <Field label={t('editor.color')}>
                <ColorInput value={layout.watermark.color} onChange={(c) => onChange({ watermark: { ...layout.watermark, color: c } })} />
              </Field>
              <Field label={t('editor.size')}>
                <NumberInput className="input sm" value={layout.watermark.size} min={10} max={400} onChange={(v) => onChange({ watermark: { ...layout.watermark, size: v ?? 100 } })} />
              </Field>
              <Field label={t('editor.opacity')} className="full">
                <Range value={layout.watermark.opacity} min={0.01} max={0.5} step={0.01} onChange={(v) => onChange({ watermark: { ...layout.watermark, opacity: v } })} format={(v) => `${Math.round(v * 100)}%`} />
              </Field>
              <Field label={t('editor.rotation')} className="full">
                <Range value={layout.watermark.rotation} min={-90} max={90} onChange={(v) => onChange({ watermark: { ...layout.watermark, rotation: v } })} format={(v) => `${v}°`} />
              </Field>
            </>
          )}
        </div>
      </div>
      <div>
        <h4>{t('editor.safeArea')}</h4>
        <div className="prop-grid mt-8">
          {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
            <Field key={k} label={t(`editor.margin_${k}`)}>
              <NumberInput className="input sm" value={layout.margins[k]} min={0} max={100} onChange={(v) => onChange({ margins: { ...layout.margins, [k]: v ?? 0 } })} />
            </Field>
          ))}
        </div>
      </div>
    </>
  );
}

function RefSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select className="select sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ElementProps({ el, layout, ctx, onChange, textRef, children }: { el: DesignEl; layout: Layout; ctx: RenderCtx; onChange: (p: Partial<DesignEl>, live?: boolean) => void; textRef: React.RefObject<HTMLTextAreaElement>; children: ReactNode }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const lib = ctx.lib;
  const insertVar = (v: string) => {
    if (el.type !== 'text' && el.type !== 'barcode') return;
    const ta = textRef.current;
    const token = `{{${v}}}`;
    const field = el.type === 'text' ? 'text' : 'value';
    const cur = el.type === 'text' ? el.text : el.value;
    if (ta && el.type === 'text') {
      const s = ta.selectionStart ?? cur.length;
      const e = ta.selectionEnd ?? cur.length;
      onChange({ [field]: cur.slice(0, s) + token + cur.slice(e) } as Partial<DesignEl>);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(s + token.length, s + token.length);
      }, 0);
    } else onChange({ [field]: cur + token } as Partial<DesignEl>);
  };
  const unknownVars = useMemo(() => {
    const text = el.type === 'text' ? el.text : el.type === 'barcode' ? el.value : '';
    return Array.from(text.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)/gi))
      .map((m) => m[1].toLowerCase())
      .filter((k) => !ALL_VARIABLES.includes(k));
  }, [el]);

  return (
    <>
      <div>
        <div className="row between">
          <h4>{t(`el.${el.type}`)}</h4>
        </div>
        <div className="prop-grid mt-8">
          <Field label={t('editor.name')} className="full">
            <input className="input sm" value={el.name ?? ''} placeholder={t(`el.${el.type}`)} onChange={(e) => onChange({ name: e.target.value })} />
          </Field>
          <Field label="X">
            <NumberInput className="input sm" step={0.5} value={round(el.x, 1)} onChange={(v) => onChange({ x: v ?? 0 })} />
          </Field>
          <Field label="Y">
            <NumberInput className="input sm" step={0.5} value={round(el.y, 1)} onChange={(v) => onChange({ y: v ?? 0 })} />
          </Field>
          <Field label="W">
            <NumberInput className="input sm" step={0.5} min={1} value={round(el.w, 1)} onChange={(v) => onChange({ w: Math.max(1, v ?? 1) })} />
          </Field>
          <Field label="H">
            <NumberInput className="input sm" step={0.5} min={1} value={round(el.h, 1)} onChange={(v) => onChange({ h: Math.max(1, v ?? 1) })} />
          </Field>
          <Field label={t('editor.rotation')}>
            <NumberInput className="input sm" min={-180} max={180} value={el.rotation ?? 0} onChange={(v) => onChange({ rotation: v ?? 0 })} />
          </Field>
          <Field label={t('editor.opacity')}>
            <NumberInput className="input sm" min={0} max={1} step={0.05} value={el.opacity ?? 1} onChange={(v) => onChange({ opacity: v ?? 1 })} />
          </Field>
          <div className="full row">
            <button className="btn xs" onClick={() => onChange({ x: round((layout.w - el.w) / 2, 2) })}>
              {t('editor.centerH')}
            </button>
            <button className="btn xs" onClick={() => onChange({ y: round((layout.h - el.h) / 2, 2) })}>
              {t('editor.centerV')}
            </button>
          </div>
        </div>
      </div>
      {el.type === 'text' && (
        <div className="prop-grid">
          <Field label={t('editor.text')} className="full" hint={t('editor.textHint')} warning={unknownVars.length ? t('editor.unknownVars', { vars: unknownVars.join(', ') }) : undefined}>
            <textarea ref={textRef} className="textarea" rows={6} value={el.text} onChange={(e) => onChange({ text: e.target.value })} />
          </Field>
          <div className="full">
            <VariablePicker onPick={insertVar} />
          </div>
          <Field label={t('editor.font')} className="full">
            <select className="select sm" value={el.font} onChange={(e) => onChange({ font: e.target.value as TextEl['font'] })}>
              {FONT_KEYS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: FONTS[f].stack }}>
                  {FONTS[f].label} · {t(`fontkind.${FONTS[f].kind}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.fontSize')}>
            <NumberInput className="input sm" step={0.5} min={3} max={200} value={el.size} onChange={(v) => onChange({ size: v ?? 12 })} />
          </Field>
          <Field label={t('editor.weight')}>
            <select className="select sm" value={el.weight} onChange={(e) => onChange({ weight: Number(e.target.value) as TextEl['weight'] })}>
              {[400, 500, 600, 700].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.color')}>
            <ColorInput value={el.color} onChange={(c) => onChange({ color: c })} />
          </Field>
          <Field label={t('editor.align')}>
            <select className="select sm" value={el.align} onChange={(e) => onChange({ align: e.target.value as TextEl['align'] })}>
              {['left', 'center', 'right', 'justify'].map((a) => (
                <option key={a} value={a}>
                  {t(`align.${a}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.valign')}>
            <select className="select sm" value={el.valign ?? 'top'} onChange={(e) => onChange({ valign: e.target.value as TextEl['valign'] })}>
              {['top', 'middle', 'bottom'].map((a) => (
                <option key={a} value={a}>
                  {t(`valign.${a}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.lineHeight')}>
            <NumberInput className="input sm" step={0.05} min={0.8} max={3} value={el.lineHeight} onChange={(v) => onChange({ lineHeight: v ?? 1.3 })} />
          </Field>
          <Field label={t('editor.letterSpacing')}>
            <NumberInput className="input sm" step={0.01} min={-0.1} max={1} value={el.letterSpacing ?? 0} onChange={(v) => onChange({ letterSpacing: v ?? 0 })} />
          </Field>
          <Field label={t('editor.transform')}>
            <select className="select sm" value={el.transform ?? 'none'} onChange={(e) => onChange({ transform: e.target.value as TextEl['transform'] })}>
              {['none', 'uppercase', 'lowercase', 'mirror'].map((a) => (
                <option key={a} value={a}>
                  {t(`transform.${a}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.paragraphSpacing')}>
            <NumberInput className="input sm" step={0.1} min={0} max={3} value={el.paragraphSpacing ?? 0} onChange={(v) => onChange({ paragraphSpacing: v ?? 0 })} />
          </Field>
          <div className="full col gap-4">
            <Toggle checked={!!el.italic} onChange={(v) => onChange({ italic: v })} label={t('editor.italic')} />
            <Toggle checked={!!el.dropCap} onChange={(v) => onChange({ dropCap: v })} label={t('editor.dropCap')} />
            <Toggle checked={!!el.autoFit} onChange={(v) => onChange({ autoFit: v })} label={t('editor.autoFit')} />
          </div>
          {el.dropCap && (
            <Field label={t('editor.dropCapColor')} className="full">
              <ColorInput value={el.dropCapColor ?? el.color} onChange={(c) => onChange({ dropCapColor: c })} />
            </Field>
          )}
        </div>
      )}
      {el.type === 'image' && (
        <div className="prop-grid">
          <Field label={t('el.image')} className="full">
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="input sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 8 * 1024 * 1024) {
                  toast(t('err.file_too_large', { max: '8 MB' }), 'error');
                  return;
                }
                const url = await readFileAsDataURL(f);
                const img = new Image();
                img.src = url;
                await img.decode().catch(() => undefined);
                const asset = await saveAsset(f.name, url, f.type, img.naturalWidth || 100, img.naturalHeight || 100);
                const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
                onChange({ assetId: asset.id, h: round(el.w * ratio, 1) } as Partial<DesignEl>);
              }}
            />
          </Field>
          {lib.assets.size > 0 && (
            <Field label={t('editor.library')} className="full">
              <select className="select sm" value={el.assetId ?? ''} onChange={(e) => onChange({ assetId: e.target.value || undefined } as Partial<DesignEl>)}>
                <option value="">—</option>
                {Array.from(lib.assets.values()).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t('editor.fit')}>
            <select className="select sm" value={el.fit} onChange={(e) => onChange({ fit: e.target.value } as Partial<DesignEl>)}>
              {['contain', 'cover', 'stretch'].map((f) => (
                <option key={f} value={f}>
                  {t(`fit.${f}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.filter')}>
            <select className="select sm" value={el.filter ?? 'none'} onChange={(e) => onChange({ filter: e.target.value } as Partial<DesignEl>)}>
              {['none', 'sepia', 'grayscale'].map((f) => (
                <option key={f} value={f}>
                  {t(`filter.${f}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {el.type === 'signature' && (
        <div className="prop-grid">
          <Field label={t('el.signature')} className="full">
            <RefSelect
              value={el.characterRef}
              onChange={(v) => onChange({ characterRef: v } as Partial<DesignEl>)}
              options={[{ value: '$sender', label: t('ref.sender') }, ...Array.from(lib.characters.values()).map((c) => ({ value: c.id, label: `${c.name} · ${c.title}` }))]}
            />
          </Field>
          <div className="full col gap-4">
            <Toggle checked={el.showName} onChange={(v) => onChange({ showName: v } as Partial<DesignEl>)} label={t('editor.showName')} />
            <Toggle checked={el.showTitle} onChange={(v) => onChange({ showTitle: v } as Partial<DesignEl>)} label={t('editor.showTitle')} />
          </div>
        </div>
      )}
      {el.type === 'seal' && (
        <Field label={t('el.seal')}>
          <RefSelect
            value={el.sealRef}
            onChange={(v) => onChange({ sealRef: v } as Partial<DesignEl>)}
            options={[
              { value: '$project', label: t('ref.projectSeal') },
              { value: '$house', label: t('ref.houseSeal') },
              { value: '$sender', label: t('ref.senderSeal') },
              ...Array.from(lib.seals.values()).map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </Field>
      )}
      {el.type === 'stamp' && (
        <Field label={t('el.stamp')}>
          <RefSelect value={el.stampRef} onChange={(v) => onChange({ stampRef: v } as Partial<DesignEl>)} options={[{ value: '$project', label: t('ref.projectStamp') }, ...Array.from(lib.stamps.values()).map((s) => ({ value: s.id, label: s.name }))]} />
        </Field>
      )}
      {el.type === 'postmark' && (
        <Field label={t('el.postmark')}>
          <RefSelect value={el.postmarkRef} onChange={(v) => onChange({ postmarkRef: v } as Partial<DesignEl>)} options={[{ value: '$project', label: t('ref.projectPostmark') }, ...Array.from(lib.postmarks.values()).map((s) => ({ value: s.id, label: s.name }))]} />
        </Field>
      )}
      {el.type === 'badge' && (
        <div className="col">
          <Field label={t('el.badge')}>
            <RefSelect
              value={el.houseRef}
              onChange={(v) => onChange({ houseRef: v } as Partial<DesignEl>)}
              options={[{ value: '$school', label: t('ref.schoolCrest') }, { value: '$recipient', label: t('ref.recipientHouse') }, ...lib.houseList.map((h) => ({ value: h.id, label: h.name }))]}
            />
          </Field>
          <Toggle checked={el.showName} onChange={(v) => onChange({ showName: v } as Partial<DesignEl>)} label={t('editor.showName')} />
        </div>
      )}
      {el.type === 'symbol' && (
        <div className="prop-grid">
          <div className="full" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
            {SYMBOLS.map((s) => (
              <button key={s.key} className={`btn icon sm ${el.symbol === s.key ? 'primary' : 'ghost'}`} title={t(`symbol.${s.key}`)} onClick={() => onChange({ symbol: s.key } as Partial<DesignEl>)}>
                <svg viewBox="0 0 24 24" width={18} height={18}>
                  <SymbolGlyph symbol={s.key} x={0} y={0} size={24} color="currentColor" strokeWidth={2} />
                </svg>
              </button>
            ))}
          </div>
          <Field label={t('editor.color')}>
            <ColorInput value={el.color} onChange={(c) => onChange({ color: c } as Partial<DesignEl>)} />
          </Field>
          <Field label={t('editor.thickness')}>
            <NumberInput className="input sm" step={0.1} min={0.3} max={4} value={el.strokeWidth} onChange={(v) => onChange({ strokeWidth: v ?? 1.5 } as Partial<DesignEl>)} />
          </Field>
        </div>
      )}
      {el.type === 'divider' && (
        <div className="prop-grid">
          <Field label={t('editor.style')}>
            <select className="select sm" value={el.style} onChange={(e) => onChange({ style: e.target.value } as Partial<DesignEl>)}>
              {['line', 'double', 'dotted', 'ornament', 'flourish', 'diamond'].map((s) => (
                <option key={s} value={s}>
                  {t(`divider.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.thickness')}>
            <NumberInput className="input sm" step={0.05} min={0.1} max={3} value={el.thickness} onChange={(v) => onChange({ thickness: v ?? 0.4 } as Partial<DesignEl>)} />
          </Field>
          <Field label={t('editor.color')} className="full">
            <ColorInput value={el.color} onChange={(c) => onChange({ color: c } as Partial<DesignEl>)} />
          </Field>
        </div>
      )}
      {el.type === 'shape' && (
        <div className="prop-grid">
          <Field label={t('editor.shape')} className="full">
            <select className="select sm" value={el.shape} onChange={(e) => onChange({ shape: e.target.value } as Partial<DesignEl>)}>
              {['rect', 'roundrect', 'ellipse', 'ornateframe', 'banner'].map((s) => (
                <option key={s} value={s}>
                  {t(`shape.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('editor.fill')}>
            <ColorInput value={el.fill} onChange={(c) => onChange({ fill: c } as Partial<DesignEl>)} />
          </Field>
          <Field label={t('editor.stroke')}>
            <ColorInput value={el.stroke} onChange={(c) => onChange({ stroke: c } as Partial<DesignEl>)} />
          </Field>
          <Field label={t('editor.thickness')}>
            <NumberInput className="input sm" step={0.1} min={0} max={5} value={el.strokeWidth} onChange={(v) => onChange({ strokeWidth: v ?? 0 } as Partial<DesignEl>)} />
          </Field>
          <div className="row">
            <button className="btn xs" onClick={() => onChange({ fill: '' } as Partial<DesignEl>)}>
              {t('editor.noFill')}
            </button>
          </div>
          <div className="full">
            <Toggle checked={!!el.dashed} onChange={(v) => onChange({ dashed: v } as Partial<DesignEl>)} label={t('editor.dashed')} />
          </div>
        </div>
      )}
      {el.type === 'barcode' && (
        <div className="prop-grid">
          <Field label={t('editor.value')} className="full" warning={unknownVars.length ? t('editor.unknownVars', { vars: unknownVars.join(', ') }) : undefined}>
            <input className="input sm mono" value={el.value} onChange={(e) => onChange({ value: e.target.value } as Partial<DesignEl>)} />
          </Field>
          <div className="full">
            <VariablePicker onPick={insertVar} />
          </div>
          <Field label={t('editor.color')}>
            <ColorInput value={el.color} onChange={(c) => onChange({ color: c } as Partial<DesignEl>)} />
          </Field>
          <div className="row">
            <Toggle checked={el.showText} onChange={(v) => onChange({ showText: v } as Partial<DesignEl>)} label={t('editor.showText')} />
          </div>
        </div>
      )}
      {children}
    </>
  );
}
