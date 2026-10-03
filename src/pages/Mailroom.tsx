import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, CheckCircle2, Inbox, Mail, Package, PackageCheck, Printer, Scissors, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { PROJECT_STAGES, type Project, type Shipment } from '../core/types';
import { addDays, diffDays, parseISODate } from '../core/util';
import { db } from '../db/db';
import { createShipment, setProjectStage, setShipmentStatus } from '../db/services';
import { useFmt } from '../app/data';
import { useAction } from '../app/feedback';
import { useSession } from '../app/session';
import { useUI } from '../app/ui';
import { useI18n } from '../i18n';
import { Badge, PageHeader, StatusBadge } from '../ui/kit';

interface Lane {
  key: string;
  icon: ReactNode;
  title: string;
  headline: string;
  rows: ReactNode[];
  count: number;
  href: string;
}

export function Mailroom() {
  const { t } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const ui = useUI();
  const run = useAction();
  const data = useLiveQuery(async () => ({
    orders: await db.orders.toArray(),
    projects: await db.projects.where('status').equals('active').toArray(),
    shipments: await db.shipments.toArray(),
    recipients: await db.recipients.toArray(),
  }), []);
  if (!data) return null;
  const name = (id?: string) => {
    const r = data.recipients.find((x) => x.id === id);
    return r ? `${r.firstName} ${r.lastName}` : '—';
  };
  const rank = (s: string) => PROJECT_STAGES.indexOf(s as Project['stage']);
  const shipOf = (p: Project) => data.shipments.filter((s) => s.projectId === p.id);
  const incoming = data.orders.filter((o) => (o.status === 'new' || o.status === 'confirmed') && !data.projects.some((p) => p.orderId === o.id));
  const preparing = data.projects.filter((p) => p.stage === 'created' || p.stage === 'approved');
  const printing = data.projects.filter((p) => p.stage === 'generated');
  const packing = data.projects.filter((p) => rank(p.stage) >= rank('printed') && rank(p.stage) <= rank('folded'));
  const ready = data.projects.filter((p) => rank(p.stage) >= rank('packed') && !shipOf(p).some((s) => !['preparing', 'label_created'].includes(s.status)));
  const moving: Shipment['status'][] = ['shipped', 'in_transit', 'out_for_delivery'];
  const transit = data.shipments.filter((s) => moving.includes(s.status));
  const monthAgo = addDays(new Date(), -30);
  const delivered = data.shipments.filter((s) => s.status === 'delivered' && (parseISODate(s.deliveredAt ?? s.updatedAt) ?? new Date(0)) >= monthAgo);
  const envelopesToPrepare = preparing.length + printing.length;

  const projRow = (p: Project, action?: ReactNode) => (
    <div key={p.id} className="list-item">
      <a className="grow" href={`#/projects/${p.id}`}>
        <b className="small">{name(p.recipientId)}</b>
        <div className="muted tiny truncate">{p.name.split(' — ')[0]} · {p.code}</div>
      </a>
      {action}
    </div>
  );
  const prodOk = can('production.edit');
  const lanes: Lane[] = [
    {
      key: 'incoming',
      icon: <Inbox />,
      title: t('mailroom.incoming'),
      headline: t('mailroom.newOrders', { count: incoming.length }),
      count: incoming.length,
      href: '#/orders?status=new',
      rows: incoming.slice(0, 8).map((o) => (
        <div key={o.id} className="list-item">
          <a className="grow" href={`#/orders/${o.id}`}>
            <b className="small">{name(o.recipientId)}</b>
            <div className="muted tiny">{o.number} · {fmt.date(o.createdAt)}</div>
          </a>
          {can('projects.edit') && (
            <button className="btn xs" onClick={() => ui.openPackageWizard({ orderId: o.id, recipientId: o.recipientId })}>
              <Mail /> {t('mailroom.start')}
            </button>
          )}
        </div>
      )),
    },
    {
      key: 'preparing',
      icon: <Mail />,
      title: t('mailroom.preparing'),
      headline: t('mailroom.envelopesToPrepare', { count: envelopesToPrepare }),
      count: preparing.length,
      href: '#/production',
      rows: preparing.slice(0, 8).map((p) =>
        projRow(p, prodOk && <button className="btn xs" onClick={() => run(() => setProjectStage([p.id], p.stage === 'created' ? 'approved' : 'generated'), t('common.saved'))}>{t(p.stage === 'created' ? 'mailroom.approve' : 'mailroom.generate')}</button>),
      ),
    },
    {
      key: 'printing',
      icon: <Printer />,
      title: t('mailroom.printing'),
      headline: t('mailroom.lettersToPrint', { count: printing.length }),
      count: printing.length,
      href: '#/print',
      rows: printing.slice(0, 8).map((p) => projRow(p, prodOk && <button className="btn xs" onClick={() => run(() => setProjectStage([p.id], 'printed'), t('common.saved'))}><Printer /></button>)),
    },
    {
      key: 'packing',
      icon: <Scissors />,
      title: t('mailroom.packing'),
      headline: t('mailroom.toAssemble', { count: packing.length }),
      count: packing.length,
      href: '#/production',
      rows: packing.slice(0, 8).map((p) => projRow(p, <a className="btn xs" href={`#/assembly/${p.id}`}>{t('assembly.short')}</a>)),
    },
    {
      key: 'ready',
      icon: <PackageCheck />,
      title: t('mailroom.ready'),
      headline: t('mailroom.packagesReady', { count: ready.length }),
      count: ready.length,
      href: '#/production',
      rows: ready.slice(0, 8).map((p) =>
        projRow(
          p,
          can('shipping.edit') && (
            <button
              className="btn xs"
              onClick={() =>
                run(async () => {
                  const existing = shipOf(p)[0];
                  const s = existing ?? (await createShipment({ projectId: p.id }));
                  await setShipmentStatus([s.id], 'shipped');
                }, t('mailroom.markedShipped'))
              }
            >
              <Truck /> {t('mailroom.ship')}
            </button>
          ),
        ),
      ),
    },
    {
      key: 'shipped',
      icon: <Truck />,
      title: t('mailroom.shipped'),
      headline: t('mailroom.inTransit', { count: transit.length }),
      count: transit.length,
      href: '#/shipments',
      rows: transit.slice(0, 8).map((s) => {
        const age = diffDays(new Date(), parseISODate(s.shippingDate ?? s.createdAt) ?? new Date());
        return (
          <div key={s.id} className="list-item">
            <a className="grow" href={`#/shipments?id=${s.id}`}>
              <b className="small">{s.recipientName}</b>
              <div className="muted tiny">{s.code} · {t('mailroom.daysAgo', { days: age })}</div>
            </a>
            {can('shipping.edit') && (
              <button className="btn xs" onClick={() => run(() => setShipmentStatus([s.id], 'delivered'), t('common.saved'))} title={t('shipment.markDelivered')}>
                <CheckCircle2 />
              </button>
            )}
          </div>
        );
      }),
    },
    {
      key: 'delivered',
      icon: <Package />,
      title: t('mailroom.delivered'),
      headline: t('mailroom.deliveredMonth', { count: delivered.length }),
      count: delivered.length,
      href: '#/shipments',
      rows: delivered.slice(0, 8).map((s) => (
        <div key={s.id} className="list-item">
          <a className="grow" href={`#/shipments?id=${s.id}`}>
            <b className="small">{s.recipientName}</b>
            <div className="muted tiny">{fmt.date(s.deliveredAt)}</div>
          </a>
          <StatusBadge group="shipment" value={s.status} />
        </div>
      )),
    },
  ];
  return (
    <div>
      <PageHeader eyebrow={t('navgroup.overview')} title={t('nav.mailroom')} sub={t('mailroom.sub')} />
      <div className="grid grid-4 mb-16">
        {[
          [t('mailroom.lettersToPrint', { count: printing.length }), printing.length, <Printer key="p" />],
          [t('mailroom.envelopesToPrepare', { count: envelopesToPrepare }), envelopesToPrepare, <Mail key="m" />],
          [t('mailroom.packagesReady', { count: ready.length }), ready.length, <PackageCheck key="r" />],
          [t('mailroom.inTransit', { count: transit.length }), transit.length, <Truck key="t" />],
        ].map(([label, value, icon], i) => (
          <div key={i} className="card stat">
            <div className="label">{icon} {t('mailroom.kpi')}</div>
            <div className="value">{value as number}</div>
            <div className="delta">{label as string}</div>
          </div>
        ))}
      </div>
      <div className="kanban">
        {lanes.map((l) => (
          <div key={l.key} className="kanban-col">
            <header>
              {l.icon}
              <span>{l.title}</span>
              <span className="n">{l.count}</span>
            </header>
            <div className="cards" style={{ gap: 0 }}>
              <div className="small" style={{ padding: '2px 4px 8px', fontWeight: 600 }}>
                {l.headline}
              </div>
              {l.rows.length ? l.rows : <div className="muted small" style={{ padding: 4 }}>{t('mailroom.empty')}</div>}
              <a className="btn xs ghost mt-8" href={l.href}>
                {t('common.viewAll')} <ArrowRight />
              </a>
            </div>
          </div>
        ))}
      </div>
      <div className="muted small mt-16">
        <Badge tone="info">{t('mailroom.flow')}</Badge> {t('mailroom.flowText')}
      </div>
    </div>
  );
}
