import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, ClipboardList, Download, Printer, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LABEL_PRESET_SPECS, PAPER_DIMENSIONS } from '../../core/defaults';
import { LABEL_PRESETS, PAPER_SIZES, type BatchInclude, type PrintSettings } from '../../core/types';
import { db } from '../../db/db';
import { deleteBatch, markBatchPrinted, updateBatch } from '../../db/services';
import { useFmt, useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate } from '../../app/router';
import { useSession } from '../../app/session';
import { useI18n } from '../../i18n';
import { exportPages, printPages, type ExportFormat } from '../../render/export';
import { imposeSection, PageSVG, type PrintPage } from '../../render/imposition';
import { Card, EmptyState, Field, IssueList, NumberInput, PageHeader, Progress, ReadyBanner, StatusBadge, Tabs, Toggle } from '../../ui/kit';
import { buildSections, useBundles } from './bundle';

export function PrintSettingsForm({ s, onChange }: { s: PrintSettings; onChange: (p: Partial<PrintSettings>) => void }) {
  const { t } = useI18n();
  return (
    <div className="form-grid">
      <Field label={t('print.paper')}>
        <select
          className="select"
          value={s.paper}
          onChange={(e) => {
            const paper = e.target.value as PrintSettings['paper'];
            const dims = paper === 'custom' ? [s.paperW, s.paperH] : PAPER_DIMENSIONS[paper];
            onChange({ paper, paperW: dims[0], paperH: dims[1] });
          }}
        >
          {PAPER_SIZES.map((p) => (
            <option key={p} value={p}>
              {p === 'custom' ? t('common.custom') : `${p} (${PAPER_DIMENSIONS[p as Exclude<typeof p, 'custom'>].join('×')})`}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('print.orientation')}>
        <select className="select" value={s.orientation} onChange={(e) => onChange({ orientation: e.target.value as PrintSettings['orientation'] })}>
          {['auto', 'portrait', 'landscape'].map((o) => (
            <option key={o} value={o}>
              {t(`orientation.${o}`)}
            </option>
          ))}
        </select>
      </Field>
      {s.paper === 'custom' && (
        <>
          <Field label="W (mm)">
            <NumberInput value={s.paperW} min={50} max={1200} onChange={(v) => onChange({ paperW: v ?? 210 })} />
          </Field>
          <Field label="H (mm)">
            <NumberInput value={s.paperH} min={50} max={1200} onChange={(v) => onChange({ paperH: v ?? 297 })} />
          </Field>
        </>
      )}
      <Field label={t('print.margins')}>
        <NumberInput value={s.margins} min={0} max={40} step={0.5} onChange={(v) => onChange({ margins: v ?? 0 })} />
      </Field>
      <Field label={t('print.bleed')}>
        <NumberInput value={s.bleed} min={0} max={10} step={0.5} onChange={(v) => onChange({ bleed: v ?? 0 })} />
      </Field>
      <Field label={t('print.scale')}>
        <NumberInput value={s.scale} min={25} max={200} onChange={(v) => onChange({ scale: v ?? 100 })} />
      </Field>
      <Field label={t('print.resolution')}>
        <select className="select" value={s.resolution} onChange={(e) => onChange({ resolution: Number(e.target.value) })}>
          {[96, 150, 200, 300, 600].map((d) => (
            <option key={d} value={d}>
              {d} dpi
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('print.envelopeMode')} className="full">
        <select className="select" value={s.envelopeMode} onChange={(e) => onChange({ envelopeMode: e.target.value as PrintSettings['envelopeMode'] })}>
          <option value="direct">{t('print.envDirect')}</option>
          <option value="dieline">{t('print.envDieline')}</option>
        </select>
      </Field>
      <Field label={t('print.labelPreset')}>
        <select
          className="select"
          value={s.labelPreset}
          onChange={(e) => {
            const p = e.target.value as PrintSettings['labelPreset'];
            const spec = p === 'custom' ? undefined : LABEL_PRESET_SPECS[p];
            onChange(spec ? { labelPreset: p, labelW: spec.w, labelH: spec.h, labelCols: spec.cols, labelRows: spec.rows, labelGap: spec.gap } : { labelPreset: p });
          }}
        >
          {LABEL_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p === 'custom' ? t('common.custom') : `${p} (${LABEL_PRESET_SPECS[p].cols}×${LABEL_PRESET_SPECS[p].rows})`}
            </option>
          ))}
        </select>
      </Field>
      {s.labelPreset === 'custom' && (
        <Field label={t('print.labelSize')}>
          <div className="row gap-4">
            <NumberInput className="input sm" value={s.labelW} onChange={(v) => onChange({ labelW: v ?? 60 })} />
            <NumberInput className="input sm" value={s.labelH} onChange={(v) => onChange({ labelH: v ?? 30 })} />
            <NumberInput className="input sm" value={s.labelCols} onChange={(v) => onChange({ labelCols: v ?? 2 })} />
            <NumberInput className="input sm" value={s.labelRows} onChange={(v) => onChange({ labelRows: v ?? 7 })} />
          </div>
        </Field>
      )}
      <div className="full col gap-4">
        <Toggle checked={s.cropMarks} onChange={(v) => onChange({ cropMarks: v })} label={t('print.cropMarks')} />
        <Toggle checked={s.cutLines} onChange={(v) => onChange({ cutLines: v })} label={t('print.cutLines')} />
        <Toggle checked={s.foldLines} onChange={(v) => onChange({ foldLines: v })} label={t('print.foldLines')} />
        <Toggle checked={s.safeArea} onChange={(v) => onChange({ safeArea: v })} label={t('print.safeArea')} />
      </div>
    </div>
  );
}

export function BatchDetail({ id }: { id: string }) {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const batch = useLiveQuery(() => db.batches.get(id), [id]);
  const bundles = useBundles(batch?.projectIds);
  const [section, setSection] = useState<string>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const sections = useMemo(() => (batch && bundles ? buildSections(bundles, batch.settings, batch.include, settings, t) : []), [batch, bundles, settings, t]);
  const pagesBySection = useMemo(() => {
    const m = new Map<string, PrintPage[]>();
    if (!batch) return m;
    for (const s of sections) m.set(s.key, imposeSection(s, batch.settings));
    return m;
  }, [sections, batch]);
  if (batch === undefined) return null;
  if (!batch) return <EmptyState icon={<Printer />} title={t('print.notFound')} />;
  const active = section || sections[0]?.key || '';
  const pages = pagesBySection.get(active) ?? [];
  const allIssues = (bundles ?? []).flatMap((b) => b.issues.map((i) => ({ ...i, subject: `${b.project.code}${i.subject ? ` · ${i.subject}` : ''}` })));
  const setSettings = (p: Partial<PrintSettings>) => updateBatch(id, { settings: { ...batch.settings, ...p } });
  const setInclude = (p: Partial<BatchInclude>) => updateBatch(id, { include: { ...batch.include, ...p } });
  const counts = sections.map((s) => ({ key: s.key, title: s.title, items: s.items.length, pages: pagesBySection.get(s.key)?.length ?? 0 }));
  const allPages = sections.flatMap((s) => pagesBySection.get(s.key) ?? []);
  const doExport = (fmtType: ExportFormat, which: 'section' | 'all') =>
    run(async () => {
      const list = which === 'all' ? allPages : pages;
      setProgress({ done: 0, total: list.length });
      try {
        await exportPages(list, fmtType, batch.settings.resolution, `${batch.code}-${which === 'all' ? 'print-package' : active}`, (d, tt) => setProgress({ done: d, total: tt }));
      } finally {
        setProgress(null);
      }
    }, t('common.exported'));

  return (
    <div>
      <PageHeader
        crumbs={[{ label: t('nav.print'), href: '#/print' }, { label: batch.code }]}
        title={
          <span className="row wrap">
            {t('print.batch')} #{batch.code}
            <StatusBadge group="batch" value={batch.status} />
          </span>
        }
        sub={`${batch.name} · ${fmt.dateTime(batch.createdAt)} · ${batch.createdBy}`}
        actions={
          <>
            <a className="btn" href={`#/print/${id}/assembly`}>
              <ClipboardList /> {t('assembly.open')}
            </a>
            {can('print') && batch.status !== 'printed' && batch.status !== 'completed' && (
              <button className="btn primary" disabled={!batch.projectIds.length} onClick={() => run(() => markBatchPrinted(id), t('print.markedPrinted'))}>
                <CheckCircle2 /> {t('print.markPrinted')}
              </button>
            )}
            {can('print') && batch.status === 'printed' && (
              <button className="btn primary" onClick={() => run(() => updateBatch(id, { status: 'completed' }), t('common.saved'))}>
                <CheckCircle2 /> {t('print.markCompleted')}
              </button>
            )}
            {can('print') && (
              <button
                className="btn danger icon"
                title={t('common.delete')}
                onClick={async () => {
                  if (await confirm({ title: t('print.deleteTitle', { code: batch.code }), body: t('print.deleteBody'), danger: true, confirm: t('common.delete') })) {
                    await run(() => deleteBatch(id), t('common.deleted'));
                    navigate('/print');
                  }
                }}
              >
                <Trash2 />
              </button>
            )}
          </>
        }
      />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
        <div className="col gap-16" style={{ minWidth: 0 }}>
          <Card title={t('print.contains')}>
            <div className="row wrap gap-16">
              {counts.map((c) => (
                <div key={c.key} className="col gap-4" style={{ minWidth: 110 }}>
                  <span style={{ fontSize: 26, fontWeight: 600 }}>{c.items}</span>
                  <span className="muted small">
                    {c.title} · {t('print.pages', { count: c.pages })}
                  </span>
                </div>
              ))}
              {!counts.length && <span className="muted">{t('print.noContent')}</span>}
            </div>
            <div className="row wrap mt-16">
              {can('print') && (
                <>
                  <button className="btn accent" disabled={!allPages.length || !!progress} onClick={() => doExport('pdf', 'all')}>
                    <Download /> {t('print.downloadPackage', { count: allPages.length })}
                  </button>
                  {(['png', 'jpg', 'svg'] as ExportFormat[]).map((f) => (
                    <button key={f} className="btn" disabled={!allPages.length || !!progress} onClick={() => doExport(f, 'all')}>
                      {f.toUpperCase()} (zip)
                    </button>
                  ))}
                </>
              )}
            </div>
            {progress && (
              <div className="mt-8">
                <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
                <div className="muted tiny mt-8">
                  {t('print.rendering')} {progress.done}/{progress.total}
                </div>
              </div>
            )}
          </Card>
          <Card
            title={t('print.preview')}
            actions={
              can('print') && (
                <>
                  <button className="btn sm primary" disabled={!pages.length} onClick={() => run(() => printPages(pages))}>
                    <Printer /> {t('print.printSection')}
                  </button>
                  <button className="btn sm" disabled={!pages.length || !!progress} onClick={() => doExport('pdf', 'section')}>
                    PDF
                  </button>
                </>
              )
            }
          >
            <Tabs tabs={sections.map((s) => ({ key: s.key, label: s.title, count: pagesBySection.get(s.key)?.length }))} value={active} onChange={setSection} />
            {pages.length ? (
              <div className="print-sheet-preview">
                {pages.slice(0, 24).map((p, i) => (
                  <div key={i}>
                    <PageSVG page={p} uid={`pv${i}`} className="sheet" style={{ width: Math.min(300, (p.w / Math.max(p.w, p.h)) * 300), height: 'auto' }} />
                    <div className="sheet-label">
                      {i + 1} / {pages.length} · {Math.round(p.w)}×{Math.round(p.h)} mm · {p.placements.length} {t('print.perSheet')}
                    </div>
                  </div>
                ))}
                {pages.length > 24 && <div className="muted">+{pages.length - 24}</div>}
              </div>
            ) : (
              <div className="muted">{t('print.noContent')}</div>
            )}
          </Card>
          <Card title={t('nav.projects')}>
            <div className="table-wrap">
              <table className="table compact">
                <tbody>
                  {(bundles ?? []).map((b) => (
                    <tr key={b.project.id}>
                      <td>
                        <a href={`#/projects/${b.project.id}`}>{b.project.code}</a>
                      </td>
                      <td>{b.recipient ? `${b.recipient.firstName} ${b.recipient.lastName}` : '—'}</td>
                      <td className="small">{b.project.name.split(' — ')[0]}</td>
                      <td>
                        <StatusBadge group="stage" value={b.project.stage} />
                      </td>
                      <td>{b.issues.length ? <span className="badge warning">{t('print.issues', { count: b.issues.length })}</span> : <span className="badge success">OK</span>}</td>
                      <td className="actions-cell">
                        {can('print') && (
                          <button className="btn icon xs ghost" title={t('print.removeFromBatch')} onClick={() => updateBatch(id, { projectIds: batch.projectIds.filter((x) => x !== b.project.id) })}>
                            <X />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="col gap-16">
          <Card title={t('print.validation')}>
            <ReadyBanner issues={allIssues} />
            <div className="mt-8" style={{ maxHeight: 260, overflow: 'auto' }}>
              <IssueList issues={allIssues} max={12} />
            </div>
          </Card>
          <Card title={t('print.include')}>
            <div className="col gap-4">
              {(['letters', 'documents', 'envelopes', 'labels', 'stamps', 'packingSlips'] as (keyof BatchInclude)[]).map((k) => (
                <Toggle key={k} checked={batch.include[k]} onChange={(v) => setInclude({ [k]: v })} label={t(`print.inc.${k}`)} />
              ))}
            </div>
          </Card>
          <Card title={t('print.settings')}>
            <PrintSettingsForm s={batch.settings} onChange={setSettings} />
          </Card>
          <Card title={t('print.history')}>
            <dl className="kv">
              <dt>{t('field.status')}</dt>
              <dd>{tEnum('batch', batch.status)}</dd>
              <dt>{t('common.created')}</dt>
              <dd>{fmt.dateTime(batch.createdAt)}</dd>
              <dt>{t('print.printedAt')}</dt>
              <dd>{fmt.dateTime(batch.printedAt) || '—'}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
