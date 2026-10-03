import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, Braces, Copy, Download, FileText, FolderKanban, LayoutTemplate, Package, Settings2, Trash2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fitsEnvelope, foldedSize } from '../../core/defaults';
import { ALL_VARIABLES, buildContext, formatDocumentNumber, VARIABLE_GROUPS, type VarContext } from '../../core/template';
import { DOCUMENT_TYPES, TEMPLATE_CATEGORIES, type DocumentType, type FoldStyle, type Lang, type Layout, type Project, type Recipient, type Template, type TemplateCategory } from '../../core/types';
import { round, uniq } from '../../core/util';
import { db } from '../../db/db';
import { saveRecord, updateSettings } from '../../db/services';
import { useFmt, useLib, useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate, setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { useUI } from '../../app/ui';
import { LANGS, useI18n } from '../../i18n';
import type { RenderCtx } from '../../render/context';
import { LayoutSVG } from '../../render/LayoutSVG';
import { LayoutView } from '../../ui/art';
import { CanvasEditor } from '../../ui/CanvasEditor';
import { Badge, Card, DataTable, EmptyState, Field, PageHeader, StatusBadge, Tabs, Toggle } from '../../ui/kit';
import { ExportButtons } from '../projects/ProjectEditor';
import { EnvelopePicker, LibraryPicker, MultiTemplatePicker, RecipientSelect, useSampleCtx } from '../shared/pickers';
import { sampleVarsFor, useTemplateActions } from './Templates';

const VAR_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|([^}]*))?\}\}/gi;

interface VarUse {
  key: string;
  uses: number;
  elements: number;
  /** Every occurrence has a {{var|fallback}}. */
  fallback: boolean;
  fallbackText?: string;
}

function analyzeVariables(layout: Layout): VarUse[] {
  const map = new Map<string, { uses: number; els: Set<string>; withFallback: number; fallbackText?: string }>();
  for (const e of layout.elements) {
    const s = e.type === 'text' ? e.text : e.type === 'barcode' ? e.value : '';
    if (!s) continue;
    for (const m of s.matchAll(VAR_RE)) {
      const key = m[1].toLowerCase();
      const cur = map.get(key) ?? { uses: 0, els: new Set<string>(), withFallback: 0 };
      cur.uses++;
      cur.els.add(e.id);
      if (m[2] !== undefined) {
        cur.withFallback++;
        cur.fallbackText ??= m[2].trim();
      }
      map.set(key, cur);
    }
  }
  return Array.from(map, ([key, v]) => ({ key, uses: v.uses, elements: v.els.size, fallback: v.withFallback === v.uses, fallbackText: v.fallbackText })).sort(
    (a, b) => ALL_VARIABLES.indexOf(a.key) - ALL_VARIABLES.indexOf(b.key) || a.key.localeCompare(b.key),
  );
}

type SaveState = 'idle' | 'pending' | 'saved' | 'error';

/** Local draft + debounced autosave on top of the live template record. */
function useTemplateDraft(id: string) {
  const dbTemplate = useLiveQuery(() => db.templates.get(id).then((x) => x ?? null), [id]);
  const pending = useRef<Partial<Template>>({});
  const [, force] = useState(0);
  const [saving, setSaving] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
    const snap = pending.current;
    if (!Object.keys(snap).length) return;
    try {
      const cur = await db.templates.get(id);
      if (cur) await saveRecord('templates', { ...cur, ...snap });
    } catch (e) {
      console.error(e);
      setSaving('error');
      return;
    }
    const rest: Partial<Template> = {};
    for (const [k, v] of Object.entries(pending.current)) if ((snap as Record<string, unknown>)[k] !== v) (rest as Record<string, unknown>)[k] = v;
    pending.current = rest;
    setSaving(Object.keys(rest).length ? 'pending' : 'saved');
  }, [id]);
  const patch = useCallback(
    (p: Partial<Template>) => {
      pending.current = { ...pending.current, ...p };
      setSaving('pending');
      force((n) => n + 1);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );
  const template = dbTemplate ? ({ ...dbTemplate, ...pending.current } as Template) : dbTemplate;
  return { template, patch, saving, flush };
}

function PreviewControl({ mode, onMode, recipientId, onRecipient }: { mode: 'sample' | 'recipient'; onMode: (m: 'sample' | 'recipient') => void; recipientId?: string; onRecipient: (id?: string) => void }) {
  const { t } = useI18n();
  const { can } = useSession();
  return (
    <div className="row wrap">
      <span className="small muted">{t('template.previewData')}</span>
      <div className="btn-group">
        <button className={`btn sm ${mode === 'sample' ? 'active' : ''}`} onClick={() => onMode('sample')}>
          {t('template.sample')}
        </button>
        {can('recipients.view') && (
          <button className={`btn sm ${mode === 'recipient' ? 'active' : ''}`} onClick={() => onMode('recipient')}>
            {t('template.recipient')}
          </button>
        )}
      </div>
      {mode === 'recipient' && (
        <div style={{ width: 280, maxWidth: '100%' }}>
          <RecipientSelect value={recipientId} onChange={(rid) => onRecipient(rid)} placeholder={t('template.pickRecipient')} />
        </div>
      )}
    </div>
  );
}

function SettingsTab({ template, patch, editable }: { template: Template; patch: (p: Partial<Template>) => void; editable: boolean }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const { can } = useSession();
  const run = useAction();
  const isDefault = settings.mail.defaultLetterTemplateId === template.id;
  return (
    <div className="grid grid-3">
      <Card title={t('template.details')} className="span-2">
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-grid">
            <Field label={t('field.name')} className="full">
              <input className="input" value={template.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label={t('template.kind')}>
              <select
                className="select"
                value={template.kind}
                onChange={(e) => {
                  const kind = e.target.value as Template['kind'];
                  patch(kind === 'document' ? { kind, fold: 'none' } : { kind });
                }}
              >
                <option value="letter">{t('template.kind.letter')}</option>
                <option value="document">{t('template.kind.document')}</option>
              </select>
            </Field>
            <Field label={t('template.category')}>
              <select className="select" value={template.category} onChange={(e) => patch({ category: e.target.value as TemplateCategory })}>
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`tplcat.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('template.docType')}>
              <select className="select" value={template.docType} onChange={(e) => patch({ docType: e.target.value as DocumentType })}>
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t(`doctype.${d}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('template.language')} hint={t('template.languageHint')}>
              <select className="select" value={template.language} onChange={(e) => patch({ language: e.target.value as Lang })}>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
            {template.kind === 'letter' && (
              <Field label={t('project.fold')} hint={t('template.foldHint')}>
                <select className="select" value={template.fold} onChange={(e) => patch({ fold: e.target.value as FoldStyle })}>
                  {(['none', 'half', 'trifold'] as FoldStyle[]).map((f) => (
                    <option key={f} value={f}>
                      {t(`fold.${f}`)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t('template.description')} className="full">
              <textarea className="textarea" rows={3} value={template.description} onChange={(e) => patch({ description: e.target.value })} />
            </Field>
            <div className="full col">
              <Toggle checked={!!template.archived} onChange={(v) => patch({ archived: v })} label={t('template.archivedToggle')} disabled={!editable} />
              <div className="muted small">{t('template.archivedHint')}</div>
            </div>
          </div>
        </fieldset>
      </Card>
      <div className="col gap-16">
        <Card title={t('template.info')}>
          <dl className="kv">
            <dt>{t('template.pageSize')}</dt>
            <dd className="num">
              {round(template.layout.w, 1)} × {round(template.layout.h, 1)} mm
            </dd>
            <dt>{t('editor.paper')}</dt>
            <dd>{t(`paper.${template.layout.paper.kind}`)}</dd>
            <dt>{t('template.elements')}</dt>
            <dd className="num">{template.layout.elements.length}</dd>
            <dt>{t('common.created')}</dt>
            <dd>{fmt.dateTime(template.createdAt)}</dd>
            <dt>{t('template.updated')}</dt>
            <dd>{fmt.dateTime(template.updatedAt)}</dd>
          </dl>
          <div className="muted small mt-16">{t('template.sizeHint')}</div>
        </Card>
        {template.kind === 'letter' && (
          <Card title={t('template.defaultLetter')}>
            <Toggle
              checked={isDefault}
              disabled={!can('settings.edit') || (!!template.archived && !isDefault)}
              onChange={(v) => run(() => updateSettings({ mail: { ...settings.mail, defaultLetterTemplateId: v ? template.id : undefined } }, 'default letter template'), t('common.saved'))}
              label={t('template.defaultLetterToggle')}
            />
            <div className="muted small mt-8">{t('template.defaultLetterHint')}</div>
          </Card>
        )}
      </div>
    </div>
  );
}

function PackageTab({ template, patch, editable }: { template: Template; patch: (p: Partial<Template>) => void; editable: boolean }) {
  const { t } = useI18n();
  const settings = useSettings();
  const sampleCtx = useSampleCtx('tpk');
  const characters = useLiveQuery(() => db.characters.orderBy('name').toArray(), []) ?? [];
  const envId = template.envelopeId ?? settings.defaults.envelopeId;
  const envelope = useLiveQuery(() => (envId ? db.envelopes.get(envId) : undefined), [envId]);
  const folded = foldedSize(template.layout.w, template.layout.h, template.fold);
  const fits = envelope ? fitsEnvelope(folded, [envelope.front.w, envelope.front.h]) : undefined;
  return (
    <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="col gap-16">
        <div className="muted small">{t('template.defaultsHint')}</div>
        <Card
          title={t('el.envelope')}
          sub={!template.envelopeId ? t('template.usingWorkspaceDefault') : undefined}
          actions={
            <>
              {fits !== undefined && (
                <Badge tone={fits ? 'success' : 'danger'}>{fits ? t('envelope.fits', { w: Math.round(folded[0]), h: Math.round(folded[1]) }) : t('envelope.noFit')}</Badge>
              )}
              {template.envelopeId && (
                <button className="btn sm ghost" onClick={() => patch({ envelopeId: undefined })}>
                  {t('template.useDefault')}
                </button>
              )}
            </>
          }
        >
          <EnvelopePicker value={template.envelopeId} onChange={(e) => patch({ envelopeId: e.id })} ctx={sampleCtx} />
        </Card>
        <Card title={t('project.sender')} sub={!template.senderId ? t('template.usingWorkspaceDefault') : undefined}>
          <select className="select" style={{ maxWidth: 420 }} value={template.senderId ?? ''} onChange={(e) => patch({ senderId: e.target.value || undefined })} aria-label={t('project.sender')}>
            <option value="">— {t('template.workspaceDefault')}</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.title}
              </option>
            ))}
          </select>
        </Card>
        <Card title={t('el.stamp')} sub={!template.stampId ? t('template.usingWorkspaceDefault') : undefined}>
          <LibraryPicker kind="stamp" value={template.stampId} onChange={(v) => patch({ stampId: v })} />
        </Card>
        <Card title={t('el.postmark')} sub={!template.postmarkId ? t('template.usingWorkspaceDefault') : undefined}>
          <LibraryPicker kind="postmark" value={template.postmarkId} onChange={(v) => patch({ postmarkId: v })} />
        </Card>
        <Card title={t('el.seal')} sub={!template.sealId ? t('template.usingWorkspaceDefault') : undefined}>
          <LibraryPicker kind="seal" value={template.sealId} onChange={(v) => patch({ sealId: v })} />
        </Card>
        <Card title={t('template.includedDocs')} sub={t('template.includedDocsHint', { count: template.documentTemplateIds.length })}>
          <MultiTemplatePicker value={template.documentTemplateIds.filter((x) => x !== template.id)} onChange={(ids) => patch({ documentTemplateIds: ids.filter((x) => x !== template.id) })} ctx={sampleCtx} />
        </Card>
      </div>
    </fieldset>
  );
}

function VariablesTab({ template, vars, preview }: { template: Template; vars: VarContext; preview: JSX.Element }) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const uses = useMemo(() => analyzeVariables(template.layout), [template.layout]);
  const used = new Set(uses.map((u) => u.key));
  const unknown = uses.filter((u) => !ALL_VARIABLES.includes(u.key));
  const empty = uses.filter((u) => ALL_VARIABLES.includes(u.key) && !vars[u.key] && !u.fallback);
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast(t('template.copiedVar', { value: s }));
    } catch {
      toast(t('template.copyFailed'), 'error');
    }
  };
  const status = (u: VarUse) => {
    if (!ALL_VARIABLES.includes(u.key)) return <Badge tone="danger">{t('template.var.unknown')}</Badge>;
    if (!vars[u.key] && !u.fallback) return <Badge tone="warning">{t('template.var.empty')}</Badge>;
    if (u.fallbackText !== undefined) return <Badge tone="success">{t('template.var.fallback')}</Badge>;
    return <Badge tone="success">{t('template.var.ok')}</Badge>;
  };
  return (
    <div className="col gap-16">
      {preview}
      <Card title={t('template.varsUsed')} sub={t('template.var.fallbackHint', { example: '{{owl_name|your owl}}' })}>
        {(unknown.length > 0 || empty.length > 0) && (
          <div className="col mb-16">
            {unknown.length > 0 && <div className="issue error">{t('template.var.unknownSummary', { count: unknown.length, list: unknown.map((u) => u.key).join(', ') })}</div>}
            {empty.length > 0 && <div className="issue warning">{t('template.var.emptySummary', { count: empty.length, list: empty.map((u) => u.key).join(', ') })}</div>}
          </div>
        )}
        {uses.length ? (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('template.variable')}</th>
                  <th>{t('template.description')}</th>
                  <th className="right">{t('template.uses')}</th>
                  <th>{t('template.previewValue')}</th>
                  <th>{t('field.status')}</th>
                </tr>
              </thead>
              <tbody>
                {uses.map((u) => {
                  const known = ALL_VARIABLES.includes(u.key);
                  const value = vars[u.key];
                  return (
                    <tr key={u.key}>
                      <td>
                        <button type="button" className="var-chip" onClick={() => copy(`{{${u.key}}}`)} title={t('template.copyVar')}>
                          {`{{${u.key}}}`}
                        </button>
                      </td>
                      <td className="small">{known ? t(`var.${u.key}`) : <span className="muted">{t('template.var.unknownDesc')}</span>}</td>
                      <td className="right num">{u.uses}</td>
                      <td className="small" style={{ maxWidth: 280, whiteSpace: 'pre-line' }}>
                        {value ? value : u.fallbackText !== undefined ? <i className="muted">→ {u.fallbackText || '∅'}</i> : <span className="muted">—</span>}
                      </td>
                      <td>{status(u)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted small">{t('template.noVars')}</div>
        )}
      </Card>
      <Card title={t('template.varsAvailable')} sub={t('template.varsAvailableHint')}>
        <div className="grid grid-2">
          {VARIABLE_GROUPS.map((g) => (
            <div key={g.group}>
              <h4 className="mb-8">{t(`vargroup.${g.group}`)}</h4>
              <div className="list">
                {g.keys.map((k) => (
                  <div key={k} className="list-item">
                    <button type="button" className="var-chip" onClick={() => copy(`{{${k}}}`)} title={t('template.copyVar')}>
                      {`{{${k}}}`}
                    </button>
                    <span className="grow small">{t(`var.${k}`)}</span>
                    {used.has(k) && <Badge tone="success">{t('template.inUse')}</Badge>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function UsageTab({ template, projects }: { template: Template; projects: Project[] }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const ui = useUI();
  const settings = useSettings();
  const recipientIds = useMemo(() => uniq(projects.map((p) => p.recipientId).filter((x): x is string => !!x)), [projects]);
  const recipients = useLiveQuery(async () => new Map((await db.recipients.bulkGet(recipientIds)).filter((r): r is Recipient => !!r).map((r) => [r.id, r])), [recipientIds]);
  const products = useLiveQuery(() => db.products.filter((p) => p.templateId === template.id || (p.documentTemplateIds ?? []).includes(template.id)).toArray(), [template.id]) ?? [];
  const parents = useLiveQuery(() => db.templates.filter((x) => (x.documentTemplateIds ?? []).includes(template.id)).toArray(), [template.id]) ?? [];
  const rName = (id?: string) => {
    const r = id ? recipients?.get(id) : undefined;
    return r ? `${r.firstName} ${r.lastName}` : '—';
  };
  return (
    <div className="grid grid-3">
      <Card
        title={t('template.usage.projects')}
        sub={t('template.usage.projectsHint')}
        className="span-2"
        actions={
          template.kind === 'letter' &&
          can('projects.edit') &&
          !template.archived && (
            <button className="btn sm accent" onClick={() => ui.openPackageWizard({ templateId: template.id })}>
              <Wand2 /> {t('template.use')}
            </button>
          )
        }
      >
        <DataTable
          rows={projects}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/projects/${p.id}`)}
          initialSort={{ key: 'created', dir: 'desc' }}
          compact
          pageSize={15}
          empty={<div className="empty">{t('template.usage.none')}</div>}
          columns={[
            {
              key: 'code',
              header: t('project.code'),
              render: (p) => (
                <a className="mono" href={`#/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>
                  {p.code}
                </a>
              ),
              sort: (p) => p.code,
            },
            { key: 'name', header: t('field.name'), render: (p) => p.name.split(' — ')[0], sort: (p) => p.name },
            { key: 'rec', header: t('nav.recipients'), render: (p) => rName(p.recipientId), sort: (p) => rName(p.recipientId) },
            { key: 'role', header: t('template.usage.role'), render: (p) => (p.templateId === template.id ? t('template.usage.main') : t('template.usage.enclosure')) },
            { key: 'stage', header: t('project.stage'), render: (p) => <StatusBadge group="stage" value={p.stage} /> },
            { key: 'created', header: t('common.created'), render: (p) => fmt.date(p.createdAt), sort: (p) => p.createdAt },
          ]}
        />
      </Card>
      <div className="col gap-16">
        <Card title={t('template.usage.products')}>
          {products.length ? (
            <div className="list">
              {products.map((p) => (
                <div key={p.id} className="list-item">
                  <Package size={16} />
                  <span className="grow">{p.name}</span>
                  <span className="mono small muted">{p.sku}</span>
                  {!p.active && <Badge>{t('template.usage.inactive')}</Badge>}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted small">{t('template.usage.noProducts')}</div>
          )}
        </Card>
        {template.kind === 'document' && (
          <Card title={t('template.usage.letters')}>
            {parents.length ? (
              <div className="list">
                {parents.map((x) => (
                  <a key={x.id} className="list-item" href={`#/templates/${x.id}`}>
                    <FileText size={16} />
                    <span className="grow">{x.name}</span>
                    {x.archived && <Badge>{t('common.archived')}</Badge>}
                  </a>
                ))}
              </div>
            ) : (
              <div className="muted small">{t('template.usage.noLetters')}</div>
            )}
          </Card>
        )}
        {template.kind === 'letter' && settings.mail.defaultLetterTemplateId === template.id && (
          <div className="issue warning">{t('template.usage.isDefault')}</div>
        )}
      </div>
    </div>
  );
}

function TemplateEditorPage({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { can } = useSession();
  const lib = useLib();
  const ui = useUI();
  const actions = useTemplateActions();
  const { template, patch, saving, flush } = useTemplateDraft(id);
  const [mode, setMode] = useState<'sample' | 'recipient'>('sample');
  const [recipientId, setRecipientId] = useState<string | undefined>();
  const recipient = useLiveQuery(() => (mode === 'recipient' && recipientId ? db.recipients.get(recipientId) : undefined), [mode, recipientId]);
  const projects = useLiveQuery(() => db.projects.filter((p) => p.templateId === id || p.documents.some((d) => d.templateId === id)).toArray(), [id]);

  const language = template?.language;
  const stampId = template?.stampId;
  const postmarkId = template?.postmarkId;
  const sealId = template?.sealId;
  const tplSenderId = template?.senderId;
  const ctx = useMemo<RenderCtx | undefined>(() => {
    if (!language) return undefined;
    const senderId = tplSenderId ?? lib.settings?.mail.defaultSenderId;
    const sender = senderId ? lib.characters.get(senderId) : undefined;
    let vars: VarContext;
    let houseId: string | undefined;
    if (recipient) {
      const house = recipient.houseId ? lib.houses.get(recipient.houseId) : undefined;
      const documentNumber = formatDocumentNumber(lib.settings?.mail.documentNumberFormat ?? '{YYYY}/{NNNNN}', 1, recipient.code);
      vars = buildContext({ recipient, house, sender, settings: lib.settings, lang: language, documentNumber });
      houseId = recipient.houseId;
    } else {
      vars = sampleVarsFor(lib, language, senderId);
      houseId = lib.houseList[0]?.id;
    }
    return {
      vars,
      lib,
      refs: {
        stampId: stampId ?? lib.settings?.defaults.stampId,
        postmarkId: postmarkId ?? lib.settings?.defaults.postmarkId,
        sealId: sealId ?? lib.settings?.defaults.sealId,
        senderId,
        houseId,
      },
      idPrefix: 'te',
      locale,
      editor: true,
    };
  }, [language, stampId, postmarkId, sealId, tplSenderId, recipient, lib, locale]);

  const varCount = useMemo(() => (template ? analyzeVariables(template.layout).length : 0), [template?.layout]);

  if (template === undefined) return null;
  if (template === null)
    return (
      <EmptyState
        icon={<FileText />}
        title={t('template.notFound')}
        action={
          <a className="btn" href="#/templates">
            {t('common.back')}
          </a>
        }
      />
    );
  if (!ctx) return null;

  const editable = can('templates.edit');
  const canExport = editable || can('data.export');
  const usageCount = projects?.length ?? 0;
  const isLetter = template.kind === 'letter';
  const requested = route.query.get('tab') ?? 'layout';
  const tab = requested === 'package' && !isLetter ? 'layout' : requested;
  const listHref = isLetter ? '#/templates' : '#/templates?kind=document';

  const preview = <PreviewControl mode={mode} onMode={setMode} recipientId={recipientId} onRecipient={setRecipientId} />;

  const tabs = [
    { key: 'layout', label: t('template.tab.layout'), icon: <LayoutTemplate /> },
    { key: 'settings', label: t('template.tab.settings'), icon: <Settings2 /> },
    ...(isLetter ? [{ key: 'package', label: t('template.tab.package'), icon: <Package /> }] : []),
    { key: 'variables', label: t('template.tab.variables'), icon: <Braces />, count: varCount },
    { key: 'usage', label: t('template.tab.usage'), icon: <FolderKanban />, count: usageCount },
  ];

  const W = template.layout.w;
  const H = template.layout.h;
  const exportCtx: RenderCtx = { ...ctx, editor: false, idPrefix: 'xt' };

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: t('nav.templates'), href: '#/templates' },
          ...(isLetter ? [] : [{ label: t('template.documents'), href: '#/templates?kind=document' }]),
          { label: template.name || t('template.untitled') },
        ]}
        title={
          <span className="row wrap">
            {editable ? (
              <input
                className="input"
                value={template.name}
                onChange={(e) => patch({ name: e.target.value })}
                onBlur={() => !template.name.trim() && patch({ name: t('template.untitled') })}
                aria-label={t('field.name')}
                style={{ fontSize: 20, fontWeight: 600, height: 40, width: 'min(460px, 100%)' }}
              />
            ) : (
              template.name
            )}
            <Badge tone={isLetter ? 'primary' : 'accent'}>{t(`template.kind.${template.kind}`)}</Badge>
            {template.archived && <Badge>{t('common.archived')}</Badge>}
          </span>
        }
        sub={
          <span className="row wrap gap-12">
            <span>{t(`tplcat.${template.category}`)}</span>
            {!isLetter && <span>{t(`doctype.${template.docType}`)}</span>}
            <span className="num">
              {round(W, 1)} × {round(H, 1)} mm
            </span>
            <span className="mono small">{template.language.toUpperCase()}</span>
            {editable && (
              <span className={`small ${saving === 'error' ? '' : 'muted'}`} style={saving === 'error' ? { color: 'var(--danger)' } : undefined}>
                {saving === 'pending' ? t('common.saving') : saving === 'saved' ? t('common.allSaved') : saving === 'error' ? t('template.saveFailed') : t('common.autosave')}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {isLetter && can('projects.edit') && !template.archived && (
              <button
                className="btn accent"
                onClick={async () => {
                  await flush();
                  ui.openPackageWizard({ templateId: id });
                }}
              >
                <Wand2 /> {t('template.use')}
              </button>
            )}
            {editable && (
              <button
                className="btn"
                onClick={async () => {
                  await flush();
                  const fresh = await db.templates.get(id);
                  const copy = fresh ? await actions.duplicate(fresh) : undefined;
                  if (copy) navigate(`/templates/${copy.id}`);
                }}
              >
                <Copy /> {t('common.duplicate')}
              </button>
            )}
            {canExport && (
              <button
                className="btn"
                onClick={async () => {
                  await flush();
                  await actions.exportJSON(id);
                }}
              >
                <Download /> {t('template.exportJson')}
              </button>
            )}
            {editable && (
              <button className="btn" onClick={() => patch({ archived: !template.archived })}>
                {template.archived ? <ArchiveRestore /> : <Archive />} {template.archived ? t('common.restore') : t('common.archive')}
              </button>
            )}
            {editable && (
              <button
                className="btn danger icon"
                title={t('common.delete')}
                aria-label={t('common.delete')}
                onClick={async () => {
                  await flush();
                  if (await actions.remove(template, usageCount)) navigate(listHref.slice(1));
                }}
              >
                <Trash2 />
              </button>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setQuery('tab', k === 'layout' ? null : k)} />

      {tab === 'layout' && (
        <div className="col gap-12">
          <div className="row wrap">
            {preview}
            <span className="grow" />
            <ExportButtons w={W} h={H} name={template.name || 'template'} build={() => <LayoutSVG layout={template.layout} ctx={exportCtx} width={`${W}mm`} height={`${H}mm`} />} />
          </div>
          {editable ? (
            <CanvasEditor className="embedded" layout={template.layout} onChange={(l) => patch({ layout: l })} ctx={ctx} />
          ) : (
            <Card>
              <div className="row" style={{ justifyContent: 'center' }}>
                <LayoutView layout={template.layout} ctx={exportCtx} width={(640 * W) / H} height={640} className="paper-shadow" style={{ maxWidth: '100%', height: 'auto' }} />
              </div>
              <div className="muted small mt-16">{t('template.readOnly')}</div>
            </Card>
          )}
        </div>
      )}

      {tab === 'settings' && <SettingsTab template={template} patch={patch} editable={editable} />}
      {tab === 'package' && isLetter && <PackageTab template={template} patch={patch} editable={editable} />}
      {tab === 'variables' && <VariablesTab template={template} vars={ctx.vars} preview={preview} />}
      {tab === 'usage' && <UsageTab template={template} projects={projects ?? []} />}
    </div>
  );
}

export function TemplateEditor({ id }: { id: string }) {
  return <TemplateEditorPage key={id} id={id} />;
}
