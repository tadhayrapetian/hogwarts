import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, Copy, Download, ExternalLink, FileText, Plus, Trash2, Upload, Wand2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { emptyLayout } from '../../core/defaults';
import { findVariables, sampleContext, type VarContext } from '../../core/template';
import {
  DOCUMENT_TYPES,
  PAPER_KINDS,
  TEMPLATE_CATEGORIES,
  type Asset,
  type BorderSpec,
  type DesignEl,
  type DesignElType,
  type DocumentType,
  type FoldStyle,
  type FontKey,
  type Lang,
  type Layout,
  type PaperKind,
  type Template,
  type TemplateCategory,
  type TextEl,
} from '../../core/types';
import { clamp, clone, downloadBlob, normalizeText, nowISO, readFileAsText, round, safeFileName, uid } from '../../core/util';
import { db } from '../../db/db';
import { copyLayout, deleteRecord, getSettings, saveAsset, saveRecord, ServiceError, updateSettings } from '../../db/services';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate, setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { useUI } from '../../app/ui';
import { LANGS, translate, useI18n } from '../../i18n';
import type { RenderCtx, RenderLib } from '../../render/context';
import { newElement, text } from '../../render/elements';
import { Badge, EmptyState, Field, Modal, NumberInput, PageHeader, SearchInput, Tabs, Toggle } from '../../ui/kit';
import { ExportMenu } from '../shared/ExportMenu';
import { TemplateThumb, useSampleCtx } from '../shared/pickers';

// ───────────── Shared helpers (also used by the template editor) ─────────────

const LANG_CODES: Lang[] = ['en', 'ru', 'hy'];
const FOLDS: FoldStyle[] = ['none', 'half', 'trifold'];

/** Variables referenced by text and barcode elements of a layout. */
export function layoutVariableKeys(layout: Layout): string[] {
  const keys = new Set<string>();
  for (const e of layout.elements) {
    const s = e.type === 'text' ? e.text : e.type === 'barcode' ? e.value : '';
    if (s) findVariables(s).forEach((k) => keys.add(k));
  }
  return Array.from(keys);
}

/** Sample variables in the template's language, with the real first house and sender when available. */
export function sampleVarsFor(lib: RenderLib, lang: Lang, senderId?: string): VarContext {
  const vars = sampleContext(lib.settings, lang);
  const house = lib.houseList[0];
  if (house) {
    vars.house = house.name;
    vars.house_motto = house.motto;
  }
  const sender = senderId ? lib.characters.get(senderId) : undefined;
  if (sender) {
    vars.sender_name = sender.name;
    vars.sender_title = sender.title;
    vars.sender_department = sender.department;
    vars.signoff = sender.signOff || vars.signoff;
  }
  return vars;
}

function assetIdsOf(layout: Layout): string[] {
  const ids = new Set<string>();
  layout.elements.forEach((e) => e.type === 'image' && e.assetId && ids.add(e.assetId));
  return Array.from(ids);
}

export async function duplicateTemplate(tp: Template, name: string): Promise<Template> {
  const now = nowISO();
  const copy: Template = { ...clone(tp), id: uid(), name, layout: copyLayout(tp.layout), archived: false, createdAt: now, updatedAt: now };
  return saveRecord('templates', copy);
}

export async function exportTemplateJSON(id: string): Promise<void> {
  const tp = await db.templates.get(id);
  if (!tp) throw new ServiceError('not_found');
  const assets = (await db.assets.bulkGet(assetIdsOf(tp.layout))).filter((a): a is Asset => !!a);
  const payload = { format: 'hmms-template', version: 1, exportedAt: nowISO(), template: tp, assets };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeFileName(tp.name)}.template.json`);
}

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return list.includes(v as T) ? (v as T) : fallback;
}

/** Imports a template exported with `exportTemplateJSON` (new id, missing images added). */
export async function importTemplateJSON(data: unknown): Promise<Template> {
  const p = data as { format?: unknown; template?: Partial<Template>; assets?: Partial<Asset>[] } | null;
  const src = p?.template;
  const layout = src?.layout;
  if (!p || p.format !== 'hmms-template' || !src || !layout || typeof layout.w !== 'number' || typeof layout.h !== 'number' || !Array.isArray(layout.elements)) {
    throw new ServiceError('invalid_file');
  }
  const assetMap = new Map<string, string>();
  for (const a of Array.isArray(p.assets) ? p.assets : []) {
    if (!a?.id || typeof a.dataUrl !== 'string' || !a.dataUrl.startsWith('data:')) continue;
    if (await db.assets.get(a.id)) continue;
    const saved = await saveAsset(a.name ?? 'image', a.dataUrl, a.mime ?? a.dataUrl.slice(5, a.dataUrl.indexOf(';')), a.width ?? 0, a.height ?? 0);
    assetMap.set(a.id, saved.id);
  }
  const base = emptyLayout(layout.w, layout.h);
  const merged: Layout = {
    ...base,
    ...clone(layout),
    elements: layout.elements.map((e) => (e.type === 'image' && e.assetId && assetMap.has(e.assetId) ? { ...e, assetId: assetMap.get(e.assetId) } : e)),
  };
  const exists = async (table: 'envelopes' | 'stamps' | 'postmarks' | 'seals' | 'characters', id?: string) => (id && (await db[table].get(id)) ? id : undefined);
  const docIds = Array.isArray(src.documentTemplateIds) ? src.documentTemplateIds : [];
  const existingDocs = (await db.templates.bulkGet(docIds)).filter((x): x is Template => !!x).map((x) => x.id);
  const now = nowISO();
  const tp: Template = {
    id: uid(),
    name: (typeof src.name === 'string' && src.name.trim()) || 'Template',
    kind: oneOf(src.kind, ['letter', 'document'] as const, 'letter'),
    category: oneOf(src.category, TEMPLATE_CATEGORIES, 'general'),
    docType: oneOf(src.docType, DOCUMENT_TYPES, 'other'),
    description: typeof src.description === 'string' ? src.description : '',
    language: oneOf(src.language, LANG_CODES, 'en'),
    layout: copyLayout(merged),
    envelopeId: await exists('envelopes', src.envelopeId),
    stampId: await exists('stamps', src.stampId),
    postmarkId: await exists('postmarks', src.postmarkId),
    sealId: await exists('seals', src.sealId),
    senderId: await exists('characters', src.senderId),
    documentTemplateIds: existingDocs,
    fold: oneOf(src.fold, FOLDS, 'none'),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  return saveRecord('templates', tp);
}

/** Deletes a template and unlinks it from letter templates, products and settings. Projects keep their own copies. */
export async function deleteTemplateCascade(id: string): Promise<void> {
  await deleteRecord('templates', id);
  const parents = await db.templates.filter((x) => (x.documentTemplateIds ?? []).includes(id)).toArray();
  for (const x of parents) await saveRecord('templates', { ...x, documentTemplateIds: x.documentTemplateIds.filter((d) => d !== id) });
  const products = await db.products.filter((x) => x.templateId === id || (x.documentTemplateIds ?? []).includes(id)).toArray();
  for (const x of products) await saveRecord('products', { ...x, templateId: x.templateId === id ? undefined : x.templateId, documentTemplateIds: (x.documentTemplateIds ?? []).filter((d) => d !== id) });
  const s = await getSettings();
  if (s.mail.defaultLetterTemplateId === id) await updateSettings({ mail: { ...s.mail, defaultLetterTemplateId: undefined } }, 'default letter template');
}

export function useTemplateActions() {
  const { t } = useI18n();
  const run = useAction();
  const { confirm } = useFeedback();
  const duplicate = useCallback((tp: Template) => run(() => duplicateTemplate(tp, t('template.copyName', { name: tp.name })), t('template.duplicated')), [run, t]);
  const exportJSON = useCallback((id: string) => run(() => exportTemplateJSON(id), t('common.exported')), [run, t]);
  const setArchived = useCallback((tp: Template, archived: boolean) => run(() => saveRecord('templates', { ...tp, archived }), archived ? t('template.archivedMsg') : t('template.restoredMsg')), [run, t]);
  const remove = useCallback(
    async (tp: Template, usage: number): Promise<boolean> => {
      const ok = await confirm({ title: t('template.deleteTitle', { name: tp.name }), body: t('template.deleteBody', { count: usage }), danger: true, confirm: t('common.delete') });
      if (!ok) return false;
      return (await run(() => deleteTemplateCascade(tp.id).then(() => true), t('common.deleted'))) ?? false;
    },
    [run, confirm, t],
  );
  return { duplicate, exportJSON, setArchived, remove };
}

// ───────────── Starter layouts ─────────────

interface Ink {
  main: string;
  head: string;
  soft: string;
  accent: string;
  rule: string;
}

function inkFor(paper: PaperKind): Ink {
  return paper === 'midnight'
    ? { main: '#efe3c2', head: '#e6c77f', soft: '#cdb88c', accent: '#e6c77f', rule: '#c9a24f' }
    : { main: '#2b1d10', head: '#4a2a14', soft: '#6b4a2b', accent: '#7a1f1a', rule: '#8a6a35' };
}

function bodyFontFor(lang: Lang): FontKey {
  return lang === 'hy' ? 'armenian' : lang === 'ru' ? 'cormorant' : 'garamond';
}

/** Scales element boxes from a reference page size to the chosen page size. */
function scaler(w: number, h: number, baseW: number, baseH: number) {
  const sx = w / baseW;
  const sy = h / baseH;
  const fs = clamp(Math.min(sx, sy), 0.45, 1.8);
  const box = (x: number, y: number, bw: number, bh: number) => ({ x: round(x * sx, 1), y: round(y * sy, 1), w: round(bw * sx, 1), h: round(bh * sy, 1) });
  const size = (pt: number) => round(pt * fs, 1);
  return { box, size, fs };
}

function place(type: DesignElType, w: number, h: number, b: { x: number; y: number; w: number; h: number }, extra: Partial<DesignEl> = {}): DesignEl {
  return { ...newElement(type, { w, h }), ...b, ...extra } as DesignEl;
}

function letterStarter(w: number, h: number, lang: Lang, ink: Ink): { elements: DesignEl[]; border: Partial<BorderSpec> } {
  const { box, size, fs } = scaler(w, h, 210, 297);
  const font = bodyFontFor(lang);
  const tx = (b: ReturnType<typeof box>, s: string, o: Partial<TextEl>) => text({ ...b, text: s, ...o });
  return {
    border: { style: 'ornate', color: ink.rule, width: 0.5, inset: round(9 * fs, 1) },
    elements: [
      place('badge', w, h, box(88, 14, 34, 41), { houseRef: '$school', showName: true } as Partial<DesignEl>),
      tx(box(20, 58, 170, 10), '{{school_name}}', { font: 'cinzel', size: size(17), weight: 700, align: 'center', color: ink.head, letterSpacing: 0.04 }),
      tx(box(20, 68, 170, 6), '*{{school_motto}}*', { font: 'garamond', size: size(10), align: 'center', color: ink.soft }),
      place('divider', w, h, box(60, 76, 90, 5), { color: ink.rule } as Partial<DesignEl>),
      tx(box(120, 84, 68, 6), '{{date}}', { font: 'garamond', size: size(9.5), align: 'right', color: ink.soft }),
      tx(box(24, 96, 162, 8), translate(lang, 'template.starter.salutation'), { font, size: size(13), weight: 600, color: ink.main }),
      tx(box(24, 107, 162, 115), translate(lang, 'template.starter.body'), { font, size: size(12), align: 'justify', lineHeight: 1.45, color: ink.main, dropCap: true, dropCapColor: ink.accent }),
      tx(box(112, 228, 76, 7), '{{signoff}}', { font, size: size(12), italic: true, align: 'center', color: ink.main }),
      place('signature', w, h, box(112, 236, 76, 30)),
      place('seal', w, h, box(30, 234, 30, 30), { sealRef: '$project' } as Partial<DesignEl>),
      tx(box(20, 279, 170, 5), '{{school_name}} · {{year}}', { font: 'cinzel', size: size(7), align: 'center', color: ink.soft, letterSpacing: 0.08 }),
    ],
  };
}

function documentStarter(w: number, h: number, lang: Lang, docType: DocumentType, ink: Ink): { elements: DesignEl[]; border: Partial<BorderSpec> } {
  const { box, size, fs } = scaler(w, h, 210, 148);
  const tx = (b: ReturnType<typeof box>, s: string, o: Partial<TextEl>) => text({ ...b, text: s, ...o });
  return {
    border: { style: 'double', color: ink.rule, width: 0.6, inset: round(7 * fs, 1) },
    elements: [
      place('badge', w, h, box(93, 12, 24, 29), { houseRef: '$school', showName: false } as Partial<DesignEl>),
      tx(box(20, 43, 170, 7), '{{school_name}}', { font: 'cinzel', size: size(12), weight: 700, align: 'center', color: ink.head, letterSpacing: 0.06 }),
      tx(box(20, 52, 170, 12), translate(lang, `doctype.${docType}`), { font: 'cinzel', size: size(22), weight: 700, align: 'center', color: ink.accent, transform: 'uppercase', autoFit: true }),
      tx(box(20, 67, 170, 6), translate(lang, 'template.starter.certify'), { font: 'garamond', size: size(11), italic: true, align: 'center', color: ink.soft }),
      tx(box(20, 74, 170, 14), '{{full_name}}', { font: 'greatvibes', size: size(26), align: 'center', color: ink.main, autoFit: true }),
      tx(box(20, 90, 170, 6), '{{house}} · {{year}}', { font: 'garamond', size: size(11), align: 'center', color: ink.main }),
      place('divider', w, h, box(65, 98, 80, 5), { color: ink.rule } as Partial<DesignEl>),
      place('seal', w, h, box(26, 104, 28, 28), { sealRef: '$project' } as Partial<DesignEl>),
      tx(box(62, 114, 66, 6), '{{date}}', { font: 'garamond', size: size(9.5), align: 'center', color: ink.soft }),
      place('signature', w, h, box(130, 104, 60, 28)),
      tx(box(20, 136, 170, 5), '{{document_number}}', { font: 'inter', size: size(6.5), align: 'center', color: ink.soft, letterSpacing: 0.08 }),
    ],
  };
}

function cardStarter(w: number, h: number, lang: Lang, docType: DocumentType, ink: Ink): { elements: DesignEl[]; border: Partial<BorderSpec> } {
  const { box, size } = scaler(w, h, 85.6, 54);
  const tx = (b: ReturnType<typeof box>, s: string, o: Partial<TextEl>) => text({ ...b, text: s, ...o });
  return {
    border: { style: 'single', color: ink.rule, width: 0.35, inset: 2 },
    elements: [
      place('badge', w, h, box(4, 7, 18, 22), { houseRef: '$recipient', showName: false } as Partial<DesignEl>),
      tx(box(25, 4.5, 57, 5), '{{school_name}}', { font: 'cinzel', size: size(6.5), weight: 700, color: ink.head, autoFit: true }),
      tx(box(25, 10, 57, 4), translate(lang, `doctype.${docType}`), { font: 'inter', size: size(5), color: ink.accent, transform: 'uppercase', letterSpacing: 0.12 }),
      tx(box(25, 17, 57, 7), '{{full_name}}', { font: 'garamond', size: size(11), weight: 700, color: ink.main, autoFit: true }),
      tx(box(25, 25, 57, 4.5), '{{house}} · {{school_year_ordinal}}', { font: 'inter', size: size(6), color: ink.soft }),
      tx(box(4, 31, 18, 4), '{{recipient_id}}', { font: 'typewriter', size: size(5), align: 'center', color: ink.soft }),
      tx(box(4, 46, 18, 4), '{{year}}–{{next_year}}', { font: 'inter', size: size(5), align: 'center', color: ink.soft }),
      place('barcode', w, h, box(25, 38, 45, 10), { value: '{{recipient_id}}', color: ink.main } as Partial<DesignEl>),
    ],
  };
}

function starterLayout(kind: Template['kind'], w: number, h: number, paper: PaperKind, lang: Lang, docType: DocumentType, withElements: boolean): Layout {
  const layout = emptyLayout(w, h, paper);
  if (!withElements) return layout;
  const ink = inkFor(paper);
  const small = w < 120 && h < 90;
  const s = small ? cardStarter(w, h, lang, docType, ink) : kind === 'letter' && h >= w ? letterStarter(w, h, lang, ink) : documentStarter(w, h, lang, docType, ink);
  const m = small ? 3 : round(15 * clamp(Math.min(w / 210, h / 297), 0.4, 1.5), 1);
  return { ...layout, border: { ...layout.border, ...s.border }, margins: { top: m, right: m, bottom: m, left: m }, elements: s.elements };
}

// ───────────── New template ─────────────

const SIZE_PRESETS: { key: string; label?: string; w: number; h: number }[] = [
  { key: 'a4', label: 'A4', w: 210, h: 297 },
  { key: 'a5', label: 'A5', w: 148, h: 210 },
  { key: 'a6', label: 'A6', w: 105, h: 148 },
  { key: 'a4l', w: 297, h: 210 },
  { key: 'a5l', w: 210, h: 148 },
  { key: 'card', w: 85.6, h: 54 },
  { key: 'postcard', w: 148, h: 105 },
  { key: 'custom', w: 0, h: 0 },
];

function NewTemplateModal({ initialKind, onClose }: { initialKind: Template['kind']; onClose: () => void }) {
  const { t, lang } = useI18n();
  const run = useAction();
  const [name, setName] = useState('');
  const [kind, setKindState] = useState<Template['kind']>(initialKind);
  const [category, setCategory] = useState<TemplateCategory>(initialKind === 'letter' ? 'general' : 'certificate');
  const [docType, setDocType] = useState<DocumentType>(initialKind === 'letter' ? 'other' : 'certificate');
  const [language, setLanguage] = useState<Lang>(lang);
  const [size, setSize] = useState(initialKind === 'letter' ? 'a4' : 'a5l');
  const [customW, setCustomW] = useState<number | undefined>(200);
  const [customH, setCustomH] = useState<number | undefined>(150);
  const [paper, setPaper] = useState<PaperKind>(initialKind === 'letter' ? 'parchment' : 'ivory');
  const [starter, setStarter] = useState(true);
  const [description, setDescription] = useState('');

  const setKind = (k: Template['kind']) => {
    setKindState(k);
    setCategory(k === 'letter' ? 'general' : 'certificate');
    setDocType(k === 'letter' ? 'other' : 'certificate');
    setSize(k === 'letter' ? 'a4' : 'a5l');
    setPaper(k === 'letter' ? 'parchment' : 'ivory');
  };

  const preset = SIZE_PRESETS.find((p) => p.key === size) ?? SIZE_PRESETS[0];
  const w = preset.key === 'custom' ? customW ?? 0 : preset.w;
  const h = preset.key === 'custom' ? customH ?? 0 : preset.h;
  const sizeOk = w >= 20 && h >= 20 && w <= 1000 && h <= 1000;
  const presetLabel = (p: (typeof SIZE_PRESETS)[number]) => (p.key === 'custom' ? t('common.custom') : `${p.label ?? t(`template.size.${p.key}`)} · ${p.w}×${p.h} mm`);

  const create = async () => {
    const now = nowISO();
    const fold: FoldStyle = kind === 'document' ? 'none' : h >= 250 ? 'trifold' : h >= 180 ? 'half' : 'none';
    const tp: Template = {
      id: uid(),
      name: name.trim(),
      kind,
      category,
      docType,
      description: description.trim(),
      language,
      layout: starterLayout(kind, w, h, paper, language, docType, starter),
      documentTemplateIds: [],
      fold,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await run(() => saveRecord('templates', tp), t('template.created'));
    if (saved) {
      onClose();
      navigate(`/templates/${saved.id}`);
    }
  };

  return (
    <Modal
      title={t('template.new')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!name.trim() || !sizeOk} onClick={create}>
            <Plus /> {t('template.create')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('field.name')} required className="full">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('template.namePlaceholder')} autoFocus />
        </Field>
        <Field label={t('template.kind')} className="full">
          <Tabs
            pill
            value={kind}
            onChange={(k) => setKind(k as Template['kind'])}
            tabs={[
              { key: 'letter', label: t('template.kind.letter') },
              { key: 'document', label: t('template.kind.document') },
            ]}
          />
        </Field>
        <Field label={t('template.category')}>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`tplcat.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('template.docType')}>
          <select className="select" value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
            {DOCUMENT_TYPES.map((d) => (
              <option key={d} value={d}>
                {t(`doctype.${d}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('template.language')} hint={t('template.languageHint')}>
          <select className="select" value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('editor.paperKind')}>
          <select className="select" value={paper} onChange={(e) => setPaper(e.target.value as PaperKind)}>
            {PAPER_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`paper.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('template.pageSize')} className={size === 'custom' ? '' : 'full'} error={!sizeOk ? t('template.sizeInvalid') : undefined}>
          <select className="select" value={size} onChange={(e) => setSize(e.target.value)}>
            {SIZE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {presetLabel(p)}
              </option>
            ))}
          </select>
        </Field>
        {size === 'custom' && (
          <Field label={t('template.customSize')}>
            <div className="row">
              <NumberInput value={customW} onChange={setCustomW} min={20} max={1000} step={0.5} placeholder="W" />
              <span className="muted">×</span>
              <NumberInput value={customH} onChange={setCustomH} min={20} max={1000} step={0.5} placeholder="H" />
              <span className="muted small">mm</span>
            </div>
          </Field>
        )}
        <Field label={t('template.description')} className="full">
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="full">
          <Toggle checked={starter} onChange={setStarter} label={t('template.starter')} />
          <div className="muted small mt-8">{kind === 'letter' ? t('template.starterHintLetter') : t('template.starterHintDocument')}</div>
        </div>
      </div>
    </Modal>
  );
}

// ───────────── Library ─────────────

function TemplateCard({ tp, base, vars, usage }: { tp: Template; base: RenderCtx; vars: number; usage: number }) {
  const { t } = useI18n();
  const { can } = useSession();
  const { contextMenu } = useFeedback();
  const ui = useUI();
  const actions = useTemplateActions();
  const editable = can('templates.edit');
  const canExport = editable || can('data.export');
  const ctx = useMemo<RenderCtx>(() => {
    const senderId = tp.senderId ?? base.refs.senderId;
    return {
      ...base,
      idPrefix: `tc${tp.id.slice(0, 6)}`,
      vars: sampleVarsFor(base.lib, tp.language, senderId),
      refs: {
        ...base.refs,
        stampId: tp.stampId ?? base.refs.stampId,
        postmarkId: tp.postmarkId ?? base.refs.postmarkId,
        sealId: tp.sealId ?? base.refs.sealId,
        senderId,
      },
    };
  }, [base, tp]);
  const open = () => navigate(`/templates/${tp.id}`);
  const items = [
    { label: t('common.open'), icon: <ExternalLink />, onClick: open },
    ...(tp.kind === 'letter' && can('projects.edit') ? [{ label: t('template.use'), icon: <Wand2 />, onClick: () => ui.openPackageWizard({ templateId: tp.id }) }] : []),
    ...(editable ? [{ label: t('common.duplicate'), icon: <Copy />, onClick: () => void actions.duplicate(tp) }] : []),
    ...(canExport ? [{ label: t('template.exportJson'), icon: <Download />, onClick: () => void actions.exportJSON(tp.id) }] : []),
    ...(editable
      ? [
          { label: tp.archived ? t('common.restore') : t('common.archive'), icon: tp.archived ? <ArchiveRestore /> : <Archive />, onClick: () => void actions.setArchived(tp, !tp.archived) },
          { label: '', divider: true },
          { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => void actions.remove(tp, usage) },
        ]
      : []),
  ];
  return (
    <div
      className="thumb-card"
      style={tp.archived ? { opacity: 0.65 } : undefined}
      onClick={open}
      onContextMenu={(e) => contextMenu(e, items)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}
      role="link"
      tabIndex={0}
      aria-label={tp.name}
    >
      <div className="art" style={{ aspectRatio: '1 / 1' }}>
        <TemplateThumb template={tp} ctx={ctx} height={170} />
      </div>
      <div className="row between">
        <div className="title truncate" title={tp.name}>
          {tp.name}
        </div>
        {tp.archived && <Badge>{t('common.archived')}</Badge>}
      </div>
      <div className="meta truncate">
        {t(`tplcat.${tp.category}`)}
        {tp.kind === 'document' && ` · ${t(`doctype.${tp.docType}`)}`} · {tp.language.toUpperCase()}
      </div>
      <div className="meta">
        {round(tp.layout.w, 1)}×{round(tp.layout.h, 1)} mm · {t('template.varCount', { count: vars })} · {t('template.usageCount', { count: usage })}
      </div>
      <div className="row gap-4" onClick={(e) => e.stopPropagation()}>
        <button className="btn sm" onClick={open}>
          <ExternalLink /> {t('common.open')}
        </button>
        <span className="grow" />
        {editable && (
          <button className="btn sm icon ghost" title={t('common.duplicate')} aria-label={t('common.duplicate')} onClick={() => actions.duplicate(tp)}>
            <Copy />
          </button>
        )}
        {canExport && (
          <button className="btn sm icon ghost" title={t('template.exportJson')} aria-label={t('template.exportJson')} onClick={() => actions.exportJSON(tp.id)}>
            <Download />
          </button>
        )}
        {editable && (
          <>
            <button
              className="btn sm icon ghost"
              title={tp.archived ? t('common.restore') : t('common.archive')}
              aria-label={tp.archived ? t('common.restore') : t('common.archive')}
              onClick={() => actions.setArchived(tp, !tp.archived)}
            >
              {tp.archived ? <ArchiveRestore /> : <Archive />}
            </button>
            <button className="btn sm icon ghost" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => actions.remove(tp, usage)}>
              <Trash2 />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Templates() {
  const { t } = useI18n();
  const route = useRoute();
  const { can } = useSession();
  const run = useAction();
  const base = useSampleCtx('tpl');
  const fileRef = useRef<HTMLInputElement>(null);
  const kind: Template['kind'] = route.query.get('kind') === 'document' ? 'document' : 'letter';
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [docType, setDocType] = useState('');
  const [language, setLanguage] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const templates = useLiveQuery(() => db.templates.toArray(), []);
  const projectRefs = useLiveQuery(async () => (await db.projects.toArray()).map((p) => [p.templateId, ...p.documents.map((d) => d.templateId)]), []);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const ids of projectRefs ?? []) for (const id of new Set(ids)) if (id) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [projectRefs]);
  const varCounts = useMemo(() => new Map((templates ?? []).map((tp) => [tp.id, layoutVariableKeys(tp.layout).length])), [templates]);
  const visible = useMemo(() => (templates ?? []).filter((tp) => archived || !tp.archived), [templates, archived]);
  const rows = useMemo(() => {
    const n = normalizeText(q);
    return visible
      .filter((tp) => tp.kind === kind)
      .filter((tp) => !category || tp.category === category)
      .filter((tp) => kind !== 'document' || !docType || tp.docType === docType)
      .filter((tp) => !language || tp.language === language)
      .filter((tp) => !n || normalizeText(`${tp.name} ${tp.description} ${t(`tplcat.${tp.category}`)} ${t(`doctype.${tp.docType}`)}`).includes(n))
      .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.name.localeCompare(b.name));
  }, [visible, kind, category, docType, language, q, t]);

  if (!templates) return null;
  const editable = can('templates.edit');
  const filtered = !!(q || category || (kind === 'document' && docType) || language);

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.studio')}
        title={kind === 'document' ? t('template.documentStudio') : t('nav.templates')}
        sub={kind === 'document' ? t('template.documentsSub', { count: rows.length }) : t('template.lettersSub', { count: rows.length })}
        actions={
          <>
            <ExportMenu
              name={kind === 'document' ? t('template.documentStudio') : t('nav.templates')}
              build={() => ({
                head: [t('field.name'), t('template.kind'), t('template.category'), t('template.docType'), t('template.language'), t('template.pageSize'), t('template.variables'), t('nav.projects'), t('common.archived'), t('template.updated')],
                rows: rows.map((tp) => [
                  tp.name,
                  t(`template.kind.${tp.kind}`),
                  t(`tplcat.${tp.category}`),
                  t(`doctype.${tp.docType}`),
                  tp.language.toUpperCase(),
                  `${round(tp.layout.w, 1)}×${round(tp.layout.h, 1)}`,
                  varCounts.get(tp.id) ?? 0,
                  usage.get(tp.id) ?? 0,
                  tp.archived ? '✓' : '',
                  tp.updatedAt.slice(0, 10),
                ]),
              })}
            />
            {editable && (
              <>
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  <Upload /> {t('common.import')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const tp = await run(async () => {
                      let data: unknown;
                      try {
                        data = JSON.parse(await readFileAsText(f));
                      } catch {
                        throw new ServiceError('invalid_file');
                      }
                      return importTemplateJSON(data);
                    }, t('template.imported'));
                    if (tp) navigate(`/templates/${tp.id}`);
                  }}
                />
                <button className="btn primary" onClick={() => setCreating(true)}>
                  <Plus /> {t('template.new')}
                </button>
              </>
            )}
          </>
        }
      />
      <Tabs
        value={kind}
        onChange={(k) => {
          setDocType('');
          setQuery('kind', k === 'document' ? 'document' : null);
        }}
        tabs={[
          { key: 'letter', label: t('template.letters'), icon: <FileText />, count: visible.filter((x) => x.kind === 'letter').length },
          { key: 'document', label: t('template.documents'), icon: <FileText />, count: visible.filter((x) => x.kind === 'document').length },
        ]}
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('template.search')} />
        <select className="select" style={{ width: 190 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('template.category')}>
          <option value="">
            {t('template.category')}: {t('common.all')}
          </option>
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`tplcat.${c}`)}
            </option>
          ))}
        </select>
        {kind === 'document' && (
          <select className="select" style={{ width: 210 }} value={docType} onChange={(e) => setDocType(e.target.value)} aria-label={t('template.docType')}>
            <option value="">
              {t('template.docType')}: {t('common.all')}
            </option>
            {DOCUMENT_TYPES.map((d) => (
              <option key={d} value={d}>
                {t(`doctype.${d}`)}
              </option>
            ))}
          </select>
        )}
        <select className="select" style={{ width: 170 }} value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={t('template.language')}>
          <option value="">
            {t('template.language')}: {t('common.all')}
          </option>
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {t('common.showArchived')}
        </label>
        {filtered && (
          <button
            className="btn ghost sm"
            onClick={() => {
              setQ('');
              setCategory('');
              setDocType('');
              setLanguage('');
            }}
          >
            {t('common.clearFilters')}
          </button>
        )}
      </div>
      {!rows.length ? (
        <EmptyState
          icon={<FileText />}
          title={filtered ? t('common.noResults') : t('template.empty')}
          text={filtered ? undefined : t('template.emptyHint')}
          action={
            editable &&
            !filtered && (
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Plus /> {t('template.new')}
              </button>
            )
          }
        />
      ) : (
        <div className="thumb-grid lg">
          {rows.map((tp) => (
            <TemplateCard key={tp.id} tp={tp} base={base} vars={varCounts.get(tp.id) ?? 0} usage={usage.get(tp.id) ?? 0} />
          ))}
        </div>
      )}
      {creating && <NewTemplateModal initialKind={kind} onClose={() => setCreating(false)} />}
    </div>
  );
}
