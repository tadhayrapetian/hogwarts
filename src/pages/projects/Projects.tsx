import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, FolderKanban, LayoutGrid, List, Printer, Upload, Wand2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { PROJECT_STAGES, TEMPLATE_CATEGORIES, type Project, type ProjectStage } from '../../core/types';
import { normalizeText, readFileAsText } from '../../core/util';
import { db } from '../../db/db';
import { archiveProjects, createBatch, importProjectJSON, setProjectStage } from '../../db/services';
import { useFmt, useProjectCtx } from '../../app/data';
import { useAction } from '../../app/feedback';
import { navigate } from '../../app/router';
import { useSession } from '../../app/session';
import { useUI } from '../../app/ui';
import { useI18n } from '../../i18n';
import { LayoutView } from '../../ui/art';
import { Check, DataTable, EmptyState, PageHeader, SearchInput, StatusBadge } from '../../ui/kit';
import { ExportMenu } from '../shared/ExportMenu';

function ProjectCard({ p, recipientName, selected, onSelect }: { p: Project; recipientName: string; selected: boolean; onSelect: (v: boolean) => void }) {
  const ctx = useProjectCtx(p, `pc${p.id.slice(0, 5)}`);
  const { t } = useI18n();
  return (
    <div className={`thumb-card ${selected ? 'selected' : ''}`} onClick={() => navigate(`/projects/${p.id}`)}>
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }} onClick={(e) => e.stopPropagation()}>
        <Check checked={selected} onChange={onSelect} />
      </div>
      <div className="art" style={{ aspectRatio: '5 / 4' }}>
        {ctx && <LayoutView layout={p.letter} ctx={ctx} height="100%" className="paper-shadow" />}
      </div>
      <div className="title truncate">{p.name.split(' — ')[0]}</div>
      <div className="meta truncate">
        {recipientName} · {p.code}
      </div>
      <div className="row between">
        <StatusBadge group="stage" value={p.stage} />
        <span className="muted tiny">{t(`tplcat.${p.category}`)}</span>
      </div>
    </div>
  );
}

export function Projects() {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const ui = useUI();
  const run = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState(false);
  const [view, setView] = useState<'grid' | 'table'>('table');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const data = useLiveQuery(async () => ({ projects: await db.projects.toArray(), recipients: await db.recipients.toArray(), orders: await db.orders.toArray() }), []);
  const rows = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    return data.projects
      .filter((p) => (archived ? p.status === 'archived' : p.status === 'active'))
      .filter((p) => !stage || p.stage === stage)
      .filter((p) => !category || p.category === category)
      .filter((p) => {
        if (!n) return true;
        const r = data.recipients.find((x) => x.id === p.recipientId);
        const o = data.orders.find((x) => x.id === p.orderId);
        return normalizeText(`${p.code} ${p.name} ${r?.firstName} ${r?.lastName} ${r?.code} ${o?.number}`).includes(n);
      });
  }, [data, q, stage, category, archived]);
  if (!data) return null;
  const rName = (id?: string) => {
    const r = data.recipients.find((x) => x.id === id);
    return r ? `${r.firstName} ${r.lastName}` : '—';
  };
  const sel = Array.from(selected);
  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.operations')}
        title={t('nav.projects')}
        sub={t('project.sub', { count: rows.length })}
        actions={
          <>
            <div className="btn-group">
              <button className={`btn icon ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} aria-label={t('common.table')}>
                <List />
              </button>
              <button className={`btn icon ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')} aria-label={t('common.grid')}>
                <LayoutGrid />
              </button>
            </div>
            <ExportMenu
              name={t('nav.projects')}
              build={() => ({
                head: [t('project.code'), t('field.name'), t('nav.recipients'), t('project.stage'), t('common.created'), t('order.dueDate')],
                rows: rows.map((p) => [p.code, p.name, rName(p.recipientId), tEnum('stage', p.stage), p.createdAt.slice(0, 10), p.dueDate ?? '']),
              })}
            />
            {can('projects.edit') && (
              <>
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  <Upload /> {t('common.import')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const p = await run(async () => importProjectJSON(JSON.parse(await readFileAsText(f))), t('project.imported'));
                    if (p) navigate(`/projects/${p.id}`);
                  }}
                />
                <button className="btn accent" onClick={() => ui.openPackageWizard()}>
                  <Wand2 /> {t('package.create')}
                </button>
              </>
            )}
          </>
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('project.search')} />
        <select className="select" style={{ width: 180 }} value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t('project.stage')}>
          <option value="">{t('project.stage')}: {t('common.all')}</option>
          {PROJECT_STAGES.map((s) => (
            <option key={s} value={s}>
              {tEnum('stage', s)}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 180 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('template.category')}>
          <option value="">{t('template.category')}: {t('common.all')}</option>
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`tplcat.${c}`)}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> {t('common.showArchived')}
        </label>
      </div>
      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{t('common.selected', { count: selected.size })}</b>
          {can('production.edit') && (
            <select className="select sm" style={{ width: 200 }} value="" onChange={(e) => e.target.value && run(() => setProjectStage(sel, e.target.value as ProjectStage), t('common.saved'))}>
              <option value="">{t('project.moveTo')}…</option>
              {PROJECT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {tEnum('stage', s)}
                </option>
              ))}
            </select>
          )}
          {can('print') && (
            <button
              className="btn sm primary"
              onClick={async () => {
                const b = await run(() => createBatch(sel), t('print.batchCreated'));
                if (b) navigate(`/print/${b.id}`);
              }}
            >
              <Printer /> {t('print.newBatchFrom', { count: sel.length })}
            </button>
          )}
          {can('projects.edit') && (
            <button className="btn sm" onClick={() => run(() => archiveProjects(sel, !archived), t('common.saved'))}>
              <Archive /> {archived ? t('common.restore') : t('common.archive')}
            </button>
          )}
          <span className="grow" />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      )}
      {!rows.length ? (
        <EmptyState icon={<FolderKanban />} title={t('project.empty')} text={t('project.emptyHint')} action={can('projects.edit') && <button className="btn accent" onClick={() => ui.openPackageWizard()}><Wand2 /> {t('package.create')}</button>} />
      ) : view === 'grid' ? (
        <div className="thumb-grid lg">
          {rows
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 120)
            .map((p) => (
              <ProjectCard
                key={p.id}
                p={p}
                recipientName={rName(p.recipientId)}
                selected={selected.has(p.id)}
                onSelect={(v) => {
                  const n = new Set(selected);
                  if (v) n.add(p.id);
                  else n.delete(p.id);
                  setSelected(n);
                }}
              />
            ))}
        </div>
      ) : (
        <DataTable
          rows={rows}
          rowKey={(p) => p.id}
          selected={selected}
          onSelect={setSelected}
          onRowClick={(p) => navigate(`/projects/${p.id}`)}
          initialSort={{ key: 'created', dir: 'desc' }}
          columns={[
            { key: 'code', header: t('project.code'), render: (p) => <span className="mono">{p.code}</span>, sort: (p) => p.code },
            { key: 'name', header: t('field.name'), render: (p) => <b>{p.name.split(' — ')[0]}</b>, sort: (p) => p.name },
            { key: 'rec', header: t('nav.recipients'), render: (p) => rName(p.recipientId), sort: (p) => rName(p.recipientId) },
            { key: 'order', header: t('order.number'), render: (p) => <span className="mono small">{data.orders.find((o) => o.id === p.orderId)?.number ?? '—'}</span> },
            { key: 'cat', header: t('template.category'), render: (p) => t(`tplcat.${p.category}`) },
            { key: 'stage', header: t('project.stage'), render: (p) => <StatusBadge group="stage" value={p.stage} />, sort: (p) => PROJECT_STAGES.indexOf(p.stage) },
            { key: 'due', header: t('order.dueDate'), render: (p) => fmt.date(p.dueDate) || '—', sort: (p) => p.dueDate ?? '' },
            { key: 'created', header: t('common.created'), render: (p) => fmt.date(p.createdAt), sort: (p) => p.createdAt },
          ]}
        />
      )}
    </div>
  );
}
