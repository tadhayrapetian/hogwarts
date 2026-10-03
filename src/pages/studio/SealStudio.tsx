import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Copy, Download, LayoutGrid, List, Pencil, Plus, Sparkles, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { paperStyle } from '../../core/defaults';
import { SEAL_SHAPES, SEAL_TYPES, type EnvelopeDesign, type Seal, type SealShape, type SealType } from '../../core/types';
import { normalizeText, nowISO, uid } from '../../core/util';
import { db } from '../../db/db';
import { deleteRecord, saveRecord, updateProject, updateSettings } from '../../db/services';
import { useFmt, useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import { flapPath, flapTip } from '../../render/envelope';
import { exportSingle, type ExportFormat } from '../../render/export';
import { PaperBackground } from '../../render/paper';
import { SealArt, shade } from '../../render/seal';
import { SYMBOLS, SymbolGlyph } from '../../render/symbols';
import { SealView } from '../../ui/art';
import { Badge, ColorInput, DataTable, EmptyState, Field, Modal, PageHeader, Range, SearchInput, Section, Toggle, type Column } from '../../ui/kit';
import { ExportMenu } from '../shared/ExportMenu';

const FORMATS: ExportFormat[] = ['png', 'svg', 'pdf'];
const COLORS: { key: string; color: string }[] = [
  { key: 'burgundy', color: '#8e1f1b' },
  { key: 'emerald', color: '#1f5a3a' },
  { key: 'navy', color: '#1f2f52' },
  { key: 'gold', color: '#c9a227' },
  { key: 'black', color: '#1c1c1c' },
  { key: 'plum', color: '#4a2a5c' },
  { key: 'parchment', color: '#f1e6cc' },
];
const TYPE_COLOR: Record<SealType, string> = {
  wax: '#8e1f1b',
  embossed: '#f1e6cc',
  ink: '#1f2f52',
  official: '#c9a227',
};
const MIN_SIZE = 15;
const MAX_SIZE = 60;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Export frame around the 100×100 seal artwork (room for the wax shadow and the ribbons). */
function exportGeometry(seal: Seal) {
  const vh = seal.type === 'official' && seal.ribbons ? 116 : 108;
  return { viewBox: `-4 -4 108 ${vh}`, w: r2(seal.size * 1.08), h: r2((seal.size * vh) / 100) };
}

function sealSvg(seal: Seal) {
  const g = exportGeometry(seal);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={g.viewBox} width={`${g.w}mm`} height={`${g.h}mm`}>
      <SealArt seal={seal} uid="xse" box={{ x: 0, y: 0, w: 100, h: 100 }} />
    </svg>
  );
}

/** Back of a closed envelope with the seal pressed onto the flap tip, at true proportions. */
function EnvelopeScene({ seal, env }: { seal: Seal; env?: EnvelopeDesign }) {
  const w = env?.back.w ?? 162;
  const h = env?.back.h ?? 114;
  const flap = env?.flap ?? 'pointed';
  const paper = env?.back.paper ?? paperStyle('parchment');
  const [tx, ty] = flapTip(flap, w, h);
  const s = seal.size;
  const line = shade(paper.color, -0.32);
  const pad = 6;
  return (
    <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} width="100%" style={{ maxHeight: 340, display: 'block' }} role="img" aria-label={seal.name}>
      <defs>
        <filter id="sle-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx={0} dy={1.2} stdDeviation={1.6} floodColor="#2a1a08" floodOpacity={0.3} />
        </filter>
      </defs>
      <rect width={w} height={h} rx={1} fill={paper.color} filter="url(#sle-shadow)" />
      <PaperBackground id="sle-paper" w={w} h={h} paper={paper} rounded={1} />
      <path d={`M0 ${h} L${w * 0.42} ${h * 0.5} M${w} ${h} L${w * 0.58} ${h * 0.5}`} fill="none" stroke={line} strokeWidth={0.35} opacity={0.75} />
      <path d={flapPath(flap, w, h)} fill={shade(paper.color, -0.18)} opacity={0.12} />
      <path d={flapPath(flap, w, h)} fill="none" stroke={line} strokeWidth={0.45} />
      <SealArt seal={seal} uid="sle-seal" box={{ x: tx - s / 2, y: ty - s / 2, w: s, h: s }} />
    </svg>
  );
}

// ───────────── Delete with reassignment ─────────────

function DeleteSealModal({ seal, onClose }: { seal: Seal; onClose: () => void }) {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  const data = useLiveQuery(
    async () => ({
      seals: await db.seals.toArray(),
      projects: await db.projects.filter((p) => p.sealId === seal.id).toArray(),
      templates: await db.templates.filter((tp) => tp.sealId === seal.id).toArray(),
      houses: await db.houses.filter((h) => h.sealId === seal.id).toArray(),
      characters: await db.characters.filter((c) => c.sealId === seal.id).toArray(),
    }),
    [seal.id],
  );
  const [replacement, setReplacement] = useState<string | null>(null);
  if (!data) return null;
  const isDefault = settings.defaults.sealId === seal.id;
  const others = data.seals.filter((x) => x.id !== seal.id).sort((a, b) => a.name.localeCompare(b.name));
  const fallback = isDefault ? others.find((x) => x.type === seal.type)?.id ?? others[0]?.id ?? '' : settings.defaults.sealId ?? '';
  const target = replacement ?? fallback;
  const uses = data.projects.length + data.templates.length + data.houses.length + data.characters.length;
  const doDelete = async () => {
    const ok = await run(async () => {
      const sealId = target || undefined;
      for (const p of data.projects) await updateProject(p.id, { sealId });
      for (const tp of data.templates) await saveRecord('templates', { ...tp, sealId });
      for (const h of data.houses) await saveRecord('houses', { ...h, sealId });
      for (const c of data.characters) await saveRecord('characters', { ...c, sealId });
      if (isDefault) await updateSettings({ defaults: { ...settings.defaults, sealId } }, 'default seal');
      await deleteRecord('seals', seal.id);
      return true;
    }, t('common.deleted'));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t('sealstudio.deleteTitle', { name: seal.name })}
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
      <p style={{ marginTop: 0 }}>{t('sealstudio.deleteBody')}</p>
      {uses > 0 && (
        <div className="issue warning mb-8">
          {t('sealstudio.deleteInUse', { projects: data.projects.length, templates: data.templates.length, houses: data.houses.length, characters: data.characters.length })}
        </div>
      )}
      {isDefault && <div className="issue warning mb-8">{t('sealstudio.deleteIsDefault')}</div>}
      {(uses > 0 || isDefault) && (
        <Field label={t('libstudio.replaceWith')} hint={t('libstudio.replaceHint')}>
          <select className="select" value={target} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">— {t('common.none')}</option>
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {t(`sealtype.${x.type}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  );
}

// ───────────── Designer ─────────────

function SealDesigner({
  initial,
  isNew,
  uses,
  onClose,
  onSaveCopy,
  onDelete,
}: {
  initial: Seal;
  isNew: boolean;
  uses: number;
  onClose: () => void;
  onSaveCopy: (seal: Seal) => void;
  onDelete: (seal: Seal) => void;
}) {
  const { t } = useI18n();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const settings = useSettings();
  const env = useLiveQuery(
    async () => (settings.defaults.envelopeId ? await db.envelopes.get(settings.defaults.envelopeId) : undefined) ?? (await db.envelopes.toCollection().first()),
    [settings.defaults.envelopeId],
  );
  const [s, setS] = useState<Seal>(initial);
  const [view, setView] = useState<'paper' | 'envelope'>('paper');
  const set = (p: Partial<Seal>) => setS((x) => ({ ...x, ...p }));
  const editable = can('design.edit');
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const valid = !!s.name.trim() && s.size >= MIN_SIZE && s.size <= MAX_SIZE;
  const isDefault = settings.defaults.sealId === s.id;
  const official = s.type === 'official';
  const g = exportGeometry(s);

  const setType = (type: SealType) =>
    setS((x) => ({
      ...x,
      type,
      color: x.color.toLowerCase() === TYPE_COLOR[x.type] ? TYPE_COLOR[type] : x.color,
      ribbons: type === 'official' ? x.ribbons : false,
    }));
  const close = async () => {
    if (dirty && editable && !(await confirm({ title: t('libstudio.discardTitle'), body: t('libstudio.discardBody'), confirm: t('libstudio.discard'), danger: true }))) return;
    onClose();
  };
  const save = async () => {
    if (!editable || !valid || (!dirty && !isNew)) return;
    const saved = await run(() => saveRecord('seals', { ...s, name: s.name.trim(), ribbons: s.type === 'official' && s.ribbons }), t('common.saved'));
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

  const shapeHint = official ? t('sealstudio.officialShapeHint') : s.type === 'wax' && s.shape === 'round' ? t('sealstudio.waxRoundHint') : undefined;

  return (
    <Modal
      size="xl"
      initialFocus={false}
      title={isNew ? t('sealstudio.new') : s.name || t('sealstudio.designer')}
      sub={isNew ? t('sealstudio.designerSub') : uses ? t('libstudio.usedIn', { count: uses }) : t('libstudio.unused')}
      onClose={close}
      footer={
        <>
          {editable && !isNew && (
            <>
              <button className="btn danger" onClick={() => onDelete(initial)}>
                <Trash2 /> {t('common.delete')}
              </button>
              <button className="btn" disabled={!valid} onClick={() => onSaveCopy(s)}>
                <Copy /> {t('libstudio.saveAsCopy')}
              </button>
              <button className="btn" disabled={isDefault} onClick={() => run(() => updateSettings({ defaults: { ...settings.defaults, sealId: s.id } }, 'default seal'), t('sealstudio.defaultSet', { name: s.name }))}>
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
              <button type="button" className={`btn sm ${view === 'paper' ? 'active' : ''}`} aria-pressed={view === 'paper'} onClick={() => setView('paper')}>
                {t('sealstudio.viewPaper')}
              </button>
              <button type="button" className={`btn sm ${view === 'envelope' ? 'active' : ''}`} aria-pressed={view === 'envelope'} onClick={() => setView('envelope')}>
                {t('sealstudio.viewEnvelope')}
              </button>
            </div>
            <span className="grow" />
            <span className="muted small">⌀ {s.size} mm</span>
          </div>
          {view === 'paper' ? (
            <div
              style={{
                background: '#f1e6cc',
                backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.55), transparent 60%)',
                borderRadius: 12,
                minHeight: 320,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              }}
            >
              <SealView seal={s} size={250} style={{ maxWidth: '100%', height: 'auto', filter: 'drop-shadow(0 6px 14px rgba(40, 25, 10, 0.3))' }} />
            </div>
          ) : (
            <div className="col gap-4">
              <div style={{ background: '#e4dccb', borderRadius: 12, padding: 16, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <EnvelopeScene seal={s} env={env} />
              </div>
              <div className="muted small">{env ? t('sealstudio.envelopeHint', { name: env.name }) : t('sealstudio.envelopeHintGeneric')}</div>
            </div>
          )}
          <div className="row wrap">
            <div className="row" style={{ background: '#f1e6cc', borderRadius: 8, padding: 8 }}>
              <SealView seal={s} style={{ width: `${s.size * 1.12}mm`, height: `${s.size * 1.2}mm` }} />
            </div>
            <div className="col grow" style={{ gap: 2 }}>
              <b className="small">{t('libstudio.actualSize')}</b>
              <span className="muted small">
                {t(`sealtype.${s.type}`)} · ⌀ {s.size} mm
              </span>
            </div>
          </div>
          <Section title={t('common.export')}>
            <div className="row wrap gap-4">
              {FORMATS.map((f) => (
                <button key={f} type="button" className="btn sm" disabled={!valid} onClick={() => run(() => exportSingle(sealSvg(s), g.w, g.h, f, settings.print.resolution, s.name || 'seal'), t('common.exported'))}>
                  <Download /> {f.toUpperCase()}
                </button>
              ))}
            </div>
          </Section>
        </div>

        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Section title={t('sealstudio.secBasics')}>
            <div className="form-grid">
              <Field label={t('field.name')} required className="full" error={!s.name.trim() ? t('libstudio.nameRequired') : undefined}>
                <input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} />
              </Field>
              <Field label={t('sealstudio.type')} className="full">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
                  {SEAL_TYPES.map((ty) => {
                    const on = s.type === ty;
                    return (
                      <button key={ty} type="button" className={`thumb-card ${on ? 'selected' : ''}`} style={{ padding: 6, gap: 4 }} aria-pressed={on} onClick={() => setType(ty)}>
                        <div className="art" style={{ padding: 4 }}>
                          <SealView seal={{ ...s, type: ty, color: on || s.color.toLowerCase() !== TYPE_COLOR[s.type] ? s.color : TYPE_COLOR[ty] }} size={44} />
                        </div>
                        <div className="tiny truncate" style={{ textAlign: 'center' }}>
                          {t(`sealtype.${ty}`)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label={t('editor.shape')} hint={shapeHint}>
                <select className="select" value={s.shape} disabled={official} onChange={(e) => set({ shape: e.target.value as SealShape })}>
                  {SEAL_SHAPES.map((sh) => (
                    <option key={sh} value={sh}>
                      {t(`sealshape.${sh}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('sealstudio.sizeMm')}>
                <Range value={s.size} min={MIN_SIZE} max={MAX_SIZE} step={1} onChange={(v) => set({ size: v })} format={(v) => `${v} mm`} />
              </Field>
              <Field className="full" hint={official ? undefined : t('sealstudio.ribbonsHint')}>
                <Toggle checked={official && s.ribbons} disabled={!official} onChange={(v) => set({ ribbons: v })} label={t('sealstudio.ribbons')} />
              </Field>
            </div>
          </Section>

          <Section title={t('sealstudio.secColour')}>
            <div className="form-grid">
              <Field label={t('editor.color')} className="full" hint={s.type === 'embossed' ? t('sealstudio.embossedColorHint') : undefined}>
                <ColorInput value={s.color} onChange={(c) => set({ color: c })} />
                <div className="row wrap gap-4 mt-8">
                  {COLORS.map((c) => {
                    const on = s.color.toLowerCase() === c.color;
                    return (
                      <button key={c.key} type="button" className={`btn xs ${on ? 'primary' : ''}`} aria-pressed={on} onClick={() => set({ color: c.color })}>
                        <span className="swatch" style={{ background: c.color }} /> {t(`colorname.${c.key}`)}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
          </Section>

          <Section title={t('sealstudio.secEngraving')}>
            <div className="form-grid">
              <Field label={t('el.symbol')} className="full" hint={s.symbol ? t(`symbol.${s.symbol}`) : t('sealstudio.noSymbol')}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(34px, 1fr))', gap: 4, maxHeight: 172, overflowY: 'auto', padding: 2 }}>
                  <button
                    type="button"
                    className={`btn icon sm ${!s.symbol ? 'primary' : 'ghost'}`}
                    title={t('sealstudio.noSymbol')}
                    aria-label={t('sealstudio.noSymbol')}
                    aria-pressed={!s.symbol}
                    onClick={() => set({ symbol: '' })}
                  >
                    <Ban />
                  </button>
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
              <Field label={t('sealstudio.ringText')} className="full" hint={t('sealstudio.ringTextHint')}>
                <input className="input" value={s.text} maxLength={40} onChange={(e) => set({ text: e.target.value })} />
              </Field>
              <Field label={t('sealstudio.initials')}>
                <input className="input" value={s.initials} maxLength={4} onChange={(e) => set({ initials: e.target.value })} />
              </Field>
              <Field label={t('sealstudio.year')}>
                <input className="input" value={s.year} maxLength={12} onChange={(e) => set({ year: e.target.value })} />
              </Field>
            </div>
          </Section>
        </fieldset>
      </div>
    </Modal>
  );
}

// ───────────── Library ─────────────

export function SealStudio() {
  const { t } = useI18n();
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
    await db.projects.each((p) => bump(p.sealId));
    await db.templates.each((tp) => bump(tp.sealId));
    await db.houses.each((h) => bump(h.sealId));
    await db.characters.each((c) => bump(c.sealId));
    return { seals: await db.seals.toArray(), usage };
  }, []);
  const [type, setType] = useState<'all' | SealType>('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [editing, setEditing] = useState<{ seal: Seal; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Seal | null>(null);
  if (!data) return null;
  const editable = can('design.edit');
  const defaultId = settings.defaults.sealId;
  const usesOf = (s: Seal) => data.usage.get(s.id) ?? 0;
  const n = normalizeText(q);
  const list = data.seals
    .filter((s) => (type === 'all' || s.type === type) && (!n || normalizeText(`${s.name} ${s.text} ${s.initials} ${s.year} ${t(`sealtype.${s.type}`)}`).includes(n)))
    .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId) || a.name.localeCompare(b.name));
  const countIn = (ty: SealType) => data.seals.filter((s) => s.type === ty).length;

  const blank = (): Seal => {
    const ty: SealType = type === 'all' ? 'wax' : type;
    const now = nowISO();
    return {
      id: uid(),
      name: t('sealstudio.newName'),
      type: ty,
      shape: 'round',
      color: TYPE_COLOR[ty],
      symbol: 'owl',
      text: settings.company.schoolName || '',
      initials: '',
      year: String(new Date().getFullYear()),
      size: ty === 'official' ? 34 : 28,
      ribbons: ty === 'official',
      createdAt: now,
      updatedAt: now,
    };
  };
  const saveCopy = async (s: Seal) => {
    const now = nowISO();
    const copy: Seal = { ...s, id: uid(), name: t('libstudio.copyOf', { name: s.name }), createdAt: now, updatedAt: now };
    return run(() => saveRecord('seals', copy), t('sealstudio.duplicated'));
  };
  const setDefault = (s: Seal) => run(() => updateSettings({ defaults: { ...settings.defaults, sealId: s.id } }, 'default seal'), t('sealstudio.defaultSet', { name: s.name }));
  const exportAs = (s: Seal, f: ExportFormat) => {
    const g = exportGeometry(s);
    return run(() => exportSingle(sealSvg(s), g.w, g.h, f, settings.print.resolution, s.name || 'seal'), t('common.exported'));
  };
  const open = (s: Seal) => setEditing({ seal: s, isNew: false });
  const create = () => setEditing({ seal: blank(), isNew: true });
  const menu = (s: Seal) => [
    { label: editable ? t('common.edit') : t('common.open'), icon: <Pencil />, onClick: () => open(s) },
    ...(editable
      ? [
          { label: t('common.duplicate'), icon: <Copy />, onClick: () => void saveCopy(s) },
          { label: t('libstudio.setDefault'), icon: <Star />, onClick: () => void setDefault(s), disabled: s.id === defaultId },
        ]
      : []),
    { label: '', divider: true },
    ...FORMATS.map((f) => ({ label: `${t('common.export')} ${f.toUpperCase()}`, icon: <Download />, onClick: () => void exportAs(s, f) })),
    ...(editable ? [{ label: '', divider: true }, { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => setDeleting(s) }] : []),
  ];

  const columns: Column<Seal>[] = [
    { key: 'art', header: t('common.preview'), width: 64, render: (s) => <SealView seal={s} size={36} /> },
    {
      key: 'name',
      header: t('field.name'),
      sort: (s) => s.name,
      render: (s) => (
        <span className="row gap-4">
          <b>{s.name}</b>
          {s.id === defaultId && <Badge tone="success">{t('libstudio.default')}</Badge>}
        </span>
      ),
    },
    { key: 'type', header: t('sealstudio.type'), sort: (s) => t(`sealtype.${s.type}`), render: (s) => t(`sealtype.${s.type}`) },
    { key: 'shape', header: t('editor.shape'), sort: (s) => t(`sealshape.${s.shape}`), render: (s) => (s.type === 'official' ? '—' : t(`sealshape.${s.shape}`)) },
    { key: 'text', header: t('sealstudio.ringText'), sort: (s) => s.text, render: (s) => <span className="truncate">{[s.text, s.initials, s.year].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'size', header: t('sealstudio.sizeMm'), sort: (s) => s.size, className: 'num', render: (s) => s.size },
    {
      key: 'color',
      header: t('editor.color'),
      render: (s) => (
        <span className="row gap-4">
          <span className="swatch" style={{ background: s.color }} />
          <span className="mono tiny">{s.color}</span>
        </span>
      ),
    },
    { key: 'uses', header: t('libstudio.usage'), sort: usesOf, className: 'num', render: (s) => usesOf(s) },
    { key: 'updated', header: t('field.lastUpdated'), sort: (s) => s.updatedAt, render: (s) => fmt.date(s.updatedAt) },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.studio')}
        title={t('nav.seals')}
        sub={t('sealstudio.sub')}
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
              name={t('nav.seals')}
              formats={['csv', 'xlsx', 'json']}
              build={() => ({
                head: [t('field.name'), t('sealstudio.type'), t('editor.shape'), t('sealstudio.ringText'), t('sealstudio.initials'), t('sealstudio.year'), t('el.symbol'), t('sealstudio.sizeMm'), t('editor.color'), t('libstudio.usage'), t('libstudio.default')],
                rows: list.map((s) => [
                  s.name,
                  t(`sealtype.${s.type}`),
                  t(`sealshape.${s.shape}`),
                  s.text,
                  s.initials,
                  s.year,
                  s.symbol ? t(`symbol.${s.symbol}`) : '',
                  s.size,
                  s.color,
                  usesOf(s),
                  s.id === defaultId ? '✓' : '',
                ]),
                json: list,
              })}
            />
            {editable && (
              <button className="btn primary" onClick={create}>
                <Plus /> {t('sealstudio.new')}
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('sealstudio.search')} />
      </div>
      <div className="row wrap gap-4 mb-16" role="tablist" aria-label={t('sealstudio.type')}>
        <button className={`btn sm ${type === 'all' ? 'primary' : 'ghost'}`} role="tab" aria-selected={type === 'all'} onClick={() => setType('all')}>
          {t('common.all')} <span className={type === 'all' ? '' : 'muted'}>{data.seals.length}</span>
        </button>
        {SEAL_TYPES.map((ty) => (
          <button key={ty} className={`btn sm ${type === ty ? 'primary' : 'ghost'}`} role="tab" aria-selected={type === ty} onClick={() => setType(ty)}>
            {t(`sealtype.${ty}`)} <span className={type === ty ? '' : 'muted'}>{countIn(ty)}</span>
          </button>
        ))}
      </div>
      {!list.length ? (
        <EmptyState
          icon={<Sparkles />}
          title={data.seals.length ? t('common.noResults') : t('sealstudio.empty')}
          text={data.seals.length ? undefined : t('sealstudio.emptyHint')}
          action={
            editable ? (
              <button className="btn primary" onClick={create}>
                <Plus /> {t('sealstudio.new')}
              </button>
            ) : undefined
          }
        />
      ) : view === 'table' ? (
        <div className="card">
          <DataTable
            rows={list}
            columns={columns}
            rowKey={(s) => s.id}
            onRowClick={open}
            onContextMenu={(s, e) => {
              e.preventDefault();
              contextMenu(e, menu(s));
            }}
          />
        </div>
      ) : (
        <div className="thumb-grid">
          {list.map((s) => {
            const uses = usesOf(s);
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
                  <span className="check-mark" title={t('libstudio.default')}>
                    <Star />
                  </span>
                )}
                <div className="art" style={{ background: '#f1e6cc' }}>
                  <SealView seal={s} size={80} />
                </div>
                <div className="title truncate">{s.name}</div>
                <div className="meta">
                  {t(`sealtype.${s.type}`)} · ⌀ {s.size} mm
                </div>
                <div className="row wrap gap-4">
                  {isDefault && <Badge tone="success">{t('libstudio.default')}</Badge>}
                  <Badge tone={uses ? 'info' : 'neutral'}>{uses ? t('libstudio.usedIn', { count: uses }) : t('libstudio.unused')}</Badge>
                </div>
                <div className="row gap-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  {editable && (
                    <>
                      <button className="btn xs ghost icon" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={() => void saveCopy(s)}>
                        <Copy />
                      </button>
                      <button className="btn xs ghost icon" title={t('libstudio.setDefault')} aria-label={t('libstudio.setDefault')} disabled={isDefault} onClick={() => void setDefault(s)}>
                        <Star />
                      </button>
                    </>
                  )}
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
      )}
      {editing && (
        <SealDesigner
          key={editing.seal.id}
          initial={editing.seal}
          isNew={editing.isNew}
          uses={data.usage.get(editing.seal.id) ?? 0}
          onClose={() => setEditing(null)}
          onSaveCopy={async (s) => {
            const copy = await saveCopy(s);
            if (copy) setEditing({ seal: copy, isNew: false });
          }}
          onDelete={(s) => {
            setEditing(null);
            setDeleting(s);
          }}
        />
      )}
      {deleting && <DeleteSealModal seal={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
