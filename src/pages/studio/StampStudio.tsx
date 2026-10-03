import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Download, ImageOff, Pencil, Plus, Printer, Stamp as StampIcon, Star, Trash2 } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PAPER_DIMENSIONS } from '../../core/defaults';
import { FONT_KEYS, STAMP_CATEGORIES, type Asset, type PrintSettings, type Stamp, type StampCategory } from '../../core/types';
import { clamp, normalizeText, nowISO, readFileAsDataURL, uid } from '../../core/util';
import { db } from '../../db/db';
import { deleteRecord, saveAsset, saveRecord, updateProject, updateSettings } from '../../db/services';
import { useLib, useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import { exportPages, exportSingle, printPages, type ExportFormat } from '../../render/export';
import { FONTS } from '../../render/fonts';
import { imposeSection, PageSVG, type PrintItem, type PrintSection } from '../../render/imposition';
import { StampArt } from '../../render/stamp';
import { SYMBOLS, SymbolGlyph } from '../../render/symbols';
import { StampView } from '../../ui/art';
import { Badge, ColorInput, Dropzone, EmptyState, Field, Modal, PageHeader, SearchInput, Section } from '../../ui/kit';

const SHAPES: Stamp['shape'][] = ['perforated', 'rounded', 'circle', 'triangle', 'oval'];
const PATTERNS: Stamp['pattern'][] = ['none', 'guilloche', 'lines', 'dots', 'rays'];
const FORMATS: ExportFormat[] = ['png', 'svg', 'pdf'];
const PAPERS = Object.keys(PAPER_DIMENSIONS) as Exclude<PrintSettings['paper'], 'custom'>[];
const SIZE_PRESETS: [number, number][] = [
  [26, 31],
  [31, 26],
  [24, 29],
  [28, 28],
  [32, 40],
  [40, 32],
];
const MIN_MM = 8;
const MAX_MM = 120;
const MAX_IMAGE = 8 * 1024 * 1024;

type Palette = Pick<Stamp, 'bg' | 'frame' | 'ink' | 'accent'>;
const pal = (bg: string, frame: string, ink: string, accent: string): Palette => ({ bg, frame, ink, accent });

const PRESETS: Record<StampCategory, Palette[]> = {
  owl_post: [pal('#efe2c4', '#5b1f1a', '#5b1f1a', '#8a6a35'), pal('#1f2b45', '#e8d39a', '#e8d39a', '#e8d39a'), pal('#e9dcc0', '#3d2a1a', '#3d2a1a', '#a07b45')],
  express: [pal('#f4d9a2', '#7a2e0e', '#7a2e0e', '#c26a2a'), pal('#fbe7c6', '#a3271f', '#a3271f', '#e08a2e'), pal('#2b2b2b', '#f2b33d', '#f2b33d', '#e0662e')],
  special_delivery: [pal('#d9e4d2', '#2f5233', '#2f5233', '#5d7f4f'), pal('#efe6d2', '#5b1f1a', '#5b1f1a', '#c9a227'), pal('#24324a', '#d9c27a', '#d9c27a', '#8fa6c9')],
  school_mail: [pal('#dde4ef', '#1f3d6b', '#1f3d6b', '#4b6a99'), pal('#f1e6cc', '#5b1f1a', '#5b1f1a', '#c9a227'), pal('#e3ead9', '#2a4a2e', '#2a4a2e', '#b08d57')],
  air_mail: [pal('#e5eef7', '#24508a', '#24508a', '#b0302a'), pal('#ffffff', '#b0302a', '#24508a', '#b0302a'), pal('#dbe7f2', '#1d3557', '#1d3557', '#e63946')],
  archive: [pal('#e8dcc2', '#5a4026', '#5a4026', '#8a6a35'), pal('#d8cdb4', '#3b2f22', '#3b2f22', '#7a6a50'), pal('#ece4d4', '#4a4a4a', '#333333', '#8c8c8c')],
  birthday: [pal('#f7dfe2', '#8e2440', '#8e2440', '#d0607a'), pal('#fff1c9', '#b4531a', '#7a3b12', '#e9a23b'), pal('#e4dcf3', '#5a3d8a', '#5a3d8a', '#c27ac9')],
  christmas: [pal('#dbe9e3', '#1d4d3a', '#1d4d3a', '#b0302a'), pal('#efe0c8', '#2a5a35', '#2a5a35', '#b0302a'), pal('#7a1f1f', '#e8d39a', '#f3e3c0', '#e8d39a')],
  invitation: [pal('#f3e9d6', '#6b3a1f', '#6b3a1f', '#b08d57'), pal('#fbf6ec', '#8a6a35', '#3a2a1a', '#c9a227'), pal('#1d2433', '#c9b27a', '#ead9a6', '#c9b27a')],
  secret: [pal('#2a2a38', '#d9c27a', '#d9c27a', '#d9c27a'), pal('#1a1a1a', '#9b1c1c', '#e6e6e6', '#9b1c1c'), pal('#3a2d4a', '#c9b27a', '#e8dcc2', '#8f7bb0')],
};

const CATEGORY_SYMBOL: Record<StampCategory, string> = {
  owl_post: 'owl',
  express: 'sparkles',
  special_delivery: 'key',
  school_mail: 'castle',
  air_mail: 'feather',
  archive: 'scroll',
  birthday: 'cake',
  christmas: 'snowflake',
  invitation: 'envelope',
  secret: 'keyhole',
};

function stampSvg(s: Stamp, asset?: Asset) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${s.w} ${s.h}`} width={`${s.w}mm`} height={`${s.h}mm`}>
      <StampArt stamp={s} uid="xst" asset={asset} />
    </svg>
  );
}

function sheetSection(s: Stamp, asset: Asset | undefined, copies: number, title: string): PrintSection {
  const items: PrintItem[] = Array.from({ length: copies }, (_, i) => ({
    id: `${s.id}-${i}`,
    label: s.name,
    w: s.w,
    h: s.h,
    render: (u: string) => <StampArt stamp={s} uid={u} asset={asset} />,
  }));
  return { key: 'stamps', title, mode: 'grid', items };
}

/** Millimetre field: keeps the raw text while typing and commits only valid values. */
function MmField({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  const n = Number(raw);
  const valid = raw.trim() !== '' && Number.isFinite(n) && n >= MIN_MM && n <= MAX_MM;
  return (
    <input
      className="input"
      type="number"
      min={MIN_MM}
      max={MAX_MM}
      step={0.5}
      value={raw}
      aria-label={label}
      aria-invalid={!valid}
      onChange={(e) => {
        setRaw(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= MIN_MM && v <= MAX_MM) onChange(v);
      }}
      onBlur={() => !valid && setRaw(String(value))}
    />
  );
}

// ───────────── Stamp sheet printing ─────────────

function SheetControls({ stamp, asset, preview }: { stamp: Stamp; asset?: Asset; preview?: boolean }) {
  const { t } = useI18n();
  const settings = useSettings();
  const { can } = useSession();
  const run = useAction();
  const [copies, setCopies] = useState('20');
  const [paper, setPaper] = useState<PrintSettings['paper'] | null>(null);
  const ps: PrintSettings = { ...settings.print, paper: paper ?? settings.print.paper, cropMarks: false, cutLines: true };
  const n = clamp(Math.round(Number(copies) || 0), 0, 1000);
  const title = t('print.sec.stamps');
  const capacity = imposeSection(sheetSection(stamp, asset, 400, title), ps)[0]?.placements.length ?? 0;
  const pages = imposeSection(sheetSection(stamp, asset, n, title), ps);
  const name = `${stamp.name || 'stamp'}-sheet`;
  return (
    <div className="col gap-12">
      <div className="row wrap">
        <Field label={t('stampstudio.copies')}>
          <input className="input sm" style={{ width: 90 }} type="number" min={1} max={1000} value={copies} onChange={(e) => setCopies(e.target.value)} />
        </Field>
        <Field label={t('print.paper')}>
          <select className="select sm" style={{ width: 110 }} value={ps.paper} onChange={(e) => setPaper(e.target.value as PrintSettings['paper'])}>
            {PAPERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {settings.print.paper === 'custom' && <option value="custom">{t('common.custom')}</option>}
          </select>
        </Field>
        <Field label={'\u00a0'}>
          <button type="button" className="btn sm" disabled={!capacity} onClick={() => setCopies(String(capacity))}>
            {t('stampstudio.fillSheet', { count: capacity })}
          </button>
        </Field>
      </div>
      <div className="muted small">
        {capacity ? t('stampstudio.sheetSummary', { perSheet: capacity, pages: pages.length, copies: n }) : t('stampstudio.sheetNoFit')}
      </div>
      {preview && pages.length > 0 && (
        <div className="print-sheet-preview">
          {pages.slice(0, 4).map((p, i) => (
            <div key={i}>
              <PageSVG page={p} uid={`sp${i}`} className="sheet" style={{ width: Math.min(260, (p.w / Math.max(p.w, p.h)) * 260), height: 'auto' }} />
              <div className="sheet-label">
                {i + 1} / {pages.length} · {Math.round(p.w)}×{Math.round(p.h)} mm · {p.placements.length} {t('print.perSheet')}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="row wrap">
        {can('print') && (
          <button type="button" className="btn primary sm" disabled={!pages.length} onClick={() => run(() => printPages(pages))}>
            <Printer /> {t('stampstudio.printSheet')}
          </button>
        )}
        <button type="button" className="btn sm" disabled={!pages.length} onClick={() => run(() => exportPages(pages, 'pdf', settings.print.resolution, name), t('common.exported'))}>
          <Download /> PDF
        </button>
      </div>
    </div>
  );
}

function PrintSheetModal({ stamp, asset, onClose }: { stamp: Stamp; asset?: Asset; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t('stampstudio.printSheetTitle', { name: stamp.name })} sub={t('stampstudio.printSheetSub')} onClose={onClose} size="lg">
      <SheetControls stamp={stamp} asset={asset} preview />
    </Modal>
  );
}

// ───────────── Delete with reassignment ─────────────

function DeleteStampModal({ stamp, onClose }: { stamp: Stamp; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  const data = useLiveQuery(
    async () => ({
      stamps: await db.stamps.toArray(),
      projects: await db.projects.filter((p) => p.stampId === stamp.id).toArray(),
      templates: await db.templates.filter((tp) => tp.stampId === stamp.id).toArray(),
    }),
    [stamp.id],
  );
  const [replacement, setReplacement] = useState<string | null>(null);
  if (!data) return null;
  const isDefault = settings.defaults.stampId === stamp.id;
  const others = data.stamps.filter((s) => s.id !== stamp.id).sort((a, b) => a.name.localeCompare(b.name));
  const fallback = isDefault ? others.find((s) => s.category === stamp.category)?.id ?? others[0]?.id ?? '' : settings.defaults.stampId ?? '';
  const target = replacement ?? fallback;
  const uses = data.projects.length + data.templates.length;
  const doDelete = async () => {
    const ok = await run(async () => {
      for (const p of data.projects) await updateProject(p.id, { stampId: target || undefined });
      for (const tp of data.templates) await saveRecord('templates', { ...tp, stampId: target || undefined });
      if (isDefault) await updateSettings({ defaults: { ...settings.defaults, stampId: target || undefined } }, 'default stamp');
      await deleteRecord('stamps', stamp.id);
      return true;
    }, t('common.deleted'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('stampstudio.deleteTitle', { name: stamp.name })}
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
      <p style={{ marginTop: 0 }}>{t('stampstudio.deleteBody')}</p>
      {uses > 0 && <div className="issue warning mb-8">{t('stampstudio.deleteInUse', { count: uses, projects: data.projects.length, templates: data.templates.length })}</div>}
      {isDefault && <div className="issue warning mb-8">{t('stampstudio.deleteIsDefault')}</div>}
      {(uses > 0 || isDefault) && (
        <Field label={t('stampstudio.replaceWith')} hint={t('stampstudio.replaceHint')}>
          <select className="select" value={target} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">— {t('common.none')}</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {t(`stampcat.${s.category}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  );
}

// ───────────── Designer ─────────────

function StampDesigner({
  initial,
  isNew,
  uses,
  onClose,
  onSaveCopy,
  onDelete,
}: {
  initial: Stamp;
  isNew: boolean;
  uses: number;
  onClose: () => void;
  onSaveCopy: (s: Stamp) => void;
  onDelete: (s: Stamp) => void;
}) {
  const { t } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { confirm, toast } = useFeedback();
  const lib = useLib();
  const settings = useSettings();
  const [s, setS] = useState<Stamp>(initial);
  const [uploading, setUploading] = useState(false);
  const set = (p: Partial<Stamp>) => setS((x) => ({ ...x, ...p }));
  const editable = can('design.edit');
  const asset = s.assetId ? lib.assets.get(s.assetId) : undefined;
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const sizeOk = s.w >= MIN_MM && s.w <= MAX_MM && s.h >= MIN_MM && s.h <= MAX_MM;
  const valid = !!s.name.trim() && sizeOk;
  const isDefault = settings.defaults.stampId === s.id;

  const close = async () => {
    if (dirty && editable && !(await confirm({ title: t('stampstudio.discardTitle'), body: t('stampstudio.discardBody'), confirm: t('stampstudio.discard'), danger: true }))) return;
    onClose();
  };
  const save = async () => {
    const saved = await run(() => saveRecord('stamps', { ...s, name: s.name.trim() }), t('common.saved'));
    if (saved) onClose();
  };
  const upload = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast(t('stampstudio.notImage'), 'error');
    if (f.size > MAX_IMAGE) return toast(t('err.file_too_large', { max: '8 MB' }), 'error');
    setUploading(true);
    await run(async () => {
      const url = await readFileAsDataURL(f);
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => undefined);
      const a = await saveAsset(f.name, url, f.type, img.naturalWidth || 100, img.naturalHeight || 100);
      set({ assetId: a.id });
    });
    setUploading(false);
  };

  return (
    <Modal
      size="xl"
      initialFocus={false}
      title={isNew ? t('stampstudio.new') : s.name || t('stampstudio.designer')}
      sub={isNew ? t('stampstudio.designerSub') : t('stampstudio.usedIn', { count: uses })}
      onClose={close}
      footer={
        <>
          {editable && !isNew && (
            <>
              <button className="btn danger" onClick={() => onDelete(initial)}>
                <Trash2 /> {t('common.delete')}
              </button>
              <button className="btn" disabled={!valid} onClick={() => onSaveCopy(s)}>
                <Copy /> {t('stampstudio.saveAsCopy')}
              </button>
              <button className="btn" disabled={isDefault} onClick={() => run(() => updateSettings({ defaults: { ...settings.defaults, stampId: s.id } }, 'default stamp'), t('stampstudio.defaultSet', { name: s.name }))}>
                <Star /> {isDefault ? t('stampstudio.default') : t('stampstudio.setDefault')}
              </button>
            </>
          )}
          <span className="grow" />
          <button className="btn" onClick={close}>
            {editable ? t('common.cancel') : t('common.close')}
          </button>
          {editable && (
            <button className="btn primary" disabled={!valid || (!dirty && !isNew)} onClick={save}>
              {t('common.save')}
            </button>
          )}
        </>
      }
    >
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="col gap-16">
          <div style={{ background: '#f1e6cc', backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.55), transparent 60%)', borderRadius: 12, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <StampView stamp={s} asset={asset} height={260} style={{ maxWidth: '100%', filter: 'drop-shadow(0 6px 14px rgba(40, 25, 10, 0.3))' }} />
          </div>
          <div className="row wrap">
            <div className="row" style={{ background: '#f1e6cc', borderRadius: 8, padding: 8 }}>
              <StampView stamp={s} asset={asset} style={{ width: `${s.w + 2}mm`, height: `${s.h + 2}mm` }} />
            </div>
            <div className="col grow" style={{ gap: 2 }}>
              <b className="small">{t('stampstudio.actualSize')}</b>
              <span className="muted small">
                {s.w}×{s.h} mm · {t(`stampshape.${s.shape}`)}
              </span>
            </div>
          </div>
          <Section title={t('common.export')}>
            <div className="row wrap gap-4">
              {FORMATS.map((f) => (
                <button key={f} type="button" className="btn sm" disabled={!sizeOk} onClick={() => run(() => exportSingle(stampSvg(s, asset), s.w, s.h, f, settings.print.resolution, s.name || 'stamp'), t('common.exported'))}>
                  <Download /> {f.toUpperCase()}
                </button>
              ))}
            </div>
          </Section>
          <Section title={t('stampstudio.printSheetTitle', { name: s.name })}>{sizeOk ? <SheetControls stamp={s} asset={asset} /> : <div className="muted small">{t('stampstudio.sizeInvalid', { min: MIN_MM, max: MAX_MM })}</div>}</Section>
        </div>

        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Section title={t('stampstudio.secBasics')}>
            <div className="form-grid">
              <Field label={t('field.name')} required className="full" error={!s.name.trim() ? t('stampstudio.nameRequired') : undefined}>
                <input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
              </Field>
              <Field label={t('stampstudio.category')}>
                <select className="select" value={s.category} onChange={(e) => set({ category: e.target.value as StampCategory })}>
                  {STAMP_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`stampcat.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('editor.shape')}>
                <select className="select" value={s.shape} onChange={(e) => set({ shape: e.target.value as Stamp['shape'] })}>
                  {SHAPES.map((sh) => (
                    <option key={sh} value={sh}>
                      {t(`stampshape.${sh}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('stampstudio.widthMm')} error={s.w < MIN_MM || s.w > MAX_MM ? t('stampstudio.sizeInvalid', { min: MIN_MM, max: MAX_MM }) : undefined}>
                <MmField value={s.w} onChange={(v) => set({ w: v })} label={t('stampstudio.widthMm')} />
              </Field>
              <Field label={t('stampstudio.heightMm')} error={s.h < MIN_MM || s.h > MAX_MM ? t('stampstudio.sizeInvalid', { min: MIN_MM, max: MAX_MM }) : undefined}>
                <MmField value={s.h} onChange={(v) => set({ h: v })} label={t('stampstudio.heightMm')} />
              </Field>
              <Field label={t('stampstudio.sizePresets')} className="full">
                <div className="row wrap gap-4">
                  {SIZE_PRESETS.map(([w, h]) => (
                    <button key={`${w}x${h}`} type="button" className={`btn xs ${s.w === w && s.h === h ? 'primary' : ''}`} onClick={() => set({ w, h })}>
                      {w}×{h}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Section>

          <Section title={t('stampstudio.secColours')}>
            <div className="form-grid">
              <Field label={t('stampstudio.colorBg')}>
                <ColorInput value={s.bg} onChange={(c) => set({ bg: c })} />
              </Field>
              <Field label={t('stampstudio.colorFrame')}>
                <ColorInput value={s.frame} onChange={(c) => set({ frame: c })} />
              </Field>
              <Field label={t('stampstudio.colorInk')}>
                <ColorInput value={s.ink} onChange={(c) => set({ ink: c })} />
              </Field>
              <Field label={t('stampstudio.colorAccent')}>
                <ColorInput value={s.accent} onChange={(c) => set({ accent: c })} />
              </Field>
              <Field label={t('stampstudio.presets', { category: t(`stampcat.${s.category}`) })} className="full">
                <div className="row wrap gap-4">
                  {PRESETS[s.category].map((p, i) => {
                    const on = p.bg === s.bg && p.frame === s.frame && p.ink === s.ink && p.accent === s.accent;
                    return (
                      <button key={i} type="button" className={`btn sm ${on ? 'primary' : ''}`} title={t('stampstudio.applyPreset')} aria-label={`${t('stampstudio.applyPreset')} ${i + 1}`} onClick={() => set(p)}>
                        {(['bg', 'frame', 'ink', 'accent'] as const).map((k) => (
                          <span key={k} className="swatch" style={{ background: p[k] }} />
                        ))}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </Section>

          <Section title={t('stampstudio.secArtwork')}>
            <div className="form-grid">
              <Field label={t('el.symbol')} className="full" hint={asset ? t('stampstudio.symbolHidden') : t(`symbol.${s.symbol}`)}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 4, maxHeight: 172, overflowY: 'auto', padding: 2 }}>
                  {SYMBOLS.map((sy) => (
                    <button
                      key={sy.key}
                      type="button"
                      className={`btn icon sm ${s.symbol === sy.key ? 'primary' : 'ghost'}`}
                      title={t(`symbol.${sy.key}`)}
                      aria-label={t(`symbol.${sy.key}`)}
                      aria-pressed={s.symbol === sy.key}
                      onClick={() => set({ symbol: sy.key })}
                    >
                      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
                        <SymbolGlyph symbol={sy.key} x={0} y={0} size={24} color="currentColor" strokeWidth={2} />
                      </svg>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('stampstudio.image')} className="full" hint={t('stampstudio.imageHint')}>
                {s.assetId ? (
                  <div className="row">
                    {asset ? <img src={asset.dataUrl} alt={asset.name} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} /> : null}
                    <span className="grow small truncate">{asset?.name ?? '—'}</span>
                    <button type="button" className="btn sm danger" onClick={() => set({ assetId: undefined })}>
                      <ImageOff /> {t('stampstudio.removeImage')}
                    </button>
                  </div>
                ) : editable ? (
                  <Dropzone accept="image/png,image/jpeg,image/webp,image/svg+xml" onFiles={upload} label={uploading ? t('common.saving') : t('stampstudio.uploadImage')} />
                ) : (
                  <span className="muted small">—</span>
                )}
              </Field>
              <Field label={t('stampstudio.pattern')} className="full">
                <select className="select" value={s.pattern} onChange={(e) => set({ pattern: e.target.value as Stamp['pattern'] })}>
                  {PATTERNS.map((p) => (
                    <option key={p} value={p}>
                      {t(`stamppattern.${p}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section title={t('stampstudio.secText')}>
            <div className="form-grid">
              <Field label={t('stampstudio.title')} className="full">
                <input className="input" value={s.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label={t('stampstudio.value')}>
                <input className="input" value={s.value} onChange={(e) => set({ value: e.target.value })} maxLength={8} />
              </Field>
              <Field label={t('stampstudio.subtitle')}>
                <input className="input" value={s.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
              </Field>
              <Field label={t('editor.font')} className="full">
                <select className="select" value={s.font} onChange={(e) => set({ font: e.target.value as Stamp['font'] })} style={{ fontFamily: FONTS[s.font]?.stack }}>
                  {FONT_KEYS.map((k) => (
                    <option key={k} value={k} style={{ fontFamily: FONTS[k].stack }}>
                      {FONTS[k].label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>
        </fieldset>
      </div>
    </Modal>
  );
}

// ───────────── Library ─────────────

export function StampStudio() {
  const { t } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { contextMenu } = useFeedback();
  const settings = useSettings();
  const lib = useLib();
  const data = useLiveQuery(async () => {
    const usage = new Map<string, number>();
    const bump = (id?: string) => {
      if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
    };
    await db.projects.each((p) => bump(p.stampId));
    await db.templates.each((tp) => bump(tp.stampId));
    return { stamps: await db.stamps.toArray(), usage };
  }, []);
  const [cat, setCat] = useState<'all' | StampCategory>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ stamp: Stamp; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Stamp | null>(null);
  const [printing, setPrinting] = useState<Stamp | null>(null);
  if (!data) return null;
  const editable = can('design.edit');
  const defaultId = settings.defaults.stampId;
  const assetOf = (s: Stamp) => (s.assetId ? lib.assets.get(s.assetId) : undefined);
  const n = normalizeText(q);
  const list = data.stamps
    .filter((s) => (cat === 'all' || s.category === cat) && (!n || normalizeText(`${s.name} ${s.title} ${s.subtitle} ${t(`stampcat.${s.category}`)}`).includes(n)))
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.name.localeCompare(b.name));
  const countIn = (c: StampCategory) => data.stamps.filter((s) => s.category === c).length;

  const blank = (): Stamp => {
    const category: StampCategory = cat === 'all' ? 'owl_post' : cat;
    const now = nowISO();
    return {
      id: uid(),
      name: t('stampstudio.newName'),
      category,
      shape: 'perforated',
      w: 26,
      h: 31,
      ...PRESETS[category][0],
      symbol: CATEGORY_SYMBOL[category],
      title: t(`stampcat.${category}`).toUpperCase(),
      value: '1',
      subtitle: (settings.company.schoolName || '').toUpperCase().slice(0, 24),
      font: 'cinzel',
      pattern: 'guilloche',
      createdAt: now,
      updatedAt: now,
    };
  };
  const saveCopy = async (s: Stamp) => {
    const now = nowISO();
    const copy: Stamp = { ...s, id: uid(), name: t('stampstudio.copyOf', { name: s.name }), createdAt: now, updatedAt: now };
    const saved = await run(() => saveRecord('stamps', copy), t('stampstudio.duplicated'));
    return saved;
  };
  const setDefault = (s: Stamp) => run(() => updateSettings({ defaults: { ...settings.defaults, stampId: s.id } }, 'default stamp'), t('stampstudio.defaultSet', { name: s.name }));
  const exportAs = (s: Stamp, f: ExportFormat) => run(() => exportSingle(stampSvg(s, assetOf(s)), s.w, s.h, f, settings.print.resolution, s.name), t('common.exported'));
  const open = (s: Stamp) => setEditing({ stamp: s, isNew: false });
  const menu = (s: Stamp) => [
    { label: editable ? t('common.edit') : t('common.open'), icon: <Pencil />, onClick: () => open(s) },
    ...(editable
      ? [
          { label: t('common.duplicate'), icon: <Copy />, onClick: () => void saveCopy(s) },
          { label: t('stampstudio.setDefault'), icon: <Star />, onClick: () => void setDefault(s), disabled: s.id === defaultId },
        ]
      : []),
    { label: t('stampstudio.printSheet'), icon: <Printer />, onClick: () => setPrinting(s) },
    { label: '', divider: true },
    ...FORMATS.map((f) => ({ label: `${t('common.export')} ${f.toUpperCase()}`, icon: <Download />, onClick: () => void exportAs(s, f) })),
    ...(editable ? [{ label: '', divider: true }, { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => setDeleting(s) }] : []),
  ];

  return (
    <div>
      <PageHeader
        title={t('nav.stamps')}
        sub={t('stampstudio.sub')}
        actions={
          editable && (
            <button className="btn primary" onClick={() => setEditing({ stamp: blank(), isNew: true })}>
              <Plus /> {t('stampstudio.new')}
            </button>
          )
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('stampstudio.search')} />
      </div>
      <div className="row wrap gap-4 mb-16" role="tablist" aria-label={t('stampstudio.category')}>
        <button className={`btn sm ${cat === 'all' ? 'primary' : 'ghost'}`} role="tab" aria-selected={cat === 'all'} onClick={() => setCat('all')}>
          {t('common.all')} <span className={cat === 'all' ? '' : 'muted'}>{data.stamps.length}</span>
        </button>
        {STAMP_CATEGORIES.map((c) => (
          <button key={c} className={`btn sm ${cat === c ? 'primary' : 'ghost'}`} role="tab" aria-selected={cat === c} onClick={() => setCat(c)}>
            {t(`stampcat.${c}`)} <span className={cat === c ? '' : 'muted'}>{countIn(c)}</span>
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="thumb-grid">
          {list.map((s) => {
            const uses = data.usage.get(s.id) ?? 0;
            const isDefault = s.id === defaultId;
            return (
              <div
                key={s.id}
                className="thumb-card"
                role="button"
                tabIndex={0}
                onClick={() => open(s)}
                onKeyDown={(e: ReactKeyboardEvent) => e.key === 'Enter' && open(s)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  contextMenu(e, menu(s));
                }}
              >
                {isDefault && (
                  <span className="check-mark" title={t('stampstudio.default')}>
                    <Star />
                  </span>
                )}
                <div className="art">
                  <StampView stamp={s} height={84} asset={assetOf(s)} />
                </div>
                <div className="title truncate">{s.name}</div>
                <div className="meta">
                  {t(`stampcat.${s.category}`)} · {s.w}×{s.h} mm
                </div>
                <div className="row wrap gap-4">
                  {isDefault && <Badge tone="success">{t('stampstudio.default')}</Badge>}
                  <Badge tone={uses ? 'info' : 'neutral'}>{t('stampstudio.usedIn', { count: uses })}</Badge>
                </div>
                <div className="row gap-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {editable && (
                    <>
                      <button className="btn xs ghost icon" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={() => void saveCopy(s)}>
                        <Copy />
                      </button>
                      <button className="btn xs ghost icon" title={t('stampstudio.setDefault')} aria-label={t('stampstudio.setDefault')} disabled={isDefault} onClick={() => void setDefault(s)}>
                        <Star />
                      </button>
                    </>
                  )}
                  <button className="btn xs ghost icon" title={t('stampstudio.printSheet')} aria-label={t('stampstudio.printSheet')} onClick={() => setPrinting(s)}>
                    <Printer />
                  </button>
                  <button className="btn xs ghost icon" title={`${t('common.export')} PNG`} aria-label={`${t('common.export')} PNG`} onClick={() => void exportAs(s, 'png')}>
                    <Download />
                  </button>
                  <span className="grow" />
                  {editable && (
                    <button className="btn xs ghost icon danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(s)}>
                      <Trash2 />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<StampIcon />}
          title={data.stamps.length ? t('common.noResults') : t('stampstudio.empty')}
          text={data.stamps.length ? undefined : t('stampstudio.emptyHint')}
          action={
            editable ? (
              <button className="btn primary" onClick={() => setEditing({ stamp: blank(), isNew: true })}>
                <Plus /> {t('stampstudio.new')}
              </button>
            ) : undefined
          }
        />
      )}
      {editing && (
        <StampDesigner
          key={editing.stamp.id}
          initial={editing.stamp}
          isNew={editing.isNew}
          uses={data.usage.get(editing.stamp.id) ?? 0}
          onClose={() => setEditing(null)}
          onSaveCopy={async (s) => {
            const copy = await saveCopy(s);
            if (copy) setEditing({ stamp: copy, isNew: false });
          }}
          onDelete={(s) => {
            setEditing(null);
            setDeleting(s);
          }}
        />
      )}
      {deleting && <DeleteStampModal stamp={deleting} onClose={() => setDeleting(null)} />}
      {printing && <PrintSheetModal stamp={printing} asset={assetOf(printing)} onClose={() => setPrinting(null)} />}
    </div>
  );
}
