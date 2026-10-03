import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Droplets,
  FileInput,
  Flame,
  FoldHorizontal,
  FoldVertical,
  Keyboard,
  Mail,
  Package,
  PackageCheck,
  PartyPopper,
  Printer,
  RotateCcw,
  Scissors,
  Stamp,
  Truck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PROJECT_STAGES, type AppSettings, type BatchInclude, type PrintBatch, type PrintSettings, type Project, type ProjectStage } from '../../core/types';
import { db } from '../../db/db';
import { createShipment, setAssemblyStep, setProjectStage } from '../../db/services';
import { useSettings } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate } from '../../app/router';
import { useSession } from '../../app/session';
import { useI18n, type TFn } from '../../i18n';
import { printPages } from '../../render/export';
import { imposeSection } from '../../render/imposition';
import { PostmarkView, SealView, StampView } from '../../ui/art';
import { Badge, Card, EmptyState, PageHeader, Progress, StatusBadge } from '../../ui/kit';
import { buildSections, contentsList, useBundles, type ProjectBundle } from './bundle';

interface Step {
  key: string;
  icon: ReactNode;
  title: string;
  detail: string;
  art?: ReactNode;
}

const rank = (s: ProjectStage) => PROJECT_STAGES.indexOf(s);

/** Print settings that applied to this project: its batch first, then project overrides over the workspace defaults. */
function printSettingsFor(p: Project, batch: PrintBatch | null | undefined, settings: AppSettings): PrintSettings {
  if (batch) return batch.settings;
  return { ...settings.print, ...p.print };
}

function letterName(p: Project, t: TFn): string {
  return p.name.split(' — ')[0] || t('preview.letter');
}

function deriveSteps(b: ProjectBundle, ps: PrintSettings, settings: AppSettings, t: TFn): Step[] {
  const p = b.project;
  const lib = b.ctx.lib;
  const mode = ps.envelopeMode;
  const size = p.envelope.size === 'custom' ? `${Math.round(p.envelope.front.w)}×${Math.round(p.envelope.front.h)} mm` : p.envelope.size;
  const paper = ps.paper === 'custom' ? `${ps.paperW}×${ps.paperH} mm` : ps.paper;
  const printed = [letterName(p, t), ...p.documents.map((d) => d.name)];
  const inserts = [...printed];
  for (const it of b.order?.items ?? []) if (!/package|letter/i.test(it.name)) inserts.push(`${it.qty}× ${it.name}`);
  const front = p.envelope.front.elements.filter((e) => !e.hidden);
  const steps: Step[] = [
    { key: 'print', icon: <Printer />, title: t('assembly.step.print'), detail: t('assembly.step.printDetail', { items: printed.join(' · ') }) },
    {
      key: 'printEnv',
      icon: <Mail />,
      title: t('assembly.step.printEnv'),
      detail:
        mode === 'dieline'
          ? t('assembly.step.printEnvDieline', { size, paper })
          : [t('assembly.step.printEnvDirect', { size }), p.envelope.back.elements.length ? t('assembly.step.printEnvBack') : ''].filter(Boolean).join(' '),
    },
  ];
  if (mode === 'dieline') {
    steps.push(
      { key: 'cut', icon: <Scissors />, title: t('assembly.step.cut'), detail: t('assembly.step.cutDetail') },
      { key: 'foldEnv', icon: <FoldHorizontal />, title: t('assembly.step.foldEnv'), detail: t('assembly.step.foldEnvDetail') },
      { key: 'glue', icon: <Droplets />, title: t('assembly.step.glue'), detail: t('assembly.step.glueDetail') },
    );
  }
  if (p.fold && p.fold !== 'none')
    steps.push({ key: 'fold', icon: <FoldVertical />, title: t('assembly.step.fold'), detail: t(p.fold === 'half' ? 'assembly.step.foldHalf' : 'assembly.step.foldTrifold') });
  steps.push({ key: 'insert', icon: <FileInput />, title: t('assembly.step.insert'), detail: t('assembly.step.insertDetail', { items: inserts.join(' · ') }) });
  if (p.stampId) {
    const st = lib.stamps.get(p.stampId);
    const onEnvelope = front.some((e) => e.type === 'stamp');
    steps.push({
      key: 'stamp',
      icon: <Stamp />,
      title: t('assembly.step.stamp'),
      detail: t(onEnvelope ? 'assembly.step.stampPrinted' : 'assembly.step.stampSticker', { name: st?.name ?? '' }),
      art: st && <StampView stamp={st} height={64} asset={st.assetId ? lib.assets.get(st.assetId) : undefined} />,
    });
  }
  if (p.postmarkId) {
    const pm = lib.postmarks.get(p.postmarkId);
    const onEnvelope = front.some((e) => e.type === 'postmark');
    steps.push({
      key: 'postmark',
      icon: <CircleDot />,
      title: t('assembly.step.postmark'),
      detail: t(onEnvelope ? 'assembly.step.postmarkPrinted' : 'assembly.step.postmarkHand', { name: pm?.name ?? '' }),
      art: pm && <PostmarkView pm={pm} height={64} date={p.postmarkDate} />,
    });
  }
  if (p.sealId) {
    const se = lib.seals.get(p.sealId);
    steps.push({ key: 'seal', icon: <Flame />, title: t('assembly.step.seal'), detail: t('assembly.step.sealDetail', { name: se?.name ?? '' }), art: se && <SealView seal={se} size={60} /> });
  }
  steps.push({ key: 'pack', icon: <Package />, title: t('assembly.step.pack'), detail: t('assembly.step.packDetail') });
  const carrierId = b.shipment?.carrierId || p.shipping.carrierId || settings.mail.defaultCarrierId;
  const carrier = settings.carriers.find((c) => c.id === carrierId);
  const service = b.shipment?.service || p.shipping.service;
  const shipDetail = [
    carrier ? t('assembly.step.shipDetail', { carrier: [carrier.name, service].filter(Boolean).join(' · ') }) : t('assembly.step.shipNoCarrier'),
    b.shipment?.trackingNumber ? t('assembly.step.shipTracking', { tracking: b.shipment.trackingNumber }) : '',
  ]
    .filter(Boolean)
    .join(' ');
  steps.push({ key: 'ship', icon: <Truck />, title: t('assembly.step.ship'), detail: shipDetail });
  return steps;
}

// ───────────── Picker (no batch / project chosen) ─────────────

function AssemblyPicker() {
  const { t } = useI18n();
  const data = useLiveQuery(
    async () => ({
      projects: await db.projects.where('status').equals('active').toArray(),
      batches: await db.batches.toArray(),
      recipients: await db.recipients.toArray(),
    }),
    [],
  );
  if (!data) return null;
  const rName = (id?: string) => {
    const r = data.recipients.find((x) => x.id === id);
    return r ? `${r.firstName} ${r.lastName}` : '';
  };
  const projects = data.projects.filter((p) => rank(p.stage) >= rank('generated') && rank(p.stage) < rank('packed')).sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const batches = data.batches.filter((b) => b.status !== 'completed' && b.projectIds.length).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div>
      <PageHeader eyebrow={t('navgroup.operations')} title={t('assembly.title')} sub={t('assembly.pickSub')} />
      <div className="grid grid-2">
        <Card title={t('nav.print')}>
          <div className="list">
            {batches.map((b) => (
              <a key={b.id} className="list-item" href={`#/print/${b.id}/assembly`}>
                <ClipboardList size={18} />
                <div className="grow">
                  <b>{b.name}</b>
                  <div className="muted small">
                    <span className="mono">{b.code}</span> · {t('assembly.packagesCount', { count: b.projectIds.length })}
                  </div>
                </div>
                <StatusBadge group="batch" value={b.status} />
              </a>
            ))}
            {!batches.length && <div className="muted small">{t('assembly.noProjects')}</div>}
          </div>
        </Card>
        <Card title={t('nav.projects')}>
          <div className="list">
            {projects.map((p) => (
              <a key={p.id} className="list-item" href={`#/assembly/${p.id}`}>
                <div className="grow">
                  <b>{rName(p.recipientId) || p.name}</b>
                  <div className="muted small truncate">
                    <span className="mono">{p.code}</span> · {letterName(p, t)}
                  </div>
                </div>
                <StatusBadge group="stage" value={p.stage} />
              </a>
            ))}
            {!projects.length && <div className="muted small">{t('assembly.noProjects')}</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ───────────── Assembly desk ─────────────

function AssemblyDesk({ batchId, projectId }: { batchId?: string; projectId?: string }) {
  const { t, tEnum } = useI18n();
  const settings = useSettings();
  const { can } = useSession();
  const run = useAction();
  const { toast, confirm } = useFeedback();
  const batch = useLiveQuery(async () => (batchId ? (await db.batches.get(batchId)) ?? null : null), [batchId]);
  const ids = useMemo(() => (batchId ? batch?.projectIds : projectId ? [projectId] : undefined), [batchId, batch, projectId]);
  const bundles = useBundles(ids);
  const ownBatchId = !batchId ? bundles?.[0]?.project.batchId : undefined;
  const ownBatch = useLiveQuery(async () => (ownBatchId ? (await db.batches.get(ownBatchId)) ?? null : null), [ownBatchId]);
  const contextBatch = batchId ? batch : ownBatch;

  const [activeId, setActiveId] = useState<string | undefined>();
  const [cursor, setCursor] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const keyHandler = useRef<(e: KeyboardEvent) => void>();

  const list = useMemo(() => bundles ?? [], [bundles]);
  const stepsById = useMemo(() => {
    const m = new Map<string, Step[]>();
    for (const b of list) m.set(b.project.id, deriveSteps(b, printSettingsFor(b.project, contextBatch, settings), settings, t));
    return m;
  }, [list, contextBatch, settings, t]);

  useEffect(() => {
    if (!list.length || (activeId && list.some((b) => b.project.id === activeId))) return;
    const first = list.find((b) => (stepsById.get(b.project.id) ?? []).some((s) => !b.project.assembly?.[s.key])) ?? list[0];
    setActiveId(first.project.id);
  }, [list, activeId, stepsById]);

  useEffect(() => {
    setPending((m) => {
      const keys = Object.keys(m);
      if (!keys.length) return m;
      const n = { ...m };
      for (const k of keys) {
        const [pid, step] = k.split('|');
        const b = list.find((x) => x.project.id === pid);
        if (!b || !!b.project.assembly?.[step] === m[k]) delete n[k];
      }
      return Object.keys(n).length === keys.length ? m : n;
    });
  }, [list]);

  const isDone = (p: Project, key: string) => pending[`${p.id}|${key}`] ?? !!p.assembly?.[key];
  const writeStep = (pid: string, key: string, done: boolean) => {
    const k = `${pid}|${key}`;
    setPending((m) => ({ ...m, [k]: done }));
    queue.current = queue.current
      .then(() => setAssemblyStep(pid, key, done))
      .catch((e) => {
        console.error(e);
        toast(t('err.generic'), 'error');
        setPending((m) => {
          const n = { ...m };
          delete n[k];
          return n;
        });
      });
  };

  const active = list.find((b) => b.project.id === activeId) ?? list[0];
  const steps = active ? stepsById.get(active.project.id) ?? [] : [];
  const firstUndone = active ? steps.findIndex((s) => !isDone(active.project, s.key)) : -1;
  const current = active ? Math.max(0, Math.min(cursor[active.project.id] ?? (firstUndone >= 0 ? firstUndone : steps.length - 1), steps.length - 1)) : 0;
  const editable = can('production.edit');
  const progressOf = (b: ProjectBundle) => {
    const ss = stepsById.get(b.project.id) ?? [];
    const done = ss.filter((s) => isDone(b.project, s.key)).length;
    return { done, total: ss.length, complete: ss.length > 0 && done === ss.length };
  };

  useEffect(() => {
    const el = stepRefs.current[current];
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('assembly-step') && document.activeElement !== el) el.focus({ preventScroll: true });
  }, [current, activeId]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => keyHandler.current?.(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const setCur = (pid: string, idx: number) => setCursor((c) => (c[pid] === idx ? c : { ...c, [pid]: idx }));
  const toggle = (idx: number) => {
    if (!active || !editable) return;
    const step = steps[idx];
    if (!step) return;
    const pid = active.project.id;
    const done = !isDone(active.project, step.key);
    writeStep(pid, step.key, done);
    if (done) {
      const after = steps.findIndex((s, i) => i > idx && !isDone(active.project, s.key));
      const before = steps.findIndex((s, i) => i < idx && !isDone(active.project, s.key));
      setCur(pid, after >= 0 ? after : before >= 0 ? before : idx);
    } else setCur(pid, idx);
  };
  const move = (delta: number) => active && setCur(active.project.id, Math.max(0, Math.min(steps.length - 1, current + delta)));
  const switchProject = (delta: number) => {
    if (!active) return;
    const i = list.indexOf(active);
    const next = list[Math.max(0, Math.min(list.length - 1, i + delta))];
    if (next && next !== active) setActiveId(next.project.id);
  };

  keyHandler.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable)) return;
    if (document.querySelector('.overlay, .drawer-overlay')) return;
    if (!active) return;
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        toggle(current);
        break;
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'ArrowRight':
        if (list.length > 1) {
          e.preventDefault();
          switchProject(1);
        }
        break;
      case 'ArrowLeft':
        if (list.length > 1) {
          e.preventDefault();
          switchProject(-1);
        }
        break;
    }
  };

  if (batchId && batch === undefined) return null;
  if (batchId && batch === null) return <EmptyState icon={<Printer />} title={t('print.notFound')} action={<a className="btn" href="#/print">{t('common.back')}</a>} />;
  if (!bundles) return null;
  if (!active) {
    return projectId ? (
      <EmptyState icon={<ClipboardList />} title={t('project.notFound')} action={<a className="btn" href="#/projects">{t('common.back')}</a>} />
    ) : (
      <EmptyState icon={<ClipboardList />} title={t('assembly.noProjects')} action={batch ? <a className="btn" href={`#/print/${batch.id}`}>{t('common.back')}</a> : undefined} />
    );
  }

  const p = active.project;
  const r = active.recipient;
  const name = r ? `${r.firstName} ${r.lastName}` : p.name;
  const prog = progressOf(active);
  const ps = printSettingsFor(p, contextBatch, settings);
  const isBatch = !!batchId && list.length > 0;
  const backHref = batch ? `#/print/${batch.id}` : `#/projects/${p.id}`;
  const crumbs = batch
    ? [{ label: t('nav.print'), href: '#/print' }, { label: batch.code, href: `#/print/${batch.id}` }, { label: t('assembly.title') }]
    : [{ label: t('nav.projects'), href: '#/projects' }, { label: p.code, href: `#/projects/${p.id}` }, { label: t('assembly.title') }];
  const totals = list.reduce(
    (acc, b) => {
      const x = progressOf(b);
      return { done: acc.done + x.done, total: acc.total + x.total, complete: acc.complete + (x.complete ? 1 : 0) };
    },
    { done: 0, total: 0, complete: 0 },
  );
  const currentStep = steps[current];
  const pendingForAll = currentStep ? list.filter((b) => (stepsById.get(b.project.id) ?? []).some((s) => s.key === currentStep.key) && !isDone(b.project, currentStep.key)) : [];
  const assembledToPack = list.filter((b) => progressOf(b).complete && rank(b.project.stage) < rank('packed')).map((b) => b.project.id);
  const contents = contentsList(active, active.ctx.lib, t);
  const notes = [
    { label: t('field.deliveryInstructions'), text: r?.deliveryInstructions },
    { label: t('field.mailingNotes'), text: r?.mailingNotes },
    { label: t('assembly.shippingNotes'), text: p.shipping.notes },
    { label: t('assembly.orderNotes'), text: active.order?.notes },
  ].filter((n) => n.text?.trim());

  const completeForAll = () => {
    if (!currentStep) return;
    for (const b of pendingForAll) writeStep(b.project.id, currentStep.key, true);
    toast(t('assembly.completedAll', { count: pendingForAll.length, step: currentStep.title }));
    const after = steps.findIndex((s, i) => i > current && !isDone(p, s.key));
    if (after >= 0) setCur(p.id, after);
  };
  const resetSteps = async () => {
    if (!(await confirm({ title: t('assembly.resetTitle'), body: t('assembly.resetBody', { name }), confirm: t('assembly.reset'), danger: true }))) return;
    for (const s of steps) if (isDone(p, s.key)) writeStep(p.id, s.key, false);
    setCur(p.id, 0);
  };
  const createShip = async () => {
    const s = await run(() => createShipment({ projectId: p.id }), t('shipment.created'));
    if (s) navigate(`/shipments?id=${s.id}`);
  };
  const printSlip = () => {
    const include: BatchInclude = { letters: false, envelopes: false, labels: false, stamps: false, documents: false, packingSlips: true };
    const pages = buildSections([active], ps, include, settings, t).flatMap((s) => imposeSection(s, ps));
    return run(() => printPages(pages));
  };
  const stageTo = (stage: ProjectStage, ids: string[]) => run(() => setProjectStage(ids, stage), t('project.movedTo', { stage: tEnum('stage', stage) }));

  return (
    <div>
      <PageHeader
        crumbs={crumbs}
        eyebrow={t('assembly.sub')}
        title={batch ? `${t('assembly.title')} · ${batch.name}` : `${t('assembly.title')} · ${name}`}
        actions={
          <>
            <a className="btn" href={backHref}>
              <ArrowLeft /> {t('common.back')}
            </a>
            {can('print') && (
              <button className="btn" onClick={printSlip}>
                <Printer /> {t('assembly.printSlip')}
              </button>
            )}
          </>
        }
      />
      <div className="grid" style={{ gridTemplateColumns: isBatch ? '260px minmax(0, 1fr) 320px' : 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        {isBatch && (
          <div className="col gap-16">
            <Card title={t('assembly.packages')} sub={t('assembly.batchProgress', { done: totals.complete, total: list.length })}>
              <Progress value={(totals.done / Math.max(1, totals.total)) * 100} />
              <div className="muted tiny mt-8">{t('assembly.progress', { done: totals.done, total: totals.total })}</div>
              <div className="col gap-4 mt-16" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {list.map((b) => {
                  const x = progressOf(b);
                  const on = b.project.id === p.id;
                  const rn = b.recipient ? `${b.recipient.firstName} ${b.recipient.lastName}` : b.project.name;
                  return (
                    <button
                      key={b.project.id}
                      type="button"
                      onClick={() => setActiveId(b.project.id)}
                      aria-current={on}
                      style={{
                        textAlign: 'left',
                        font: 'inherit',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: '9px 10px',
                        borderRadius: 8,
                        border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                        background: on ? 'var(--primary-soft)' : x.complete ? 'var(--success-soft)' : 'var(--surface)',
                      }}
                    >
                      <div className="row">
                        <b className="grow truncate">{rn}</b>
                        {x.complete && <CheckCircle2 size={16} style={{ color: 'var(--success)', flex: 'none' }} />}
                      </div>
                      <div className="muted tiny mb-8">
                        <span className="mono">{b.project.code}</span> · {x.done}/{x.total}
                      </div>
                      <Progress value={(x.done / Math.max(1, x.total)) * 100} />
                    </button>
                  );
                })}
              </div>
              {editable && assembledToPack.length > 0 && (
                <button className="btn primary mt-16" style={{ width: '100%' }} onClick={() => stageTo('packed', assembledToPack)}>
                  <PackageCheck /> {t('assembly.markAllPacked', { count: assembledToPack.length })}
                </button>
              )}
            </Card>
          </div>
        )}

        <div className="col gap-16" style={{ minWidth: 0 }}>
          <Card>
            <div className="row wrap" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600, lineHeight: 1.15 }}>{name}</div>
                <div className="row wrap mt-8">
                  <a className="mono small" href={`#/projects/${p.id}`}>
                    {p.code}
                  </a>
                  <span className="muted small">{letterName(p, t)}</span>
                  <StatusBadge group="stage" value={p.stage} />
                  <Badge tone="accent">{ps.envelopeMode === 'dieline' ? t('print.envDieline') : t('print.envDirect')}</Badge>
                  <Badge tone="neutral">
                    {t('el.envelope')} {p.envelope.size}
                  </Badge>
                  {p.fold !== 'none' && <Badge tone="neutral">{t(`fold.${p.fold}`)}</Badge>}
                </div>
              </div>
              {isBatch && list.length > 1 && (
                <div className="row">
                  <button className="btn icon" onClick={() => switchProject(-1)} disabled={list.indexOf(active) === 0} title={t('assembly.prev')} aria-label={t('assembly.prev')}>
                    <ChevronLeft />
                  </button>
                  <span className="num muted small">
                    {list.indexOf(active) + 1} / {list.length}
                  </span>
                  <button className="btn icon" onClick={() => switchProject(1)} disabled={list.indexOf(active) === list.length - 1} title={t('assembly.next')} aria-label={t('assembly.next')}>
                    <ChevronRight />
                  </button>
                </div>
              )}
            </div>
            <div className="row mt-16">
              <div className="grow">
                <Progress value={(prog.done / Math.max(1, prog.total)) * 100} />
              </div>
              <b className="num">{t('assembly.progress', { done: prog.done, total: prog.total })}</b>
            </div>
            {editable && (
              <div className="row wrap mt-16">
                {isBatch && list.length > 1 && currentStep && (
                  <button className="btn accent" disabled={!pendingForAll.length} onClick={completeForAll} title={currentStep.title}>
                    <CheckCheck /> {t('assembly.completeAll')} ({pendingForAll.length})
                  </button>
                )}
                <span className="grow" />
                {prog.done > 0 && (
                  <button className="btn ghost sm" onClick={resetSteps}>
                    <RotateCcw /> {t('assembly.reset')}
                  </button>
                )}
              </div>
            )}
          </Card>

          {prog.complete && (
            <div className="card" style={{ background: 'var(--success-soft)', borderColor: 'transparent' }}>
              <div className="card-body">
                <div className="row" style={{ color: 'var(--success)', fontSize: 22, fontWeight: 700 }}>
                  <PartyPopper size={28} /> {t('assembly.allDone')}
                </div>
                <div className="ink2 mt-8">{t('assembly.allDoneText')}</div>
                <div className="row wrap mt-16">
                  {editable && rank(p.stage) < rank('packed') && (
                    <button className="btn lg primary" onClick={() => stageTo('packed', [p.id])}>
                      <PackageCheck /> {t('assembly.markPacked')}
                    </button>
                  )}
                  {editable && p.stage !== 'ready' && (
                    <button className="btn lg" onClick={() => stageTo('ready', [p.id])}>
                      <CheckCircle2 /> {t('assembly.markReady')}
                    </button>
                  )}
                  {active.shipment ? (
                    <a className="btn lg" href={`#/shipments?id=${active.shipment.id}`}>
                      <Truck /> {t('assembly.openShipment')} · <span className="mono">{active.shipment.code}</span>
                    </a>
                  ) : (
                    can('shipping.edit') && (
                      <button className="btn lg accent" onClick={createShip}>
                        <Truck /> {t('shipment.create')}
                      </button>
                    )
                  )}
                  {isBatch && list.length > 1 && list.indexOf(active) < list.length - 1 && (
                    <button className="btn lg ghost" onClick={() => switchProject(1)}>
                      {t('assembly.next')} <ChevronRight />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="col gap-12">
            {steps.map((s, i) => {
              const done = isDone(p, s.key);
              const isCur = i === current;
              return (
                <div
                  key={s.key}
                  ref={(el) => {
                    stepRefs.current[i] = el;
                  }}
                  role="checkbox"
                  aria-checked={done}
                  aria-disabled={!editable}
                  tabIndex={0}
                  className={`assembly-step ${done ? 'done' : ''} ${isCur ? 'current' : ''}`}
                  style={{ padding: 18, gap: 18, cursor: editable ? 'pointer' : 'default', alignItems: 'center' }}
                  onFocus={() => setCur(p.id, i)}
                  onClick={() => {
                    setCur(p.id, i);
                    toggle(i);
                  }}
                >
                  <div className="num" style={{ width: 46, height: 46, fontSize: 22 }}>
                    {done ? <Check size={24} /> : i + 1}
                  </div>
                  <div className="grow">
                    <div className="row" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.25, textDecoration: done ? 'line-through' : undefined, textDecorationColor: 'var(--muted)' }}>
                      <span style={{ color: done ? 'var(--success)' : 'var(--accent)', display: 'inline-flex', flex: 'none' }}>{s.icon}</span>
                      <span>{s.title}</span>
                    </div>
                    <div className="ink2" style={{ fontSize: 15.5, lineHeight: 1.45, marginTop: 6 }}>
                      {s.detail}
                    </div>
                    {isCur && !done && editable && <div className="muted tiny mt-8">{t('assembly.currentHint')}</div>}
                  </div>
                  {s.art && <div style={{ flex: 'none', opacity: done ? 0.6 : 1 }}>{s.art}</div>}
                </div>
              );
            })}
          </div>
          <div className="muted small row">
            <Keyboard size={16} /> {t('assembly.keys')}
          </div>
        </div>

        <div className="col gap-16">
          <Card
            title={t('assembly.contents')}
            actions={
              can('print') && (
                <button className="btn sm" onClick={printSlip} title={t('assembly.printSlip')}>
                  <Printer />
                </button>
              )
            }
          >
            <div className="list">
              {contents.map((c, i) => (
                <div key={i} className="list-item" style={{ fontSize: 15 }}>
                  <CheckCircle2 size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
                  <span className="grow">{c}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title={t('project.shipTo')}>
            <div style={{ whiteSpace: 'pre-line', fontSize: 15, lineHeight: 1.45 }}>{active.ctx.vars.address_block || '—'}</div>
            {active.shipment && (
              <div className="row wrap mt-16">
                <StatusBadge group="shipment" value={active.shipment.status} />
                <a className="mono small" href={`#/shipments?id=${active.shipment.id}`}>
                  {active.shipment.code}
                </a>
                {active.shipment.trackingNumber && <span className="mono small muted">{active.shipment.trackingNumber}</span>}
              </div>
            )}
          </Card>
          <Card title={t('assembly.instructions')}>
            {notes.length ? (
              <div className="col gap-12">
                {notes.map((n, i) => (
                  <div key={i} className="issue warning" style={{ fontSize: 14.5 }}>
                    <div>
                      <b>{n.label}</b>
                      <div className="mt-8">{n.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted small">{t('assembly.noInstructions')}</div>
            )}
          </Card>
          {!batchId && p.batchId && (
            <a className="btn" href={`#/print/${p.batchId}/assembly`}>
              <ClipboardList /> {t('assembly.openBatch')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function Assembly({ batchId, projectId }: { batchId?: string; projectId?: string }) {
  if (!batchId && !projectId) return <AssemblyPicker />;
  return <AssemblyDesk key={batchId ?? projectId} batchId={batchId} projectId={projectId} />;
}
