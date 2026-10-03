import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, Copy, Download, LayoutGrid, List, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { paperStyle } from '../../core/defaults';
import { FONT_KEYS, POSTMARK_SHAPES, type Asset, type Postmark, type PostmarkShape, type Stamp } from '../../core/types';
import { normalizeText, nowISO, todayISO, uid } from '../../core/util';
import { db } from '../../db/db';
import { deleteRecord, saveRecord, updateProject, updateSettings } from '../../db/services';
import { useFmt, useLib, useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import { exportSingle, type ExportFormat } from '../../render/export';
import { FONTS } from '../../render/fonts';
import { PaperBackground } from '../../render/paper';
import { formatPostmarkDate, PostmarkArt, postmarkBox } from '../../render/postmark';
import { StampArt } from '../../render/stamp';
import { PostmarkView } from '../../ui/art';
import { Badge, ColorInput, DataTable, EmptyState, Field, Modal, PageHeader, Range, SearchInput, Section, type Column } from '../../ui/kit';
import { ExportMenu } from '../shared/ExportMenu';

const FORMATS: ExportFormat[] = ['png', 'svg', 'pdf'];
const DATE_FORMATS: Postmark['dateFormat'][] = ['DD MMM YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD', 'MMM DD YYYY', 'DD MMM'];
const DATE_SOURCES: Postmark['dateSource'][] = ['today', 'fixed', 'ship'];
const INKS: { key: string; color: string }[] = [
  { key: 'black', color: '#2b2b2b' },
  { key: 'navy', color: '#1f3d6b' },
  { key: 'burgundy', color: '#7a1f1a' },
  { key: 'brown', color: '#5a4026' },
  { key: 'green', color: '#2f5233' },
  { key: 'violet', color: '#4a2a6c' },
];
const WEAR_PRESETS: { key: string; value: number }[] = [
  { key: 'crisp', value: 0 },
  { key: 'used', value: 0.35 },
  { key: 'worn', value: 0.7 },
];
const MIN_SIZE = 15;
const MAX_SIZE = 60;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Bounding box of a w×h rectangle rotated by `deg` degrees. */
function rotatedBox(w: number, h: number, deg: number): [number, number] {
  const a = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return [w * c + h * s, w * s + h * c];
}

/** Artwork box padded so that rotation and ink wear never get clipped. */
function exportGeometry(pm: Postmark) {
  const [W, H] = postmarkBox(pm);
  const [rw, rh] = rotatedBox(W, H, pm.rotation);
  const pad = Math.max(W, H) * 0.05 + 0.5;
  const ew = r2(rw + pad * 2);
  const eh = r2(rh + pad * 2);
  return { W, H, ew, eh, x: (ew - W) / 2, y: (eh - H) / 2 };
}

function postmarkSvg(pm: Postmark, locale: string) {
  const g = exportGeometry(pm);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${g.ew} ${g.eh}`} width={`${g.ew}mm`} height={`${g.eh}mm`}>
      <PostmarkArt pm={pm} uid="xpm" locale={locale} box={{ x: g.x, y: g.y, w: g.W, h: g.H }} />
    </svg>
  );
}

function PlainPostmark({ pm, locale, uidKey, maxHeight, actual }: { pm: Postmark; locale: string; uidKey: string; maxHeight?: number; actual?: boolean }) {
  const g = exportGeometry(pm);
  return (
    <svg
      viewBox={`0 0 ${g.ew} ${g.eh}`}
      width={actual ? `${g.ew}mm` : '100%'}
      height={actual ? `${g.eh}mm` : undefined}
      style={actual ? undefined : { maxHeight, display: 'block' }}
      role="img"
      aria-label={pm.name}
    >
      <PostmarkArt pm={pm} uid={uidKey} locale={locale} box={{ x: g.x, y: g.y, w: g.W, h: g.H }} />
    </svg>
  );
}

/** Corner of an envelope on parchment: the stamp glued on, the postmark cancelling it. */
function PostmarkScene({ pm, stamp, asset, locale }: { pm: Postmark; stamp?: Stamp; asset?: Asset; locale: string }) {
  const [W, H] = postmarkBox(pm);
  const s = pm.size;
  let px = 0;
  let py = 0;
  if (stamp) {
    if (pm.shape === 'duplex' || pm.shape === 'wavy') {
      // Dated ring beside the stamp, killer bars across it.
      px = -s * 1.08 - 3;
      py = stamp.h / 2 - H / 2;
    } else {
      px = -W * 0.5;
      py = stamp.h * 0.55 - H / 2;
    }
  }
  const [rw, rh] = rotatedBox(W, H, pm.rotation);
  const cx = px + W / 2;
  const cy = py + H / 2;
  const minX = Math.min(stamp ? 0 : Infinity, cx - rw / 2);
  const maxX = Math.max(stamp ? stamp.w : -Infinity, cx + rw / 2);
  const minY = Math.min(stamp ? 0 : Infinity, cy - rh / 2);
  const maxY = Math.max(stamp ? stamp.h : -Infinity, cy + rh / 2);
  const left = 26;
  const right = 8;
  const top = 8;
  const bottom = 20;
  const w = maxX - minX + left + right;
  const h = maxY - minY + top + bottom;
  const ox = left - minX;
  const oy = top - minY;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: 340, display: 'block' }} role="img" aria-label={pm.name}>
      <defs>
        <filter id="pms-shadow" x="-10%" y="-10%" width="125%" height="125%">
          <feDropShadow dx={0.25} dy={0.4} stdDeviation={0.35} floodColor="#3a2410" floodOpacity={0.35} />
        </filter>
      </defs>
      <PaperBackground id="pms-paper" w={w} h={h} paper={paperStyle('parchment')} rounded={1.5} />
      {stamp && (
        <g filter="url(#pms-shadow)">
          <StampArt stamp={stamp} uid="pms-stamp" asset={asset} box={{ x: ox, y: oy, w: stamp.w, h: stamp.h }} />
        </g>
      )}
      <g style={{ mixBlendMode: 'multiply' }}>
        <PostmarkArt pm={pm} uid="pms-pm" locale={locale} box={{ x: ox + px, y: oy + py, w: W, h: H }} />
      </g>
    </svg>
  );
}

// ───────────── Delete with reassignment ─────────────

function DeletePostmarkModal({ pm, onClose }: { pm: Postmark; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  const data = useLiveQuery(
    async () => ({
      postmarks: await db.postmarks.toArray(),
      projects: await db.projects.filter((p) => p.postmarkId === pm.id).toArray(),
      templates: await db.templates.filter((tp) => tp.postmarkId === pm.id).toArray(),
    }),
    [pm.id],
  );
  const [replacement, setReplacement] = useState<string | null>(null);
  if (!data) return null;
  const isDefault = settings.defaults.postmarkId === pm.id;
  const others = data.postmarks.filter((x) => x.id !== pm.id).sort((a, b) => a.name.localeCompare(b.name));
  const fallback = isDefault ? others.find((x) => x.shape === pm.shape)?.id ?? others[0]?.id ?? '' : settings.defaults.postmarkId ?? '';
  const target = replacement ?? fallback;
  const uses = data.projects.length + data.templates.length;
  const doDelete = async () => {
    const ok = await run(async () => {
      for (const p of data.projects) await updateProject(p.id, { postmarkId: target || undefined });
      for (const tp of data.templates) await saveRecord('templates', { ...tp, postmarkId: target || undefined });
      if (isDefault) await updateSettings({ defaults: { ...settings.defaults, postmarkId: target || undefined } }, 'default postmark');
      await deleteRecord('postmarks', pm.id);
      return true;
    }, t('common.deleted'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('pmstudio.deleteTitle', { name: pm.name })}
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
      <p style={{ marginTop: 0 }}>{t('pmstudio.deleteBody')}</p>
      {uses > 0 && <div className="issue warning mb-8">{t('pmstudio.deleteInUse', { projects: data.projects.length, templates: data.templates.length })}</div>}
      {isDefault && <div className="issue warning mb-8">{t('pmstudio.deleteIsDefault')}</div>}
      {(uses > 0 || isDefault) && (
        <Field label={t('libstudio.replaceWith')} hint={t('libstudio.replaceHint')}>
          <select className="select" value={target} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">— {t('common.none')}</option>
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {t(`pmshape.${x.shape}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  );
}

// ───────────── Designer ─────────────

function PostmarkDesigner({
  initial,
  isNew,
  uses,
  onClose,
  onSaveCopy,
  onDelete,
}: {
  initial: Postmark;
  isNew: boolean;
  uses: number;
  onClose: () => void;
  onSaveCopy: (pm: Postmark) => void;
  onDelete: (pm: Postmark) => void;
}) {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const lib = useLib();
  const settings = useSettings();
  const [pm, setPm] = useState<Postmark>(initial);
  const [view, setView] = useState<'scene' | 'plain'>('scene');
  const set = (p: Partial<Postmark>) => setPm((x) => ({ ...x, ...p }));
  const editable = can('design.edit');
  const dirty = JSON.stringify(pm) !== JSON.stringify(initial);
  const valid = !!pm.name.trim() && pm.size >= MIN_SIZE && pm.size <= MAX_SIZE;
  const isDefault = settings.defaults.postmarkId === pm.id;
  const stamp: Stamp | undefined = (settings.defaults.stampId ? lib.stamps.get(settings.defaults.stampId) : undefined) ?? Array.from(lib.stamps.values())[0];
  const stampAsset = stamp?.assetId ? lib.assets.get(stamp.assetId) : undefined;
  const g = exportGeometry(pm);
  const today = todayISO();
  const shownDate = pm.dateSource === 'fixed' && pm.fixedDate ? pm.fixedDate : today;

  const close = async () => {
    if (dirty && editable && !(await confirm({ title: t('libstudio.discardTitle'), body: t('libstudio.discardBody'), confirm: t('libstudio.discard'), danger: true }))) return;
    onClose();
  };
  const save = async () => {
    if (!editable || !valid || (!dirty && !isNew)) return;
    const saved = await run(() => saveRecord('postmarks', { ...pm, name: pm.name.trim() }), t('common.saved'));
    if (saved) onClose();
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <Modal
      size="xl"
      initialFocus={false}
      title={isNew ? t('pmstudio.new') : pm.name || t('pmstudio.designer')}
      sub={isNew ? t('pmstudio.designerSub') : uses ? t('libstudio.usedIn', { count: uses }) : t('libstudio.unused')}
      onClose={close}
      footer={
        <>
          {editable && !isNew && (
            <>
              <button className="btn danger" onClick={() => onDelete(initial)}>
                <Trash2 /> {t('common.delete')}
              </button>
              <button className="btn" disabled={!valid} onClick={() => onSaveCopy(pm)}>
                <Copy /> {t('libstudio.saveAsCopy')}
              </button>
              <button className="btn" disabled={isDefault} onClick={() => run(() => updateSettings({ defaults: { ...settings.defaults, postmarkId: pm.id } }, 'default postmark'), t('pmstudio.defaultSet', { name: pm.name }))}>
                <Star /> {isDefault ? t('libstudio.default') : t('libstudio.setDefault')}
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
          <div className="row">
            <div className="btn-group">
              <button type="button" className={`btn sm ${view === 'scene' ? 'active' : ''}`} aria-pressed={view === 'scene'} onClick={() => setView('scene')}>
                {t('pmstudio.viewScene')}
              </button>
              <button type="button" className={`btn sm ${view === 'plain' ? 'active' : ''}`} aria-pressed={view === 'plain'} onClick={() => setView('plain')}>
                {t('pmstudio.viewPlain')}
              </button>
            </div>
            <span className="grow" />
            <span className="muted small">
              {r2(g.W)}×{r2(g.H)} mm
            </span>
          </div>
          {view === 'scene' ? (
            <div className="col gap-4">
              <div style={{ background: '#e9dcc0', borderRadius: 12, padding: 16, minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PostmarkScene pm={pm} stamp={stamp} asset={stampAsset} locale={locale} />
              </div>
              <div className="muted small">{stamp ? t('pmstudio.sceneHint', { stamp: stamp.name }) : t('pmstudio.noStampHint')}</div>
            </div>
          ) : (
            <div style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 12, padding: 24, minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PlainPostmark pm={pm} locale={locale} uidKey="pmd-plain" maxHeight={280} />
            </div>
          )}
          <div className="row wrap">
            <div className="row" style={{ background: '#f1e6cc', borderRadius: 8, padding: 8, maxWidth: '100%', overflow: 'hidden' }}>
              <PlainPostmark pm={pm} locale={locale} uidKey="pmd-actual" actual />
            </div>
            <div className="col grow" style={{ gap: 2 }}>
              <b className="small">{t('libstudio.actualSize')}</b>
              <span className="muted small">
                {t(`pmshape.${pm.shape}`)} · {pm.size} mm · {formatPostmarkDate(pm, shownDate, locale)}
              </span>
            </div>
          </div>
          <Section title={t('common.export')}>
            <div className="row wrap gap-4">
              {FORMATS.map((f) => (
                <button key={f} type="button" className="btn sm" disabled={!valid} onClick={() => run(() => exportSingle(postmarkSvg(pm, locale), g.ew, g.eh, f, settings.print.resolution, pm.name || 'postmark'), t('common.exported'))}>
                  <Download /> {f.toUpperCase()}
                </button>
              ))}
            </div>
          </Section>
        </div>

        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Section title={t('pmstudio.secText')}>
            <div className="form-grid">
              <Field label={t('field.name')} required className="full" error={!pm.name.trim() ? t('libstudio.nameRequired') : undefined}>
                <input className="input" value={pm.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
              </Field>
              <Field label={t('pmstudio.text')} hint={t('pmstudio.textHint')}>
                <input className="input" value={pm.text} maxLength={40} onChange={(e) => set({ text: e.target.value })} />
              </Field>
              <Field label={t('pmstudio.location')} hint={t('pmstudio.locationHint')}>
                <input className="input" value={pm.location} maxLength={40} onChange={(e) => set({ location: e.target.value })} />
              </Field>
              <Field label={t('pmstudio.number')}>
                <input className="input" value={pm.number} maxLength={12} onChange={(e) => set({ number: e.target.value })} />
              </Field>
              <Field label={t('pmstudio.dateFormat')}>
                <select className="select" value={pm.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as Postmark['dateFormat'] })}>
                  {DATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f} — {formatPostmarkDate({ ...pm, dateFormat: f }, shownDate, locale)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('pmstudio.dateSource')}
                className="full"
                hint={t(`pmstudio.srcHint.${pm.dateSource}`)}
                warning={pm.dateSource === 'fixed' && !pm.fixedDate ? t('pmstudio.fixedDateMissing') : undefined}
              >
                <div className="row wrap">
                  <div className="btn-group">
                    {DATE_SOURCES.map((src) => (
                      <button
                        key={src}
                        type="button"
                        className={`btn sm ${pm.dateSource === src ? 'active' : ''}`}
                        aria-pressed={pm.dateSource === src}
                        onClick={() => set({ dateSource: src, fixedDate: src === 'fixed' ? pm.fixedDate ?? today : pm.fixedDate })}
                      >
                        {t(`pmstudio.src.${src}`)}
                      </button>
                    ))}
                  </div>
                  {pm.dateSource === 'fixed' && (
                    <input className="input sm" type="date" style={{ width: 160 }} aria-label={t('pmstudio.fixedDate')} value={pm.fixedDate ?? ''} onChange={(e) => set({ fixedDate: e.target.value || undefined })} />
                  )}
                </div>
              </Field>
              <Field label={t('editor.font')} className="full">
                <select className="select" value={pm.font} onChange={(e) => set({ font: e.target.value as Postmark['font'] })} style={{ fontFamily: FONTS[pm.font]?.stack }}>
                  {FONT_KEYS.map((k) => (
                    <option key={k} value={k} style={{ fontFamily: FONTS[k].stack }}>
                      {FONTS[k].label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section title={t('pmstudio.secAppearance')}>
            <div className="form-grid">
              <Field label={t('editor.shape')} className="full">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 6 }}>
                  {POSTMARK_SHAPES.map((sh: PostmarkShape) => {
                    const on = pm.shape === sh;
                    return (
                      <button key={sh} type="button" className={`thumb-card ${on ? 'selected' : ''}`} style={{ padding: 6, gap: 4 }} aria-pressed={on} onClick={() => set({ shape: sh })}>
                        <div className="art" style={{ padding: 4 }}>
                          <PostmarkView pm={{ ...pm, shape: sh, rotation: 0, inkWear: 0, opacity: 1 }} height={36} style={{ maxWidth: '100%' }} />
                        </div>
                        <div className="tiny truncate" style={{ textAlign: 'center' }}>
                          {t(`pmshape.${sh}`)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label={t('pmstudio.sizeMm')} className="full">
                <Range value={pm.size} min={MIN_SIZE} max={MAX_SIZE} step={1} onChange={(v) => set({ size: v })} format={(v) => `${v} mm`} />
              </Field>
              <Field label={t('editor.opacity')}>
                <Range value={pm.opacity} min={0.2} max={1} step={0.05} onChange={(v) => set({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Field>
              <Field label={t('editor.rotation')}>
                <Range value={pm.rotation} min={-45} max={45} step={1} onChange={(v) => set({ rotation: v })} format={(v) => `${v}°`} />
              </Field>
              <Field label={t('pmstudio.inkWear')} className="full" hint={t('pmstudio.inkWearHint')}>
                <Range value={pm.inkWear} min={0} max={1} step={0.05} onChange={(v) => set({ inkWear: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <div className="row wrap gap-4 mt-8">
                  {WEAR_PRESETS.map((w) => (
                    <button key={w.key} type="button" className={`btn xs ${Math.abs(pm.inkWear - w.value) < 0.001 ? 'primary' : ''}`} onClick={() => set({ inkWear: w.value })}>
                      {t(`pmstudio.wear.${w.key}`)}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t('editor.color')} className="full">
                <ColorInput value={pm.color} onChange={(c) => set({ color: c })} />
                <div className="row wrap gap-4 mt-8">
                  {INKS.map((ink) => {
                    const on = pm.color.toLowerCase() === ink.color;
                    return (
                      <button key={ink.key} type="button" className={`btn xs ${on ? 'primary' : ''}`} aria-pressed={on} onClick={() => set({ color: ink.color })}>
                        <span className="swatch" style={{ background: ink.color }} /> {t(`colorname.${ink.key}`)}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </Section>
        </fieldset>
      </div>
    </Modal>
  );
}

// ───────────── Library ─────────────

export function PostmarkStudio() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { contextMenu } = useFeedback();
  const settings = useSettings();
  const fmt = useFmt();
  const data = useLiveQuery(async () => {
    const usage = new Map<string, number>();
    const bump = (id?: string) => {
      if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
    };
    await db.projects.each((p) => bump(p.postmarkId));
    await db.templates.each((tp) => bump(tp.postmarkId));
    return { postmarks: await db.postmarks.toArray(), usage };
  }, []);
  const [shape, setShape] = useState<'all' | PostmarkShape>('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [editing, setEditing] = useState<{ pm: Postmark; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Postmark | null>(null);
  if (!data) return null;
  const editable = can('design.edit');
  const defaultId = settings.defaults.postmarkId;
  const usesOf = (pm: Postmark) => data.usage.get(pm.id) ?? 0;
  const n = normalizeText(q);
  const list = data.postmarks
    .filter((pm) => (shape === 'all' || pm.shape === shape) && (!n || normalizeText(`${pm.name} ${pm.text} ${pm.location} ${pm.number} ${t(`pmshape.${pm.shape}`)}`).includes(n)))
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.name.localeCompare(b.name));
  const countIn = (s: PostmarkShape) => data.postmarks.filter((pm) => pm.shape === s).length;
  const usedShapes = POSTMARK_SHAPES.filter((s) => countIn(s) > 0);

  const blank = (): Postmark => {
    const now = nowISO();
    return {
      id: uid(),
      name: t('pmstudio.newName'),
      text: t('pmstudio.defaultText'),
      location: settings.company.schoolName || t('pmstudio.defaultLocation'),
      dateFormat: 'DD MMM YYYY',
      dateSource: 'today',
      number: '',
      shape: shape === 'all' ? 'double' : shape,
      size: 28,
      opacity: 0.85,
      rotation: -8,
      inkWear: 0.4,
      color: '#2b2b2b',
      font: 'oswald',
      createdAt: now,
      updatedAt: now,
    };
  };
  const saveCopy = async (pm: Postmark) => {
    const now = nowISO();
    const copy: Postmark = { ...pm, id: uid(), name: t('libstudio.copyOf', { name: pm.name }), createdAt: now, updatedAt: now };
    return run(() => saveRecord('postmarks', copy), t('pmstudio.duplicated'));
  };
  const setDefault = (pm: Postmark) => run(() => updateSettings({ defaults: { ...settings.defaults, postmarkId: pm.id } }, 'default postmark'), t('pmstudio.defaultSet', { name: pm.name }));
  const exportAs = (pm: Postmark, f: ExportFormat) => {
    const g = exportGeometry(pm);
    return run(() => exportSingle(postmarkSvg(pm, locale), g.ew, g.eh, f, settings.print.resolution, pm.name || 'postmark'), t('common.exported'));
  };
  const open = (pm: Postmark) => setEditing({ pm, isNew: false });
  const create = () => setEditing({ pm: blank(), isNew: true });
  const menu = (pm: Postmark) => [
    { label: editable ? t('common.edit') : t('common.open'), icon: <Pencil />, onClick: () => open(pm) },
    ...(editable
      ? [
          { label: t('common.duplicate'), icon: <Copy />, onClick: () => void saveCopy(pm) },
          { label: t('libstudio.setDefault'), icon: <Star />, onClick: () => void setDefault(pm), disabled: pm.id === defaultId },
        ]
      : []),
    { label: '', divider: true },
    ...FORMATS.map((f) => ({ label: `${t('common.export')} ${f.toUpperCase()}`, icon: <Download />, onClick: () => void exportAs(pm, f) })),
    ...(editable ? [{ label: '', divider: true }, { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => setDeleting(pm) }] : []),
  ];

  const columns: Column<Postmark>[] = [
    { key: 'art', header: t('common.preview'), width: 110, render: (pm) => <PostmarkView pm={pm} height={34} /> },
    {
      key: 'name',
      header: t('field.name'),
      sort: (pm) => pm.name,
      render: (pm) => (
        <span className="row gap-4">
          <b>{pm.name}</b>
          {pm.id === defaultId && <Badge tone="success">{t('libstudio.default')}</Badge>}
        </span>
      ),
    },
    { key: 'shape', header: t('editor.shape'), sort: (pm) => t(`pmshape.${pm.shape}`), render: (pm) => t(`pmshape.${pm.shape}`) },
    { key: 'text', header: t('pmstudio.text'), sort: (pm) => pm.text, render: (pm) => <span className="truncate">{[pm.text, pm.location].filter(Boolean).join(' · ')}</span> },
    { key: 'size', header: t('pmstudio.sizeMm'), sort: (pm) => pm.size, className: 'num', render: (pm) => pm.size },
    {
      key: 'color',
      header: t('editor.color'),
      render: (pm) => (
        <span className="row gap-4">
          <span className="swatch" style={{ background: pm.color }} />
          <span className="mono tiny">{pm.color}</span>
        </span>
      ),
    },
    { key: 'uses', header: t('libstudio.usage'), sort: usesOf, className: 'num', render: (pm) => usesOf(pm) },
    { key: 'updated', header: t('field.lastUpdated'), sort: (pm) => pm.updatedAt, render: (pm) => fmt.date(pm.updatedAt) },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.studio')}
        title={t('nav.postmarks')}
        sub={t('pmstudio.sub')}
        actions={
          <>
            <div className="btn-group">
              <button className={`btn icon ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} aria-label={t('common.grid')} title={t('common.grid')}>
                <LayoutGrid />
              </button>
              <button className={`btn icon ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} aria-label={t('common.table')} title={t('common.table')}>
                <List />
              </button>
            </div>
            <ExportMenu
              name={t('nav.postmarks')}
              formats={['csv', 'xlsx', 'json']}
              build={() => ({
                head: [t('field.name'), t('editor.shape'), t('pmstudio.text'), t('pmstudio.location'), t('pmstudio.number'), t('pmstudio.dateFormat'), t('pmstudio.dateSource'), t('pmstudio.sizeMm'), t('editor.color'), t('libstudio.usage'), t('libstudio.default')],
                rows: list.map((pm) => [pm.name, t(`pmshape.${pm.shape}`), pm.text, pm.location, pm.number, pm.dateFormat, t(`pmstudio.src.${pm.dateSource}`), pm.size, pm.color, usesOf(pm), pm.id === defaultId ? '✓' : '']),
                json: list,
              })}
            />
            {editable && (
              <button className="btn primary" onClick={create}>
                <Plus /> {t('pmstudio.new')}
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('pmstudio.search')} />
      </div>
      {usedShapes.length > 1 && (
        <div className="row wrap gap-4 mb-16" role="tablist" aria-label={t('editor.shape')}>
          <button className={`btn sm ${shape === 'all' ? 'primary' : 'ghost'}`} role="tab" aria-selected={shape === 'all'} onClick={() => setShape('all')}>
            {t('common.all')} <span className={shape === 'all' ? '' : 'muted'}>{data.postmarks.length}</span>
          </button>
          {usedShapes.map((s) => (
            <button key={s} className={`btn sm ${shape === s ? 'primary' : 'ghost'}`} role="tab" aria-selected={shape === s} onClick={() => setShape(s)}>
              {t(`pmshape.${s}`)} <span className={shape === s ? '' : 'muted'}>{countIn(s)}</span>
            </button>
          ))}
        </div>
      )}
      {!list.length ? (
        <EmptyState
          icon={<Archive />}
          title={data.postmarks.length ? t('common.noResults') : t('pmstudio.empty')}
          text={data.postmarks.length ? undefined : t('pmstudio.emptyHint')}
          action={
            editable ? (
              <button className="btn primary" onClick={create}>
                <Plus /> {t('pmstudio.new')}
              </button>
            ) : undefined
          }
        />
      ) : view === 'table' ? (
        <div className="card">
          <DataTable
            rows={list}
            columns={columns}
            rowKey={(pm) => pm.id}
            onRowClick={open}
            onContextMenu={(pm, e) => {
              e.preventDefault();
              contextMenu(e, menu(pm));
            }}
          />
        </div>
      ) : (
        <div className="thumb-grid">
          {list.map((pm) => {
            const uses = usesOf(pm);
            const isDefault = pm.id === defaultId;
            return (
              <div
                key={pm.id}
                className="thumb-card"
                role="button"
                tabIndex={0}
                onClick={() => open(pm)}
                onKeyDown={(e: ReactKeyboardEvent) => e.key === 'Enter' && open(pm)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  contextMenu(e, menu(pm));
                }}
              >
                {isDefault && (
                  <span className="check-mark" title={t('libstudio.default')}>
                    <Star />
                  </span>
                )}
                <div className="art" style={{ background: '#f1e6cc' }}>
                  <PostmarkView pm={pm} height={70} />
                </div>
                <div className="title truncate">{pm.name}</div>
                <div className="meta">
                  {t(`pmshape.${pm.shape}`)} · {pm.size} mm
                </div>
                <div className="row wrap gap-4">
                  {isDefault && <Badge tone="success">{t('libstudio.default')}</Badge>}
                  <Badge tone={uses ? 'info' : 'neutral'}>{uses ? t('libstudio.usedIn', { count: uses }) : t('libstudio.unused')}</Badge>
                </div>
                <div className="row gap-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {editable && (
                    <>
                      <button className="btn xs ghost icon" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={() => void saveCopy(pm)}>
                        <Copy />
                      </button>
                      <button className="btn xs ghost icon" title={t('libstudio.setDefault')} aria-label={t('libstudio.setDefault')} disabled={isDefault} onClick={() => void setDefault(pm)}>
                        <Star />
                      </button>
                    </>
                  )}
                  <button className="btn xs ghost icon" title={`${t('common.export')} PNG`} aria-label={`${t('common.export')} PNG`} onClick={() => void exportAs(pm, 'png')}>
                    <Download />
                  </button>
                  <span className="grow" />
                  {editable && (
                    <button className="btn xs ghost icon danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleting(pm)}>
                      <Trash2 />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <PostmarkDesigner
          key={editing.pm.id}
          initial={editing.pm}
          isNew={editing.isNew}
          uses={data.usage.get(editing.pm.id) ?? 0}
          onClose={() => setEditing(null)}
          onSaveCopy={async (pm) => {
            const copy = await saveCopy(pm);
            if (copy) setEditing({ pm: copy, isNew: false });
          }}
          onDelete={(pm) => {
            setEditing(null);
            setDeleting(pm);
          }}
        />
      )}
      {deleting && <DeletePostmarkModal pm={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
