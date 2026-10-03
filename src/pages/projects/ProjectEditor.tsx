import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileText,
  FolderKanban,
  Mail,
  Paperclip,
  Plus,
  Printer,
  RotateCcw,
  Stamp,
  Trash2,
  Truck,
  Wand2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ENVELOPE_DIMENSIONS, foldedSize, fitsEnvelope } from '../../core/defaults';
import { ENVELOPE_SIZES, PROJECT_STAGES, type EnvelopeDesign, type Layout, type Project } from '../../core/types';
import { downloadBlob, nowISO, safeFileName } from '../../core/util';
import { db } from '../../db/db';
import {
  archiveProjects,
  copyEnvelope,
  copyLayout,
  createBatch,
  createShipment,
  deleteProject,
  duplicateProject,
  generateProject,
  projectDocFromTemplate,
  setProjectStage,
  updateBatch,
  updateProject,
} from '../../db/services';
import { useFmt, useProjectCtx, useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate, setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import type { RenderCtx } from '../../render/context';
import { DielineArt, dielineGeometry, flapPath, LinerFill } from '../../render/envelope';
import { exportSingle, printPages, type ExportFormat } from '../../render/export';
import { imposeSection } from '../../render/imposition';
import { LayoutSVG } from '../../render/LayoutSVG';
import { validateProject } from '../../render/validateProject';
import { CanvasEditor } from '../../ui/CanvasEditor';
import { Badge, Card, EmptyState, Field, IssueList, Modal, PageHeader, ReadyBanner, StatusBadge, Tabs } from '../../ui/kit';
import { FilesPanel } from '../shared/FilesPanel';
import { EnvelopePicker, LibraryPicker, MultiTemplatePicker, RecipientSelect, useSampleCtx } from '../shared/pickers';
import { RealisticPreview } from '../shared/RealisticPreview';
import { buildSections, useBundles } from '../print/bundle';

export function ExportButtons({ build, w, h, name }: { build: () => JSX.Element; w: number; h: number; name: string }) {
  const { t } = useI18n();
  const settings = useSettings();
  const run = useAction();
  return (
    <div className="row gap-4">
      {(['pdf', 'png', 'jpg', 'svg'] as ExportFormat[]).map((f) => (
        <button key={f} className="btn sm" onClick={() => run(() => exportSingle(build(), w, h, f, settings.print.resolution, name), t('common.exported'))}>
          <Download /> {f.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Local draft + debounced autosave on top of the live record. */
function useProjectDraft(id: string) {
  const dbProject = useLiveQuery(() => db.projects.get(id), [id]);
  const pending = useRef<Partial<Project>>({});
  const [, force] = useState(0);
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const flush = useCallback(async () => {
    const snap = pending.current;
    if (!Object.keys(snap).length) return;
    await updateProject(id, snap);
    const rest: Partial<Project> = {};
    for (const [k, v] of Object.entries(pending.current)) if ((snap as Record<string, unknown>)[k] !== v) (rest as Record<string, unknown>)[k] = v;
    pending.current = rest;
    setSaving(Object.keys(rest).length ? 'pending' : 'saved');
  }, [id]);
  const patch = useCallback(
    (p: Partial<Project>) => {
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
  const project = dbProject ? ({ ...dbProject, ...pending.current } as Project) : dbProject;
  return { project, patch, saving, flush };
}

function StageControl({ project }: { project: Project }) {
  const { tEnum, t } = useI18n();
  const run = useAction();
  const { can } = useSession();
  const idx = PROJECT_STAGES.indexOf(project.stage);
  const next = PROJECT_STAGES[idx + 1];
  const prev = PROJECT_STAGES[idx - 1];
  return (
    <div className="col">
      <div className="steps">
        {PROJECT_STAGES.map((s, i) => (
          <span key={s} className={`s ${s === project.stage ? 'active' : i < idx ? 'done' : ''}`}>
            <span className="n">{i + 1}</span>
            {tEnum('stage', s)}
          </span>
        ))}
      </div>
      {can('production.edit') && (
        <div className="row">
          {prev && (
            <button className="btn sm" onClick={() => run(() => setProjectStage([project.id], prev), t('common.saved'))}>
              <ArrowLeft /> {tEnum('stage', prev)}
            </button>
          )}
          {next && (
            <button className="btn sm primary" onClick={() => run(() => setProjectStage([project.id], next), t('project.movedTo', { stage: tEnum('stage', next) }))}>
              {tEnum('stage', next)} <ArrowRight />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EnvelopeTab({ project, patch, ctx }: { project: Project; patch: (p: Partial<Project>) => void; ctx: RenderCtx }) {
  const { t } = useI18n();
  const [face, setFace] = useState('front');
  const [pickOpen, setPickOpen] = useState(false);
  const sampleCtx = useSampleCtx('envpick');
  const env = project.envelope;
  const setEnv = (e: Partial<EnvelopeDesign>) => patch({ envelope: { ...env, ...e } });
  const resize = (size: EnvelopeDesign['size'], w?: number, h?: number) => {
    const [W, H] = size === 'custom' ? [w ?? env.front.w, h ?? env.front.h] : ENVELOPE_DIMENSIONS[size];
    const sx = W / env.front.w;
    const sy = H / env.front.h;
    const scaleEls = (l: Layout): Layout => ({ ...l, w: W, h: H, elements: l.elements.map((e) => ({ ...e, x: e.x * sx, y: e.y * sy })) });
    setEnv({ size, front: scaleEls(env.front), back: scaleEls(env.back) });
  };
  const folded = foldedSize(project.letter.w, project.letter.h, project.fold);
  const fits = fitsEnvelope(folded, [env.front.w, env.front.h]);
  const g = dielineGeometry(env.front.w, env.front.h);
  return (
    <div className="col gap-12">
      <div className="row wrap">
        <Tabs
          pill
          value={face}
          onChange={setFace}
          tabs={[
            { key: 'front', label: t('envelope.front') },
            { key: 'back', label: t('envelope.back') },
            { key: 'inside', label: t('envelope.inside') },
            { key: 'layout', label: t('envelope.printLayout') },
          ]}
        />
        <span className="grow" />
        <select className="select sm" style={{ width: 120 }} value={env.size} onChange={(e) => resize(e.target.value as EnvelopeDesign['size'])} aria-label={t('envelope.size')}>
          {ENVELOPE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s === 'custom' ? t('common.custom') : `${s} (${ENVELOPE_DIMENSIONS[s as Exclude<typeof s, 'custom'>].join('×')})`}
            </option>
          ))}
        </select>
        {env.size === 'custom' && (
          <>
            <input className="input sm" style={{ width: 70 }} type="number" value={Math.round(env.front.w)} onChange={(e) => resize('custom', Number(e.target.value), env.front.h)} aria-label="W" />
            <input className="input sm" style={{ width: 70 }} type="number" value={Math.round(env.front.h)} onChange={(e) => resize('custom', env.front.w, Number(e.target.value))} aria-label="H" />
          </>
        )}
        <select className="select sm" style={{ width: 140 }} value={env.flap} onChange={(e) => setEnv({ flap: e.target.value as EnvelopeDesign['flap'] })} aria-label={t('envelope.flap')}>
          {['pointed', 'straight', 'curved', 'wallet'].map((f) => (
            <option key={f} value={f}>
              {t(`flap.${f}`)}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => setPickOpen(true)}>
          {t('envelope.changeDesign')}
        </button>
        <Badge tone={fits ? 'success' : 'danger'}>{fits ? t('envelope.fits', { w: Math.round(folded[0]), h: Math.round(folded[1]) }) : t('envelope.noFit')}</Badge>
      </div>
      {face === 'front' && <CanvasEditor className="embedded" layout={env.front} onChange={(l) => setEnv({ front: l })} ctx={ctx} lockSize />}
      {face === 'back' && (
        <CanvasEditor
          className="embedded"
          layout={env.back}
          onChange={(l) => setEnv({ back: l })}
          ctx={ctx}
          lockSize
          overlay={<path d={flapPath(env.flap, env.back.w, env.back.h)} fill="none" stroke="#8a6a35" strokeWidth={0.4} strokeDasharray="2 1.2" pointerEvents="none" />}
        />
      )}
      {face === 'inside' && (
        <Card>
          <div className="row wrap gap-16">
            <Field label={t('envelope.liner')}>
              <select className="select" value={env.liner.pattern} onChange={(e) => setEnv({ liner: { ...env.liner, pattern: e.target.value as EnvelopeDesign['liner']['pattern'] } })}>
                {['none', 'stripes', 'stars', 'damask', 'dots', 'diamonds'].map((p) => (
                  <option key={p} value={p}>
                    {t(`liner.${p}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('editor.color')}>
              <input className="input" type="color" value={env.liner.color} onChange={(e) => setEnv({ liner: { ...env.liner, color: e.target.value } })} />
            </Field>
            <Field label={t('envelope.accent')}>
              <input className="input" type="color" value={env.liner.color2} onChange={(e) => setEnv({ liner: { ...env.liner, color2: e.target.value } })} />
            </Field>
          </div>
          <svg viewBox={`0 0 ${env.front.w} ${env.front.h}`} style={{ width: '100%', maxWidth: 520, marginTop: 16 }} className="paper-shadow">
            <defs>
              <LinerFill id="liner-prev" pattern={env.liner.pattern} color={env.liner.color} color2={env.liner.color2} />
            </defs>
            <rect width={env.front.w} height={env.front.h} fill={env.liner.pattern === 'none' ? env.front.paper.color : 'url(#liner-prev)'} />
          </svg>
          <div className="muted small mt-8">{t('envelope.linerHint')}</div>
        </Card>
      )}
      {face === 'layout' && (
        <Card title={t('envelope.dielineTitle')} sub={t('envelope.dielineSub', { w: Math.round(g.W), h: Math.round(g.H) })}>
          <svg viewBox={`-4 -4 ${g.W + 8} ${g.H + 8}`} style={{ width: '100%', maxHeight: 560, background: '#fff', borderRadius: 8 }}>
            <DielineArt env={env} ctx={{ ...ctx, editor: false, idPrefix: 'dl' }} />
          </svg>
          <div className="muted small mt-8">{t('envelope.dielineHint')}</div>
        </Card>
      )}
      {pickOpen && (
        <Modal title={t('envelope.changeDesign')} onClose={() => setPickOpen(false)} size="xl">
          <EnvelopePicker
            ctx={sampleCtx}
            onChange={(e) => {
              patch({ envelope: copyEnvelope(e) });
              setPickOpen(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function DocumentsTab({ project, patch, ctx }: { project: Project; patch: (p: Partial<Project>) => void; ctx: RenderCtx }) {
  const { t } = useI18n();
  const [active, setActive] = useState<string | null>(project.documents[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const sampleCtx = useSampleCtx('docpick');
  const doc = project.documents.find((d) => d.id === active);
  return (
    <div className="col gap-12">
      <div className="row wrap">
        {project.documents.map((d) => (
          <button key={d.id} className={`btn sm ${d.id === active ? 'primary' : ''}`} onClick={() => setActive(d.id)}>
            <FileText /> {d.name}
          </button>
        ))}
        <button className="btn sm" onClick={() => (setIds([]), setAdding(true))}>
          <Plus /> {t('project.addDocument')}
        </button>
        <span className="grow" />
        {doc && (
          <button
            className="btn sm danger"
            onClick={() => {
              patch({ documents: project.documents.filter((x) => x.id !== doc.id) });
              setActive(project.documents.find((x) => x.id !== doc.id)?.id ?? null);
            }}
          >
            <Trash2 /> {t('project.removeDocument')}
          </button>
        )}
      </div>
      {doc ? (
        <>
          <div className="row">
            <input className="input sm" style={{ maxWidth: 320 }} value={doc.name} onChange={(e) => patch({ documents: project.documents.map((x) => (x.id === doc.id ? { ...x, name: e.target.value } : x)) })} aria-label={t('field.name')} />
            <span className="grow" />
            <ExportButtons w={doc.layout.w} h={doc.layout.h} name={`${project.code}-${doc.name}`} build={() => <LayoutSVG layout={doc.layout} ctx={{ ...ctx, editor: false, idPrefix: 'xd' }} width={`${doc.layout.w}mm`} height={`${doc.layout.h}mm`} />} />
          </div>
          <CanvasEditor className="embedded" layout={doc.layout} onChange={(l) => patch({ documents: project.documents.map((x) => (x.id === doc.id ? { ...x, layout: l } : x)) })} ctx={ctx} />
        </>
      ) : (
        <EmptyState icon={<FileText />} title={t('project.noDocuments')} text={t('project.noDocumentsHint')} />
      )}
      {adding && (
        <Modal
          title={t('project.addDocument')}
          onClose={() => setAdding(false)}
          size="xl"
          footer={
            <button
              className="btn primary"
              disabled={!ids.length}
              onClick={async () => {
                const templates = (await db.templates.bulkGet(ids)).filter(Boolean);
                const docs = templates.map((tp) => projectDocFromTemplate(tp!));
                patch({ documents: [...project.documents, ...docs] });
                setActive(docs[0]?.id ?? active);
                setAdding(false);
              }}
            >
              {t('common.add')} ({ids.length})
            </button>
          }
        >
          <MultiTemplatePicker value={ids} onChange={setIds} ctx={sampleCtx} />
        </Modal>
      )}
    </div>
  );
}

export function ProjectEditor({ id }: { id: string }) {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const route = useRoute();
  const settings = useSettings();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const { project, patch, saving, flush } = useProjectDraft(id);
  const ctx = useProjectCtx(project, 'pe', true);
  const tab = route.query.get('tab') ?? 'overview';
  const recipient = useLiveQuery(() => (project?.recipientId ? db.recipients.get(project.recipientId) : undefined), [project?.recipientId]);
  const order = useLiveQuery(() => (project?.orderId ? db.orders.get(project.orderId) : undefined), [project?.orderId]);
  const characters = useLiveQuery(() => db.characters.toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.documents.where('projectId').equals(id).reverse().sortBy('createdAt'), [id]) ?? [];
  const shipments = useLiveQuery(() => db.shipments.where('projectId').equals(id).toArray(), [id]) ?? [];
  const template = useLiveQuery(() => (project?.templateId ? db.templates.get(project.templateId) : undefined), [project?.templateId]);
  const batches = useLiveQuery(() => db.batches.where('status').equals('draft').toArray(), []) ?? [];
  const bundles = useBundles(project ? [project.id] : undefined);
  const issues = useMemo(() => (project && ctx ? validateProject({ project, recipient, order, vars: ctx.vars, lib: ctx.lib }) : []), [project, ctx, recipient, order]);

  if (project === undefined) return null;
  if (!project) return <EmptyState icon={<FolderKanban />} title={t('project.notFound')} action={<a className="btn" href="#/projects">{t('common.back')}</a>} />;
  if (!ctx) return null;
  const editable = can('projects.edit');

  const printSection = async (key: string) => {
    if (!bundles) return;
    await flush();
    const ps = { ...settings.print, ...project.print };
    const sections = buildSections(bundles, ps, { letters: true, envelopes: true, labels: true, stamps: true, documents: true, packingSlips: true }, settings, t);
    const sec = sections.find((s) => s.key === key);
    if (sec) await printPages(imposeSection(sec, ps));
  };

  const exportJSON = async () => {
    await flush();
    const p = await db.projects.get(id);
    const ids = new Set<string>();
    const collect = (l: Layout) => l.elements.forEach((e) => e.type === 'image' && e.assetId && ids.add(e.assetId));
    if (p) {
      collect(p.letter);
      collect(p.envelope.front);
      collect(p.envelope.back);
      p.documents.forEach((d) => collect(d.layout));
    }
    const payload = {
      format: 'hmms-project',
      version: 1,
      exportedAt: nowISO(),
      project: p,
      assets: (await db.assets.bulkGet(Array.from(ids))).filter(Boolean),
      stamp: p?.stampId ? await db.stamps.get(p.stampId) : undefined,
      postmark: p?.postmarkId ? await db.postmarks.get(p.postmarkId) : undefined,
      seal: p?.sealId ? await db.seals.get(p.sealId) : undefined,
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${safeFileName(project.code)}.project.json`);
  };

  const tabs = [
    { key: 'overview', label: t('project.tab.overview'), icon: <ClipboardList /> },
    { key: 'letter', label: t('project.tab.letter'), icon: <FileText /> },
    { key: 'envelope', label: t('project.tab.envelope'), icon: <Mail /> },
    { key: 'postage', label: t('project.tab.postage'), icon: <Stamp /> },
    { key: 'documents', label: t('project.tab.documents'), icon: <FileText />, count: project.documents.length },
    { key: 'print', label: t('project.tab.print'), icon: <Printer /> },
    { key: 'shipping', label: t('project.tab.shipping'), icon: <Truck />, count: shipments.length },
    { key: 'preview', label: t('project.tab.preview'), icon: <Eye /> },
    { key: 'files', label: t('project.tab.files'), icon: <Paperclip /> },
  ];

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t('nav.projects'), href: '#/projects' }, { label: project.code }]}
        title={
          <span className="row wrap">
            {project.name}
            <StatusBadge group="stage" value={project.stage} />
            {project.status === 'archived' && <Badge>{t('common.archived')}</Badge>}
          </span>
        }
        sub={
          <span className="row wrap gap-12">
            <span className="mono">{project.code}</span>
            {recipient && <a href={`#/recipients/${recipient.id}`}>{recipient.firstName} {recipient.lastName} · #{recipient.code}</a>}
            {order && <a href={`#/orders/${order.id}`}>{order.number}</a>}
            <span className="muted small">{saving === 'pending' ? t('common.saving') : saving === 'saved' ? t('common.allSaved') : t('common.autosave')}</span>
          </span>
        }
        actions={
          editable && (
            <>
              <button className="btn" onClick={() => run(async () => navigate(`/projects/${(await duplicateProject(id)).id}`), t('project.duplicated'))}>
                <Copy /> {t('common.duplicate')}
              </button>
              <button className="btn" onClick={exportJSON}>
                <Download /> {t('common.export')}
              </button>
              <button className="btn" onClick={() => run(() => archiveProjects([id], project.status !== 'archived'), t('common.saved'))}>
                <Archive /> {project.status === 'archived' ? t('common.restore') : t('common.archive')}
              </button>
              <button
                className="btn danger icon"
                title={t('common.delete')}
                onClick={async () => {
                  if (await confirm({ title: t('project.deleteTitle', { code: project.code }), body: t('project.deleteBody'), danger: true, confirm: t('common.delete') })) {
                    await run(() => deleteProject(id), t('common.deleted'));
                    navigate('/projects');
                  }
                }}
              >
                <Trash2 />
              </button>
            </>
          )
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setQuery('tab', k === 'overview' ? null : k)} />

      {tab === 'overview' && (
        <div className="grid grid-3">
          <Card title={t('project.pipeline')} className="span-2">
            <StageControl project={project} />
          </Card>
          <Card title={t('project.validation')}>
            <ReadyBanner issues={issues} />
            <div className="mt-8">
              <IssueList issues={issues} max={8} />
            </div>
          </Card>
          <Card title={t('project.details')} className="span-2">
            <div className="form-grid">
              <Field label={t('field.name')} className="full">
                <input className="input" value={project.name} disabled={!editable} onChange={(e) => patch({ name: e.target.value })} />
              </Field>
              <Field label={t('nav.recipients')}>
                {editable ? (
                  <RecipientSelect
                    value={project.recipientId}
                    onChange={(rid, r) => patch({ recipientId: rid, shipping: { ...project.shipping, addressId: r?.defaultAddressId } })}
                  />
                ) : (
                  <span>{recipient ? `${recipient.firstName} ${recipient.lastName}` : '—'}</span>
                )}
              </Field>
              <Field label={t('project.sender')}>
                <select className="select" value={project.senderId ?? ''} disabled={!editable} onChange={(e) => patch({ senderId: e.target.value || undefined })}>
                  <option value="">—</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('order.dueDate')}>
                <input className="input" type="date" value={project.dueDate ?? ''} disabled={!editable} onChange={(e) => patch({ dueDate: e.target.value || undefined })} />
              </Field>
              <Field label={t('project.template')}>
                <div className="row">
                  <span className="grow">{template ? <a href={`#/templates/${template.id}`}>{template.name}</a> : '—'}</span>
                </div>
              </Field>
            </div>
          </Card>
          <Card title={t('project.actions')}>
            <div className="col">
              {can('production.edit') && (
                <button className="btn" onClick={() => run(() => flush().then(() => generateProject(id)), t('project.generated'))}>
                  <Wand2 /> {docs.some((d) => d.status !== 'void') ? t('project.regenerate') : t('project.generate')}
                </button>
              )}
              {can('print') && (
                <button
                  className="btn"
                  onClick={async () => {
                    await flush();
                    if (project.batchId) return navigate(`/print/${project.batchId}`);
                    const b = batches[0];
                    if (b) {
                      await run(() => updateBatch(b.id, { projectIds: Array.from(new Set([...b.projectIds, id])) }), t('print.addedToBatch', { code: b.code }));
                    } else {
                      const nb = await run(() => createBatch([id]), t('print.batchCreated'));
                      if (nb) navigate(`/print/${nb.id}`);
                    }
                  }}
                >
                  <Printer /> {project.batchId ? t('print.openBatch') : batches[0] ? t('print.addToBatch', { code: batches[0].code }) : t('print.newBatch')}
                </button>
              )}
              <a className="btn" href={`#/assembly/${id}`}>
                <ClipboardList /> {t('assembly.open')}
              </a>
              {can('shipping.edit') && (
                <button className="btn" onClick={() => run(() => createShipment({ projectId: id }).then((s) => navigate(`/shipments?id=${s.id}`)), t('shipment.created'))}>
                  <Truck /> {t('shipment.create')}
                </button>
              )}
              {template && editable && (
                <button
                  className="btn ghost"
                  onClick={async () => {
                    if (await confirm({ title: t('project.resetTitle'), body: t('project.resetBody'), confirm: t('project.reset') })) patch({ letter: copyLayout(template.layout) });
                  }}
                >
                  <RotateCcw /> {t('project.resetLetter')}
                </button>
              )}
            </div>
          </Card>
          <Card title={t('project.generatedItems')} className="span-all">
            {docs.length ? (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>{t('doc.number')}</th>
                      <th>{t('doc.title')}</th>
                      <th>{t('doc.kind')}</th>
                      <th>{t('field.status')}</th>
                      <th>{t('common.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id} style={{ opacity: d.status === 'void' ? 0.5 : 1 }}>
                        <td className="mono">{d.number}</td>
                        <td>{d.title}</td>
                        <td>{t(`dockind.${d.kind}`)}</td>
                        <td>
                          <StatusBadge group="doc" value={d.status} />
                        </td>
                        <td>{fmt.dateTime(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="muted small">{t('project.notGenerated')}</div>
            )}
          </Card>
        </div>
      )}

      {tab === 'letter' && (
        <div className="col gap-12">
          <div className="row wrap">
            <Field>
              <select className="select sm" value={project.fold} onChange={(e) => patch({ fold: e.target.value as Project['fold'] })} aria-label={t('project.fold')}>
                {['none', 'half', 'trifold'].map((f) => (
                  <option key={f} value={f}>
                    {t('project.fold')}: {t(`fold.${f}`)}
                  </option>
                ))}
              </select>
            </Field>
            <span className="grow" />
            <ExportButtons w={project.letter.w} h={project.letter.h} name={`${project.code}-letter`} build={() => <LayoutSVG layout={project.letter} ctx={{ ...ctx, editor: false, idPrefix: 'xl' }} width={`${project.letter.w}mm`} height={`${project.letter.h}mm`} />} />
          </div>
          <CanvasEditor className="embedded" layout={project.letter} onChange={(l) => patch({ letter: l })} ctx={ctx} />
        </div>
      )}

      {tab === 'envelope' && <EnvelopeTab project={project} patch={patch} ctx={ctx} />}

      {tab === 'postage' && (
        <div className="col gap-16">
          <Card title={t('el.stamp')}>
            <LibraryPicker kind="stamp" value={project.stampId} onChange={(v) => patch({ stampId: v })} />
          </Card>
          <Card
            title={t('el.postmark')}
            actions={
              <Field>
                <div className="row">
                  <span className="small muted">{t('postmark.dateOverride')}</span>
                  <input className="input sm" type="date" value={project.postmarkDate ?? ''} onChange={(e) => patch({ postmarkDate: e.target.value || undefined })} />
                </div>
              </Field>
            }
          >
            <LibraryPicker kind="postmark" value={project.postmarkId} onChange={(v) => patch({ postmarkId: v })} />
          </Card>
          <Card title={t('el.seal')}>
            <LibraryPicker kind="seal" value={project.sealId} onChange={(v) => patch({ sealId: v })} />
          </Card>
        </div>
      )}

      {tab === 'documents' && <DocumentsTab project={project} patch={patch} ctx={ctx} />}

      {tab === 'print' && (
        <div className="grid grid-2">
          <Card title={t('project.printNow')}>
            <ReadyBanner issues={issues} />
            <div className="col mt-16">
              {[
                ['letters', t('print.sec.letters')],
                ['documents', t('print.sec.documents')],
                ['envelopes', t('print.sec.envelopes')],
                ['labels', t('print.sec.labels')],
                ['stamps', t('print.sec.stamps')],
                ['slips', t('print.sec.slips')],
              ].map(([k, label]) => (
                <button key={k} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => printSection(k)} disabled={!bundles}>
                  <Printer /> {label}
                </button>
              ))}
            </div>
            <div className="muted small mt-16">{t('project.printHint')}</div>
          </Card>
          <Card title={t('project.printOverrides')}>
            <div className="form-grid">
              <Field label={t('print.envelopeMode')}>
                <select className="select" value={project.print.envelopeMode ?? settings.print.envelopeMode} onChange={(e) => patch({ print: { ...project.print, envelopeMode: e.target.value as 'direct' | 'dieline' } })}>
                  <option value="direct">{t('print.envDirect')}</option>
                  <option value="dieline">{t('print.envDieline')}</option>
                </select>
              </Field>
              <Field label={t('print.paper')}>
                <select className="select" value={project.print.paper ?? settings.print.paper} onChange={(e) => patch({ print: { ...project.print, paper: e.target.value as 'A4' } })}>
                  {['A4', 'A5', 'A3', 'Letter', 'Legal'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <a className="btn mt-16" href={project.batchId ? `#/print/${project.batchId}` : '#/print'}>
              {t('print.openStudio')}
            </a>
          </Card>
        </div>
      )}

      {tab === 'shipping' && (
        <div className="grid grid-2">
          <Card title={t('project.shippingInfo')}>
            <div className="form-grid">
              <Field label={t('project.shipTo')} className="full">
                <select className="select" value={project.shipping.addressId ?? ''} onChange={(e) => patch({ shipping: { ...project.shipping, addressId: e.target.value || undefined } })}>
                  {(recipient?.addresses ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {tEnum('addressLabel', a.label)} · {[a.line1, a.city, a.postalCode].filter(Boolean).join(', ')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('shipment.carrier')}>
                <select className="select" value={project.shipping.carrierId ?? ''} onChange={(e) => patch({ shipping: { ...project.shipping, carrierId: e.target.value } })}>
                  <option value="">—</option>
                  {settings.carriers.filter((c) => c.active).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('shipment.service')}>
                <select className="select" value={project.shipping.service ?? ''} onChange={(e) => patch({ shipping: { ...project.shipping, service: e.target.value } })}>
                  <option value="">—</option>
                  {(settings.carriers.find((c) => c.id === project.shipping.carrierId)?.services ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('field.notes')} className="full">
                <textarea className="textarea" rows={2} value={project.shipping.notes} onChange={(e) => patch({ shipping: { ...project.shipping, notes: e.target.value } })} />
              </Field>
            </div>
          </Card>
          <Card title={t('nav.shipments')} actions={can('shipping.edit') && <button className="btn sm primary" onClick={() => run(() => flush().then(() => createShipment({ projectId: id })), t('shipment.created'))}><Plus /> {t('shipment.create')}</button>}>
            {shipments.length ? (
              <div className="list">
                {shipments.map((s) => (
                  <a key={s.id} className="list-item" href={`#/shipments?id=${s.id}`}>
                    <span className="mono">{s.code}</span>
                    <span className="grow mono small">{s.trackingNumber}</span>
                    <StatusBadge group="shipment" value={s.status} />
                  </a>
                ))}
              </div>
            ) : (
              <div className="muted small">{t('order.noShipments')}</div>
            )}
          </Card>
        </div>
      )}

      {tab === 'preview' && <RealisticPreview project={project} ctx={{ ...ctx, editor: false }} />}
      {tab === 'files' && <FilesPanel ownerType="project" ownerId={project.id} />}
      {project.stage === 'ready' && shipments.length === 0 && tab === 'overview' && (
        <div className="issue warning mt-16">
          <CheckCircle2 /> {t('project.readyNoShipment')}
        </div>
      )}
    </div>
  );
}

