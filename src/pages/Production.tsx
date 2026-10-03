import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ClipboardList, Factory, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PROJECT_STAGES, type Project, type ProjectStage } from '../core/types';
import { normalizeText, todayISO } from '../core/util';
import { db } from '../db/db';
import { createBatch, setProjectStage } from '../db/services';
import { useFmt } from '../app/data';
import { useAction } from '../app/feedback';
import { navigate } from '../app/router';
import { useSession } from '../app/session';
import { useI18n } from '../i18n';
import { Badge, Check, EmptyState, PageHeader, SearchInput } from '../ui/kit';

export function Production() {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const run = useAction();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const data = useLiveQuery(async () => ({
    projects: await db.projects.where('status').equals('active').toArray(),
    recipients: await db.recipients.toArray(),
    shipments: await db.shipments.toArray(),
  }), []);
  const projects = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    const shipped = new Set(data.shipments.filter((s) => !['preparing', 'label_created'].includes(s.status)).map((s) => s.projectId));
    return data.projects
      .filter((p) => !(p.stage === 'ready' && shipped.has(p.id)))
      .filter((p) => {
        if (!n) return true;
        const r = data.recipients.find((x) => x.id === p.recipientId);
        return normalizeText(`${p.code} ${p.name} ${r?.firstName} ${r?.lastName}`).includes(n);
      });
  }, [data, q]);
  if (!data) return null;
  const today = todayISO();
  const editable = can('production.edit');
  const move = (ids: string[], stage: ProjectStage) => run(() => setProjectStage(ids, stage), t('project.movedTo', { stage: tEnum('stage', stage) }));
  const sel = Array.from(selected);
  const toggle = (id: string, v: boolean) => {
    const n = new Set(selected);
    if (v) n.add(id);
    else n.delete(id);
    setSelected(n);
  };
  const card = (p: Project) => {
    const r = data.recipients.find((x) => x.id === p.recipientId);
    const idx = PROJECT_STAGES.indexOf(p.stage);
    const next = PROJECT_STAGES[idx + 1];
    const overdue = p.dueDate && p.dueDate < today;
    return (
      <div
        key={p.id}
        className={`kcard ${selected.has(p.id) ? 'selected' : ''} ${dragging === p.id ? 'dragging' : ''}`}
        draggable={editable}
        onDragStart={(e) => {
          setDragging(p.id);
          e.dataTransfer.setData('text/plain', p.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDragging(null)}
        onClick={() => navigate(`/projects/${p.id}`)}
      >
        <div className="row">
          <span onClick={(e) => e.stopPropagation()}>
            <Check checked={selected.has(p.id)} onChange={(v) => toggle(p.id, v)} />
          </span>
          <span className="t grow truncate">{r ? `${r.firstName} ${r.lastName}` : p.name}</span>
        </div>
        <div className="muted truncate">{p.name.split(' — ')[0]}</div>
        <div className="row between">
          <span className="mono tiny muted">{p.code}</span>
          {p.dueDate && <Badge tone={overdue ? 'danger' : 'neutral'}>{fmt.date(p.dueDate)}</Badge>}
        </div>
        {editable && next && (
          <button className="btn xs" onClick={(e) => (e.stopPropagation(), move([p.id], next))}>
            {tEnum('stage', next)} <ArrowRight />
          </button>
        )}
      </div>
    );
  };
  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.operations')}
        title={t('nav.production')}
        sub={t('production.sub', { count: projects.length })}
        actions={
          <a className="btn" href="#/print">
            <Printer /> {t('nav.print')}
          </a>
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('project.search')} />
        <span className="muted small">{t('production.dragHint')}</span>
      </div>
      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{t('common.selected', { count: selected.size })}</b>
          {editable &&
            PROJECT_STAGES.map((s) => (
              <button key={s} className="btn xs" onClick={() => move(sel, s).then(() => setSelected(new Set()))}>
                → {tEnum('stage', s)}
              </button>
            ))}
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
          <a className="btn sm" href={`#/assembly/${sel[0]}`}>
            <ClipboardList /> {t('assembly.open')}
          </a>
          <span className="grow" />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      )}
      {!data.projects.length ? (
        <EmptyState icon={<Factory />} title={t('production.empty')} />
      ) : (
        <div className="kanban">
          {PROJECT_STAGES.map((stage) => {
            const items = projects.filter((p) => p.stage === stage).sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
            return (
              <div
                key={stage}
                className={`kanban-col ${over === stage ? 'drop' : ''}`}
                onDragOver={(e) => {
                  if (!editable) return;
                  e.preventDefault();
                  setOver(stage);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData('text/plain');
                  const ids = selected.has(id) ? sel : [id];
                  if (id) move(ids, stage);
                }}
              >
                <header>
                  <span>{tEnum('stage', stage)}</span>
                  <span className="n">{items.length}</span>
                </header>
                <div className="cards">
                  {items.slice(0, 60).map(card)}
                  {items.length > 60 && <div className="muted small center">+{items.length - 60}</div>}
                  {items.length > 0 && editable && (
                    <button className="btn xs ghost" onClick={() => setSelected(new Set([...selected, ...items.map((i) => i.id)]))}>
                      {t('production.selectColumn')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
