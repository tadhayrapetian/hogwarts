import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Copy, Download, FolderOpen, Mail, Plus, Printer, Scissors, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ENVELOPE_DIMENSIONS, PAPER_DIMENSIONS } from '../../core/defaults';
import { ENVELOPE_SIZES, type DesignEl, type EnvelopeDesign, type FlapShape, type Layout, type LinerPattern, type Recipient, type Template } from '../../core/types';
import { clamp, normalizeText, nowISO, uid } from '../../core/util';
import { db } from '../../db/db';
import { copyEnvelope, defaultEnvelope, deleteRecord, saveRecord, updateSettings } from '../../db/services';
import { useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate, setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import type { RenderCtx } from '../../render/context';
import { DielineArt, dielineGeometry, EnvelopeOpenArt, flapPath, flapTip, LinerFill } from '../../render/envelope';
import { text } from '../../render/elements';
import { exportSingle, printPages, type ExportFormat } from '../../render/export';
import { imposeSection, paperSize, type PrintItem, type PrintPage } from '../../render/imposition';
import { LayoutContent, LayoutSVG } from '../../render/LayoutSVG';
import { EnvelopeBackView, LayoutView } from '../../ui/art';
import { CanvasEditor } from '../../ui/CanvasEditor';
import { Badge, Card, ColorInput, EmptyState, Field, Modal, PageHeader, SearchInput, Tabs, Toggle } from '../../ui/kit';
import { EnvelopeThumb, RecipientSelect, useSampleCtx } from '../shared/pickers';

type Size = EnvelopeDesign['size'];

const FLAPS: FlapShape[] = ['pointed', 'straight', 'curved', 'wallet'];
const LINERS: LinerPattern[] = ['none', 'stripes', 'stars', 'damask', 'dots', 'diamonds'];
const FORMATS: ExportFormat[] = ['pdf', 'png', 'svg'];
const MIN_MM = 60;
const MAX_MM = 500;

const LINER_PRESETS: EnvelopeDesign['liner'][] = [
  { pattern: 'damask', color: '#5b1f1a', color2: '#b08d57' },
  { pattern: 'stars', color: '#1d2433', color2: '#c9b27a' },
  { pattern: 'stripes', color: '#8e2440', color2: '#f2c5cf' },
  { pattern: 'diamonds', color: '#a8865a', color2: '#5a4026' },
  { pattern: 'dots', color: '#1f3d6b', color2: '#dde4ef' },
  { pattern: 'damask', color: '#1d4d3a', color2: '#d9c27a' },
  { pattern: 'stripes', color: '#2a2a38', color2: '#d9c27a' },
];

const r1 = (n: number) => Math.round(n * 10) / 10;

function sizeLabel(size: Size, customLabel: string) {
  return size === 'custom' ? customLabel : `${size} (${ENVELOPE_DIMENSIONS[size].join('×')})`;
}

/** Scales element centres proportionally to the new page and keeps every element on the page. */
function rescale(l: Layout, W: number, H: number): Layout {
  const sx = W / l.w;
  const sy = H / l.h;
  return {
    ...l,
    w: W,
    h: H,
    elements: l.elements.map((e) => {
      const w = Math.min(e.w, W);
      const h = Math.min(e.h, H);
      const cx = (e.x + e.w / 2) * sx;
      const cy = (e.y + e.h / 2) * sy;
      return { ...e, w, h, x: r1(clamp(cx - w / 2, 0, W - w)), y: r1(clamp(cy - h / 2, 0, H - h)) };
    }),
  };
}

function starterFront(w: number, h: number): DesignEl[] {
  const addr = Math.round(Math.max(9, Math.min(13, h / 11)));
  return [
    text({ x: 10, y: 9, w: r1(Math.min(90, w * 0.42)), h: 14, text: '{{return_address}}', font: 'inter', size: 6.5, color: '#6b4a2b', lineHeight: 1.3 }),
    { id: uid(), type: 'postmark', x: r1(Math.max(0, w - 66)), y: 9, w: 36, h: 30, postmarkRef: '$project' },
    { id: uid(), type: 'stamp', x: r1(Math.max(0, w - 34)), y: 8, w: 25, h: 30, stampRef: '$project' },
    text({ x: r1(w * 0.42), y: r1(h * 0.48), w: r1(w * 0.54), h: r1(h * 0.42), text: '{{address_block}}', font: 'garamond', size: addr, weight: 500, color: '#2b1d10', lineHeight: 1.3, autoFit: true }),
  ];
}

function starterBack(flap: FlapShape, w: number, h: number): DesignEl[] {
  const s = Math.round(Math.min(30, h * 0.2));
  const [tx, ty] = flapTip(flap, w, h);
  return [{ id: uid(), type: 'seal', x: r1(tx - s / 2), y: r1(ty - s / 2), w: s, h: s, sealRef: '$project' }];
}

function directPage(env: EnvelopeDesign, title: string, w: number, h: number, render: (uid: string) => JSX.Element): PrintPage {
  const item: PrintItem = { id: env.id, label: env.name, w, h, render };
  return {
    section: 'envelopes',
    title,
    w,
    h,
    placements: [{ item, x: 0, y: 0, w, h, rotated: false }],
    marks: { crop: false, cut: false, fold: false, safe: false, bleed: 0 },
  };
}

/** Millimetre input that commits on blur / Enter, so typing never resizes mid-number. */
function MmInput({ value, onCommit, label, min = MIN_MM, max = MAX_MM }: { value: number; onCommit: (v: number) => void; label: string; min?: number; max?: number }) {
  const [raw, setRaw] = useState(String(Math.round(value)));
  useEffect(() => setRaw(String(Math.round(value))), [value]);
  const commit = () => {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw.trim() === '') return setRaw(String(Math.round(value)));
    const v = clamp(Math.round(n), min, max);
    setRaw(String(v));
    if (v !== Math.round(value)) onCommit(v);
  };
  return (
    <input
      className="input sm"
      style={{ width: 72 }}
      type="number"
      min={min}
      max={max}
      value={raw}
      aria-label={label}
      title={label}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && commit()}
    />
  );
}

function ExportRow({ label, build, w, h, name }: { label: string; build: () => JSX.Element; w: number; h: number; name: string }) {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  return (
    <div className="row wrap gap-4">
      <span className="small muted">{label}</span>
      {FORMATS.map((f) => (
        <button key={f} className="btn sm" onClick={() => run(() => exportSingle(build(), w, h, f, settings.print.resolution, name), t('common.exported'))}>
          <Download /> {f.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ───────────── Shared actions ─────────────

function useEnvelopeActions() {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  const duplicate = (e: EnvelopeDesign) => {
    const now = nowISO();
    const copy: EnvelopeDesign = { ...copyEnvelope(e), id: uid(), name: t('envstudio.copyOf', { name: e.name }), createdAt: now, updatedAt: now };
    return run(() => saveRecord('envelopes', copy), t('envstudio.duplicated'));
  };
  const setDefault = (e: EnvelopeDesign) =>
    run(() => updateSettings({ defaults: { ...settings.defaults, envelopeId: e.id } }, 'default envelope'), t('envstudio.defaultSet', { name: e.name }));
  return { duplicate, setDefault, defaultId: settings.defaults.envelopeId };
}

function DeleteEnvelopeModal({ env, onClose, onDeleted }: { env: EnvelopeDesign; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  const data = useLiveQuery(async () => ({ envelopes: await db.envelopes.toArray(), templates: await db.templates.toArray() }), []);
  const isDefault = settings.defaults.envelopeId === env.id;
  const [replacement, setReplacement] = useState<string | null>(null);
  if (!data) return null;
  const used: Template[] = data.templates.filter((tp) => tp.envelopeId === env.id);
  const others = data.envelopes.filter((e) => e.id !== env.id).sort((a, b) => a.name.localeCompare(b.name));
  const fallback = isDefault ? others[0]?.id ?? '' : settings.defaults.envelopeId ?? '';
  const target = replacement ?? fallback;
  const needsTarget = used.length > 0 || isDefault;
  const doDelete = async () => {
    const ok = await run(async () => {
      for (const tp of used) await saveRecord('templates', { ...tp, envelopeId: target || undefined });
      if (isDefault) await updateSettings({ defaults: { ...settings.defaults, envelopeId: target || undefined } }, 'default envelope');
      await deleteRecord('envelopes', env.id);
      return true;
    }, t('common.deleted'));
    if (ok) {
      onClose();
      onDeleted?.();
    }
  };
  return (
    <Modal
      title={t('envstudio.deleteTitle', { name: env.name })}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn danger solid" onClick={doDelete}>
            <Trash2 /> {t('common.delete')}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{t('envstudio.deleteBody')}</p>
      {used.length > 0 && <div className="issue warning mb-8">{t('envstudio.deleteInUse', { count: used.length })}</div>}
      {isDefault && <div className="issue warning mb-8">{t('envstudio.deleteIsDefault')}</div>}
      {needsTarget && (
        <Field label={t('envstudio.replaceWith')} hint={t('envstudio.replaceHint')}>
          <select className="select" value={target} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">— {t('common.none')}</option>
            {others.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  );
}

// ───────────── Library ─────────────

function NewEnvelopeModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const [name, setName] = useState('');
  const [size, setSize] = useState<Size>('C5');
  const [cw, setCw] = useState(229);
  const [ch, setCh] = useState(162);
  const [flap, setFlap] = useState<FlapShape>('pointed');
  const [starter, setStarter] = useState(true);
  const create = async () => {
    const env = defaultEnvelope(size);
    const [w, h] = size === 'custom' ? [clamp(cw, MIN_MM, MAX_MM), clamp(ch, MIN_MM, MAX_MM)] : ENVELOPE_DIMENSIONS[size];
    env.name = name.trim() || t('envstudio.defaultName', { size: size === 'custom' ? `${w}×${h}` : size });
    env.flap = flap;
    env.front = { ...env.front, w, h, elements: starter ? starterFront(w, h) : [] };
    env.back = { ...env.back, w, h, elements: starter ? starterBack(flap, w, h) : [] };
    const saved = await run(() => saveRecord('envelopes', env), t('envstudio.created'));
    if (saved) {
      onClose();
      navigate(`/studio/envelopes/${saved.id}`);
    }
  };
  return (
    <Modal
      title={t('envstudio.new')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={create}>
            <Plus /> {t('envstudio.create')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('field.name')} className="full">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('envstudio.namePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </Field>
        <Field label={t('envelope.size')}>
          <select className="select" value={size} onChange={(e) => setSize(e.target.value as Size)}>
            {ENVELOPE_SIZES.map((s) => (
              <option key={s} value={s}>
                {sizeLabel(s, t('common.custom'))}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('envelope.flap')}>
          <select className="select" value={flap} onChange={(e) => setFlap(e.target.value as FlapShape)}>
            {FLAPS.map((f) => (
              <option key={f} value={f}>
                {t(`flap.${f}`)}
              </option>
            ))}
          </select>
        </Field>
        {size === 'custom' && (
          <Field label={t('envstudio.customSize')} hint={t('envstudio.customHint', { min: MIN_MM, max: MAX_MM })} className="full">
            <div className="row">
              <input className="input" type="number" min={MIN_MM} max={MAX_MM} value={cw} onChange={(e) => setCw(Number(e.target.value) || 0)} aria-label={t('envstudio.width')} />
              <span className="muted">×</span>
              <input className="input" type="number" min={MIN_MM} max={MAX_MM} value={ch} onChange={(e) => setCh(Number(e.target.value) || 0)} aria-label={t('envstudio.height')} />
              <span className="muted">mm</span>
            </div>
          </Field>
        )}
        <div className="full">
          <Toggle checked={starter} onChange={setStarter} label={t('envstudio.starterElements')} />
          <div className="muted small mt-8">{t('envstudio.starterHint')}</div>
        </div>
      </div>
    </Modal>
  );
}

function EnvelopeLibrary() {
  const { t } = useI18n();
  const { can } = useSession();
  const { contextMenu } = useFeedback();
  const ctx = useSampleCtx('envlib');
  const { duplicate, setDefault, defaultId } = useEnvelopeActions();
  const data = useLiveQuery(async () => ({ envelopes: await db.envelopes.toArray(), templates: await db.templates.toArray() }), []);
  const [q, setQ] = useState('');
  const [size, setSize] = useState<'all' | Size>('all');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EnvelopeDesign | null>(null);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const tp of data?.templates ?? []) if (tp.envelopeId) m.set(tp.envelopeId, (m.get(tp.envelopeId) ?? 0) + 1);
    return m;
  }, [data]);
  if (!data) return null;
  const editable = can('design.edit');
  const n = normalizeText(q);
  const list = data.envelopes
    .filter((e) => (size === 'all' || e.size === size) && (!n || normalizeText(`${e.name} ${e.size}`).includes(n)))
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.name.localeCompare(b.name));
  const open = (e: EnvelopeDesign) => navigate(`/studio/envelopes/${e.id}`);
  const menu = (e: EnvelopeDesign) => [
    { label: t('common.open'), icon: <FolderOpen />, onClick: () => open(e) },
    ...(editable
      ? [
          { label: t('common.duplicate'), icon: <Copy />, onClick: () => void duplicate(e) },
          { label: t('envstudio.setDefault'), icon: <Star />, onClick: () => void setDefault(e), disabled: e.id === defaultId },
          { label: '', divider: true },
          { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => setDeleting(e) },
        ]
      : []),
  ];
  const sizes = ENVELOPE_SIZES.filter((s) => data.envelopes.some((e) => e.size === s));
  return (
    <div>
      <PageHeader
        title={t('nav.envelopes')}
        sub={t('envstudio.sub')}
        actions={
          editable && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus /> {t('envstudio.new')}
            </button>
          )
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('envstudio.search')} />
        <div className="row wrap gap-4">
          <button className={`btn sm ${size === 'all' ? 'primary' : 'ghost'}`} onClick={() => setSize('all')}>
            {t('common.all')} <span className="muted">{data.envelopes.length}</span>
          </button>
          {sizes.map((s) => (
            <button key={s} className={`btn sm ${size === s ? 'primary' : 'ghost'}`} onClick={() => setSize(s)}>
              {s === 'custom' ? t('common.custom') : s} <span className={size === s ? '' : 'muted'}>{data.envelopes.filter((e) => e.size === s).length}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length ? (
        <div className="thumb-grid lg">
          {list.map((e) => {
            const uses = usage.get(e.id) ?? 0;
            const isDefault = e.id === defaultId;
            return (
              <div
                key={e.id}
                className="thumb-card"
                role="button"
                tabIndex={0}
                onClick={() => open(e)}
                onKeyDown={(ev) => ev.key === 'Enter' && open(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  contextMenu(ev, menu(e));
                }}
              >
                {isDefault && (
                  <span className="check-mark" title={t('envstudio.default')}>
                    <Star />
                  </span>
                )}
                <div className="art">
                  <EnvelopeThumb env={e} ctx={ctx} height={110} />
                </div>
                <div className="title truncate">{e.name}</div>
                <div className="meta">
                  {e.size === 'custom' ? t('common.custom') : e.size} · {Math.round(e.front.w)}×{Math.round(e.front.h)} mm · {t(`flap.${e.flap}`)}
                </div>
                <div className="row wrap gap-4">
                  {isDefault && <Badge tone="success">{t('envstudio.default')}</Badge>}
                  <Badge tone={uses ? 'info' : 'neutral'}>{t('envstudio.usedIn', { count: uses })}</Badge>
                </div>
                {editable && (
                  <div className="row gap-4" onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
                    <button className="btn xs" onClick={() => open(e)}>
                      {t('common.edit')}
                    </button>
                    <span className="grow" />
                    <button className="btn xs ghost icon" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={() => void duplicate(e)}>
                      <Copy />
                    </button>
                    <button className="btn xs ghost icon" title={t('envstudio.setDefault')} aria-label={t('envstudio.setDefault')} disabled={isDefault} onClick={() => void setDefault(e)}>
                      <Star />
                    </button>
                    <button className="btn xs ghost icon danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(e)}>
                      <Trash2 />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Mail />}
          title={data.envelopes.length ? t('common.noResults') : t('envstudio.empty')}
          text={data.envelopes.length ? undefined : t('envstudio.emptyHint')}
          action={
            editable && !data.envelopes.length ? (
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Plus /> {t('envstudio.new')}
              </button>
            ) : undefined
          }
        />
      )}
      {creating && <NewEnvelopeModal onClose={() => setCreating(false)} />}
      {deleting && <DeleteEnvelopeModal env={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

// ───────────── Editor ─────────────

/** Local draft + debounced autosave via saveRecord. */
function useEnvelopeDraft(id: string) {
  const { toast } = useFeedback();
  const { t } = useI18n();
  const stored = useLiveQuery(async () => (await db.envelopes.get(id)) ?? null, [id]);
  const pending = useRef<Partial<EnvelopeDesign>>({});
  const lastSaved = useRef<EnvelopeDesign | null>(null);
  const [, force] = useState(0);
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    const snap = pending.current;
    if (!Object.keys(snap).length) return;
    try {
      const cur = await db.envelopes.get(id);
      if (!cur) return;
      lastSaved.current = await saveRecord('envelopes', { ...cur, ...snap });
      const rest: Partial<EnvelopeDesign> = {};
      for (const [k, v] of Object.entries(pending.current)) if ((snap as Record<string, unknown>)[k] !== v) (rest as Record<string, unknown>)[k] = v;
      pending.current = rest;
      setSaving(Object.keys(rest).length ? 'pending' : 'saved');
    } catch (e) {
      console.error(e);
      toast(t('err.generic'), 'error');
    }
  }, [id, toast, t]);
  const patch = useCallback(
    (p: Partial<EnvelopeDesign>) => {
      pending.current = { ...pending.current, ...p };
      setSaving('pending');
      force((n) => n + 1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 600);
    },
    [flush],
  );
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );
  let base: EnvelopeDesign | null | undefined = stored;
  if (stored && lastSaved.current?.id === stored.id && lastSaved.current.updatedAt > stored.updatedAt) base = lastSaved.current;
  const env = base ? ({ ...base, ...pending.current } as EnvelopeDesign) : base;
  return { env, patch, saving, flush };
}

function FlapCard({ env, flap, ctx, active, onPick, disabled }: { env: EnvelopeDesign; flap: FlapShape; ctx: RenderCtx; active: boolean; onPick: () => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <button type="button" className={`thumb-card ${active ? 'selected' : ''}`} onClick={onPick} disabled={disabled} aria-pressed={active}>
      <div className="art">
        <EnvelopeBackView env={{ ...env, flap }} ctx={ctx} width="100%" height={90} />
      </div>
      <div className="title">{t(`flap.${flap}`)}</div>
    </button>
  );
}

function EnvelopeEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const route = useRoute();
  const settings = useSettings();
  const { can } = useSession();
  const run = useAction();
  const { env, patch, saving, flush } = useEnvelopeDraft(id);
  const { duplicate, setDefault, defaultId } = useEnvelopeActions();
  const [recipient, setRecipient] = useState<Recipient | undefined>();
  const sample = useSampleCtx('envst', recipient);
  const ctx = useMemo<RenderCtx>(() => ({ ...sample, editor: true }), [sample]);
  const out = useMemo<RenderCtx>(() => ({ ...sample, editor: false }), [sample]);
  const usedBy = useLiveQuery(() => db.templates.filter((tp) => tp.envelopeId === id).toArray(), [id]) ?? [];
  const [deleting, setDeleting] = useState(false);
  const [printBg, setPrintBg] = useState(true);
  const tab = route.query.get('tab') ?? 'front';

  if (env === undefined) return null;
  if (env === null)
    return (
      <EmptyState
        icon={<Mail />}
        title={t('envstudio.notFound')}
        action={
          <a className="btn" href="#/studio/envelopes">
            <ArrowLeft /> {t('common.back')}
          </a>
        }
      />
    );

  const editable = can('design.edit');
  const canPrint = can('print');
  const { w, h } = env.front;
  const g = dielineGeometry(w, h);
  const isDefault = env.id === defaultId;

  const resize = (size: Size, cw?: number, ch?: number) => {
    const [W, H] = size === 'custom' ? [cw ?? w, ch ?? h] : ENVELOPE_DIMENSIONS[size];
    patch({ size, front: rescale(env.front, W, H), back: rescale(env.back, W, H) });
  };
  const setFlap = (flap: FlapShape) => {
    if (flap === env.flap) return;
    const [ox, oy] = flapTip(env.flap, env.back.w, env.back.h);
    const [nx, ny] = flapTip(flap, env.back.w, env.back.h);
    const elements = env.back.elements.map((e) =>
      e.type === 'seal' && Math.hypot(e.x + e.w / 2 - ox, e.y + e.h / 2 - oy) < Math.max(e.w, e.h) ? { ...e, x: r1(nx - e.w / 2), y: r1(ny - e.h / 2) } : e,
    );
    patch({ flap, back: { ...env.back, elements } });
  };
  const setLiner = (l: Partial<EnvelopeDesign['liner']>) => patch({ liner: { ...env.liner, ...l } });

  const frontSvg = () => <LayoutSVG layout={env.front} ctx={{ ...out, idPrefix: 'xef' }} width={`${w}mm`} height={`${h}mm`} />;
  const backSvg = () => <LayoutSVG layout={env.back} ctx={{ ...out, idPrefix: 'xeb' }} width={`${env.back.w}mm`} height={`${env.back.h}mm`} />;
  const dieSvg = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${g.W} ${g.H}`} width={`${g.W}mm`} height={`${g.H}mm`}>
      <rect width={g.W} height={g.H} fill="#fff" />
      <DielineArt env={env} ctx={{ ...out, idPrefix: 'xed' }} />
    </svg>
  );
  const dieItem = (): PrintItem => ({ id: `${env.id}-die`, label: env.name, w: g.W, h: g.H, render: (u) => <DielineArt env={env} ctx={{ ...out, idPrefix: u }} /> });
  const plain = (l: Layout): Layout => ({ ...l, paper: { ...l.paper, texture: 0, vignette: 0 } });

  const printFront = () =>
    run(async () => {
      await flush();
      await printPages([directPage(env, t('print.sec.envelopes'), w, h, (u) => <LayoutContent layout={printBg ? env.front : plain(env.front)} ctx={{ ...out, idPrefix: u }} background={printBg} />)]);
    });
  const printBack = () =>
    run(async () => {
      await flush();
      await printPages([directPage(env, t('print.sec.envelopeBacks'), env.back.w, env.back.h, (u) => <LayoutContent layout={printBg ? env.back : plain(env.back)} ctx={{ ...out, idPrefix: u }} background={printBg} />)]);
    });
  const printDie = () =>
    run(async () => {
      await flush();
      await printPages([directPage(env, t('print.sec.envelopesDie'), g.W, g.H, dieItem().render)]);
    });
  const printDieOnSheet = () =>
    run(async () => {
      await flush();
      await printPages(imposeSection({ key: 'envelopes', title: t('print.sec.envelopesDie'), mode: 'grid', items: [dieItem()] }, { ...settings.print, cropMarks: false, cutLines: false, safeArea: false, scale: 100 }));
    });

  const fits = (pw: number, ph: number) => (g.W <= pw && g.H <= ph) || (g.W <= ph && g.H <= pw);
  const [spw, sph] = paperSize(settings.print);
  const sheetFits = fits(spw - settings.print.margins * 2, sph - settings.print.margins * 2);
  const flapH = flapTip(env.flap, env.back.w, env.back.h)[1];

  const tabs = [
    { key: 'front', label: t('envelope.front') },
    { key: 'back', label: t('envelope.back') },
    { key: 'inside', label: t('envstudio.tabInside') },
    { key: 'layout', label: t('envelope.printLayout') },
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t('nav.envelopes'), href: '#/studio/envelopes' }, { label: env.name }]}
        title={
          <span className="row wrap">
            {env.name}
            {isDefault && <Badge tone="success">{t('envstudio.default')}</Badge>}
          </span>
        }
        sub={
          <span className="row wrap gap-12">
            <span>
              {env.size === 'custom' ? t('common.custom') : env.size} · {Math.round(w)}×{Math.round(h)} mm · {t(`flap.${env.flap}`)}
            </span>
            <span className="muted small">{t('envstudio.usedIn', { count: usedBy.length })}</span>
            {editable && <span className="muted small">{saving === 'pending' ? t('common.saving') : saving === 'saved' ? t('common.allSaved') : t('common.autosave')}</span>}
          </span>
        }
        actions={
          editable && (
            <>
              <button
                className="btn"
                onClick={async () => {
                  await flush();
                  const copy = await duplicate(env);
                  if (copy) navigate(`/studio/envelopes/${copy.id}`);
                }}
              >
                <Copy /> {t('common.duplicate')}
              </button>
              <button className="btn" disabled={isDefault} onClick={() => void setDefault(env)}>
                <Star /> {isDefault ? t('envstudio.default') : t('envstudio.setDefault')}
              </button>
              <button className="btn danger icon" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(true)}>
                <Trash2 />
              </button>
            </>
          )
        }
      />

      <div className="toolbar">
        {editable && <input className="input sm" style={{ maxWidth: 260 }} value={env.name} onChange={(e) => patch({ name: e.target.value })} aria-label={t('field.name')} title={t('field.name')} />}
        <select className="select sm" style={{ width: 150 }} value={env.size} disabled={!editable} onChange={(e) => resize(e.target.value as Size)} aria-label={t('envelope.size')}>
          {ENVELOPE_SIZES.map((s) => (
            <option key={s} value={s}>
              {sizeLabel(s, t('common.custom'))}
            </option>
          ))}
        </select>
        {env.size === 'custom' && editable && (
          <>
            <MmInput value={w} label={t('envstudio.width')} onCommit={(v) => resize('custom', v, h)} />
            <span className="muted">×</span>
            <MmInput value={h} label={t('envstudio.height')} onCommit={(v) => resize('custom', w, v)} />
            <span className="muted small">mm</span>
          </>
        )}
        <select className="select sm" style={{ width: 140 }} value={env.flap} disabled={!editable} onChange={(e) => setFlap(e.target.value as FlapShape)} aria-label={t('envelope.flap')}>
          {FLAPS.map((f) => (
            <option key={f} value={f}>
              {t(`flap.${f}`)}
            </option>
          ))}
        </select>
        <span className="grow" />
        <div style={{ width: 260 }}>
          <RecipientSelect value={recipient?.id} onChange={(_, r) => setRecipient(r)} allowEmpty placeholder={t('envstudio.sampleData')} />
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={(k) => setQuery('tab', k === 'front' ? null : k)} />

      {(tab === 'front' || tab === 'back') && (
        <div className="row wrap mb-16">
          {tab === 'front' ? (
            <ExportRow label={t('envstudio.exportFront')} build={frontSvg} w={w} h={h} name={`${env.name}-front`} />
          ) : (
            <ExportRow label={t('envstudio.exportBack')} build={backSvg} w={env.back.w} h={env.back.h} name={`${env.name}-back`} />
          )}
          <span className="grow" />
          {canPrint && (
            <>
              <Toggle checked={printBg} onChange={setPrintBg} label={t('envstudio.printPaper')} />
              <button className="btn sm" onClick={tab === 'front' ? printFront : printBack}>
                <Printer /> {tab === 'front' ? t('envstudio.printFront') : t('envstudio.printBack')}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'front' &&
        (editable ? (
          <CanvasEditor key="front" className="embedded" layout={env.front} onChange={(l) => patch({ front: l })} ctx={ctx} lockSize />
        ) : (
          <Card>
            <LayoutView layout={env.front} ctx={out} width="100%" className="paper-shadow" style={{ maxHeight: 560 }} />
          </Card>
        ))}

      {tab === 'back' &&
        (editable ? (
          <CanvasEditor
            key="back"
            className="embedded"
            layout={env.back}
            onChange={(l) => patch({ back: l })}
            ctx={ctx}
            lockSize
            overlay={<path d={flapPath(env.flap, env.back.w, env.back.h)} fill="none" stroke="#8a6a35" strokeWidth={0.4} strokeDasharray="2 1.2" pointerEvents="none" />}
          />
        ) : (
          <Card>
            <EnvelopeBackView env={env} ctx={out} width="100%" style={{ maxHeight: 560 }} />
          </Card>
        ))}

      {tab === 'inside' && (
        <div className="grid grid-2">
          <Card title={t('envstudio.flapShape')} sub={t('envstudio.flapShapeSub')} className="span-all">
            <div className="thumb-grid">
              {FLAPS.map((f) => (
                <FlapCard key={f} env={env} flap={f} ctx={out} active={env.flap === f} onPick={() => setFlap(f)} disabled={!editable} />
              ))}
            </div>
          </Card>
          <Card title={t('envelope.liner')}>
            <div className="form-grid">
              <Field label={t('envstudio.linerPattern')} className="full">
                <select className="select" value={env.liner.pattern} disabled={!editable} onChange={(e) => setLiner({ pattern: e.target.value as LinerPattern })}>
                  {LINERS.map((p) => (
                    <option key={p} value={p}>
                      {t(`liner.${p}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {editable && (
                <>
                  <Field label={t('editor.color')}>
                    <ColorInput value={env.liner.color} onChange={(c) => setLiner({ color: c })} />
                  </Field>
                  <Field label={t('envelope.accent')}>
                    <ColorInput value={env.liner.color2} onChange={(c) => setLiner({ color2: c })} />
                  </Field>
                  <Field label={t('envstudio.linerPresets')} className="full">
                    <div className="row wrap gap-4">
                      {LINER_PRESETS.map((p, i) => (
                        <button key={i} type="button" className="btn sm" title={t(`liner.${p.pattern}`)} onClick={() => setLiner(p)}>
                          <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
                            <defs>
                              <LinerFill id={`lp-${i}`} pattern={p.pattern} color={p.color} color2={p.color2} />
                            </defs>
                            <rect width={16} height={16} rx={3} fill={`url(#lp-${i})`} />
                          </svg>
                          {t(`liner.${p.pattern}`)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </div>
            <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', marginTop: 16, borderRadius: 6 }} className="paper-shadow" aria-label={t('envelope.liner')}>
              <defs>
                <LinerFill id="env-liner-prev" pattern={env.liner.pattern} color={env.liner.color} color2={env.liner.color2} />
              </defs>
              <rect width={w} height={h} fill={env.liner.pattern === 'none' ? env.front.paper.color : 'url(#env-liner-prev)'} />
            </svg>
            <div className="muted small mt-8">{t('envelope.linerHint')}</div>
          </Card>
          <Card title={t('envstudio.openPreview')} sub={t('envstudio.openPreviewSub')}>
            <div style={{ aspectRatio: `${env.back.w} / ${env.back.h + flapH}`, width: '100%', maxWidth: 520, margin: '0 auto' }} className="paper-shadow">
              <EnvelopeOpenArt env={env} ctx={{ ...out, idPrefix: 'envopen' }} />
            </div>
            {editable && (
              <div className="row wrap mt-16">
                <span className="small muted grow">{t('envstudio.paperSync')}</span>
                <button className="btn sm" onClick={() => patch({ back: { ...env.back, paper: { ...env.front.paper } } })}>
                  {t('envstudio.applyFrontPaper')}
                </button>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'layout' && (
        <div className="grid grid-3">
          <Card title={t('envelope.dielineTitle')} sub={t('envelope.dielineSub', { w: Math.round(g.W), h: Math.round(g.H) })} className="span-2">
            <svg viewBox={`-4 -4 ${g.W + 8} ${g.H + 8}`} style={{ width: '100%', maxHeight: 620, background: '#fff', borderRadius: 8 }}>
              <DielineArt env={env} ctx={{ ...out, idPrefix: 'dl' }} />
            </svg>
            <div className="muted small mt-8">{t('envelope.dielineHint')}</div>
          </Card>
          <div className="col gap-16">
            <Card title={t('envstudio.marksTitle')}>
              <div className="col">
                <div className="row">
                  <svg width={34} height={12} aria-hidden="true">
                    <line x1={1} y1={6} x2={33} y2={6} stroke="#222" strokeWidth={1.2} />
                  </svg>
                  <span className="small grow">{t('envstudio.markCut')}</span>
                </div>
                <div className="row">
                  <svg width={34} height={12} aria-hidden="true">
                    <line x1={1} y1={6} x2={33} y2={6} stroke="#666" strokeWidth={1.2} strokeDasharray="5 3" />
                  </svg>
                  <span className="small grow">{t('envstudio.markFold')}</span>
                </div>
                <div className="row">
                  <svg width={34} height={12} aria-hidden="true">
                    <line x1={5} y1={6} x2={29} y2={6} stroke="#9a7b4f" strokeOpacity={0.35} strokeWidth={8} strokeLinecap="round" />
                  </svg>
                  <span className="small grow">{t('envstudio.markGlue')}</span>
                </div>
                <div className="muted small">{t('envstudio.markArt')}</div>
              </div>
              <ol className="small" style={{ paddingLeft: 18, margin: '12px 0 0' }}>
                <li>{t('envstudio.step1')}</li>
                <li>{t('envstudio.step2')}</li>
                <li>{t('envstudio.step3')}</li>
                <li>{t('envstudio.step4')}</li>
              </ol>
            </Card>
            <Card title={t('envstudio.templateSize')} sub={`${Math.round(g.W)}×${Math.round(g.H)} mm`}>
              <div className="small muted mb-8">{t('envstudio.fitsOn')}</div>
              <div className="row wrap gap-4">
                {Object.entries(PAPER_DIMENSIONS).map(([k, [pw, ph]]) => (
                  <Badge key={k} tone={fits(pw, ph) ? 'success' : 'neutral'} dot>
                    {k}
                  </Badge>
                ))}
              </div>
            </Card>
            <Card title={t('envstudio.exportPrint')}>
              <div className="col gap-12">
                <ExportRow label={t('envstudio.exportTemplate')} build={dieSvg} w={g.W} h={g.H} name={`${env.name}-template`} />
                {canPrint && (
                  <>
                    <button className="btn" style={{ justifyContent: 'flex-start' }} onClick={printDie}>
                      <Scissors /> {t('envstudio.printTemplate')}
                    </button>
                    <button className="btn" style={{ justifyContent: 'flex-start' }} onClick={printDieOnSheet}>
                      <Printer /> {t('envstudio.printOnSheet', { paper: settings.print.paper === 'custom' ? `${spw}×${sph}` : settings.print.paper })}
                    </button>
                    {!sheetFits && <div className="issue warning small">{t('envstudio.sheetTooSmall', { paper: settings.print.paper })}</div>}
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {deleting && <DeleteEnvelopeModal env={env} onClose={() => setDeleting(false)} onDeleted={() => navigate('/studio/envelopes')} />}
    </div>
  );
}

export function EnvelopeStudio({ id }: { id?: string }) {
  return id ? <EnvelopeEditor key={id} id={id} /> : <EnvelopeLibrary />;
}
