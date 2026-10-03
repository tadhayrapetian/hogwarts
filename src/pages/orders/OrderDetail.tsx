import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Banknote, Pencil, ShoppingBag, Trash2, Truck, Wand2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { balanceDue, discountAmount, nextOrderStatus, subtotal } from '../../core/orders';
import { ORDER_STATUSES } from '../../core/types';
import { db } from '../../db/db';
import { createShipment, deleteOrder, updateOrder } from '../../db/services';
import { useFmt } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate } from '../../app/router';
import { useSession } from '../../app/session';
import { useUI } from '../../app/ui';
import { useI18n } from '../../i18n';
import { Card, DataTable, EmptyState, PageHeader, StatusBadge } from '../../ui/kit';
import { FilesPanel } from '../shared/FilesPanel';
import { OrderForm } from './OrderForm';

export function OrderDetail({ id }: { id: string }) {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const ui = useUI();
  const run = useAction();
  const { confirm, prompt } = useFeedback();
  const [edit, setEdit] = useState(false);
  const data = useLiveQuery(async () => {
    const o = await db.orders.get(id);
    if (!o) return { o: null };
    return {
      o,
      r: o.recipientId ? await db.recipients.get(o.recipientId) : undefined,
      c: o.customerId ? await db.customers.get(o.customerId) : undefined,
      projects: await db.projects.where('orderId').equals(id).toArray(),
      shipments: await db.shipments.where('orderId').equals(id).toArray(),
    };
  }, [id]);
  if (!data) return null;
  if (!data.o) return <EmptyState icon={<ShoppingBag />} title={t('order.notFound')} />;
  const { o, r, c, projects = [], shipments = [] } = data;
  const next = nextOrderStatus(o.status);
  const editable = can('orders.edit');
  return (
    <div>
      <PageHeader
        crumbs={[{ label: t('nav.orders'), href: '#/orders' }, { label: o.number }]}
        title={
          <span className="row wrap">
            <span className="mono" style={{ fontFamily: 'var(--font-display)' }}>
              {o.number}
            </span>
            <StatusBadge group="order" value={o.status} />
            <StatusBadge group="payment" value={o.paymentStatus} />
          </span>
        }
        sub={`${fmt.dateTime(o.createdAt)} · ${o.createdBy}`}
        actions={
          editable && (
            <>
              {next && o.status !== 'cancelled' && (
                <button className="btn primary" onClick={() => run(() => updateOrder(o.id, { status: next }), t('common.saved'))}>
                  <ArrowRight /> {tEnum('order', next)}
                </button>
              )}
              {can('projects.edit') && (
                <button className="btn accent" onClick={() => ui.openPackageWizard({ orderId: o.id, recipientId: o.recipientId })}>
                  <Wand2 /> {t('package.create')}
                </button>
              )}
              <button className="btn" onClick={() => setEdit(true)}>
                <Pencil /> {t('common.edit')}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const v = await prompt({ title: t('order.recordPayment'), label: t('order.amountPaid'), initial: String(balanceDue(o) || o.total) });
                  if (v === null) return;
                  const amount = Number(v.replace(',', '.'));
                  if (!isFinite(amount)) return;
                  run(() => updateOrder(o.id, { amountPaid: Math.round(((o.amountPaid || 0) + amount) * 100) / 100 }), t('common.saved'));
                }}
              >
                <Banknote /> {t('order.recordPayment')}
              </button>
              {can('shipping.edit') && (
                <button
                  className="btn"
                  onClick={async () => {
                    const s = await run(() => createShipment({ orderId: o.id, projectId: projects[0]?.id }), t('shipment.created'));
                    if (s) navigate(`/shipments?id=${s.id}`);
                  }}
                >
                  <Truck /> {t('shipment.create')}
                </button>
              )}
              {o.status !== 'cancelled' && (
                <button
                  className="btn danger"
                  onClick={async () => {
                    if (await confirm({ title: t('order.cancelTitle'), danger: true, confirm: t('order.cancelOrder') })) run(() => updateOrder(o.id, { status: 'cancelled' }), t('common.saved'));
                  }}
                >
                  <XCircle /> {t('order.cancelOrder')}
                </button>
              )}
            </>
          )
        }
      />
      <div className="steps mb-16">
        {ORDER_STATUSES.filter((s) => !['cancelled', 'archived'].includes(s)).map((s, i, arr) => {
          const cur = arr.indexOf(o.status);
          return (
            <span key={s} className={`s ${o.status === s ? 'active' : cur > i ? 'done' : ''}`}>
              <span className="n">{i + 1}</span>
              {tEnum('order', s)}
            </span>
          );
        })}
      </div>
      <div className="grid grid-3">
        <Card title={t('order.items')} className="span-2">
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('order.product')}</th>
                  <th className="right">{t('order.qty')}</th>
                  <th className="right">{t('order.price')}</th>
                  <th className="right">{t('order.lineTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="num right">{i.qty}</td>
                    <td className="num right">{fmt.money(i.unitPrice, o.currency)}</td>
                    <td className="num right">{fmt.money(i.qty * i.unitPrice, o.currency)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className="right muted">
                    {t('order.subtotal')}
                  </td>
                  <td className="num right">{fmt.money(subtotal(o.items), o.currency)}</td>
                </tr>
                {discountAmount(o) > 0 && (
                  <tr>
                    <td colSpan={3} className="right muted">
                      {t('order.discount')} {o.discountType === 'percent' ? `(${o.discountValue}%)` : ''}
                    </td>
                    <td className="num right">− {fmt.money(discountAmount(o), o.currency)}</td>
                  </tr>
                )}
                {o.shippingFee > 0 && (
                  <tr>
                    <td colSpan={3} className="right muted">
                      {t('order.shippingFee')}
                    </td>
                    <td className="num right">{fmt.money(o.shippingFee, o.currency)}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={3} className="right">
                    <b>{t('order.total')}</b>
                  </td>
                  <td className="num right">
                    <b>{fmt.money(o.total, o.currency)}</b>
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="right muted">
                    {t('order.amountPaid')} / {t('order.balance')}
                  </td>
                  <td className="num right">
                    {fmt.money(o.amountPaid, o.currency)} / {fmt.money(balanceDue(o), o.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={t('order.details')}>
          <dl className="kv">
            <dt>{t('nav.recipients')}</dt>
            <dd>{r ? <a href={`#/recipients/${r.id}`}>{r.firstName} {r.lastName} · #{r.code}</a> : '—'}</dd>
            <dt>{t('field.customer')}</dt>
            <dd>{c ? <a href={`#/customers/${c.id}`}>{c.name}</a> : '—'}</dd>
            <dt>{t('order.production')}</dt>
            <dd>
              <StatusBadge group="production" value={o.productionStatus} />
            </dd>
            <dt>{t('order.shipping')}</dt>
            <dd>
              <StatusBadge group="orderShipping" value={o.shippingStatus} />
            </dd>
            <dt>{t('order.tracking')}</dt>
            <dd className="mono">{o.trackingNumber || '—'}</dd>
            <dt>{t('order.dueDate')}</dt>
            <dd>{fmt.date(o.dueDate) || '—'}</dd>
            <dt>{t('field.notes')}</dt>
            <dd>{o.notes || '—'}</dd>
          </dl>
        </Card>
        <Card title={t('nav.projects')} className="span-2">
          <DataTable
            compact
            rows={projects}
            rowKey={(p) => p.id}
            onRowClick={(p) => navigate(`/projects/${p.id}`)}
            columns={[
              { key: 'c', header: t('project.code'), render: (p) => <span className="mono">{p.code}</span> },
              { key: 'n', header: t('field.name'), render: (p) => p.name },
              { key: 's', header: t('project.stage'), render: (p) => <StatusBadge group="stage" value={p.stage} /> },
            ]}
            empty={<div className="muted small">{t('order.noProjects')}</div>}
          />
          <h4 className="mt-16 mb-8">{t('nav.shipments')}</h4>
          <DataTable
            compact
            rows={shipments}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/shipments?id=${s.id}`)}
            columns={[
              { key: 'c', header: t('shipment.id'), render: (s) => <span className="mono">{s.code}</span> },
              { key: 'tr', header: t('order.tracking'), render: (s) => <span className="mono">{s.trackingNumber || '—'}</span> },
              { key: 's', header: t('field.status'), render: (s) => <StatusBadge group="shipment" value={s.status} /> },
              { key: 'd', header: t('shipment.shippingDate'), render: (s) => fmt.date(s.shippingDate) || '—' },
            ]}
            empty={<div className="muted small">{t('order.noShipments')}</div>}
          />
        </Card>
        <Card title={t('order.history')}>
          <div className="timeline">
            {[...o.statusHistory].reverse().map((h, i) => (
              <div key={i} className="tl-item done">
                <StatusBadge group="order" value={h.status} />
                <div className="when">
                  {fmt.dateTime(h.at)} · {h.by}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t('profile.tab.files')} className="span-all">
          <FilesPanel ownerType="order" ownerId={o.id} />
        </Card>
      </div>
      {editable && (
        <div className="row mt-24">
          <span className="grow" />
          <button
            className="btn danger"
            onClick={async () => {
              if (await confirm({ title: t('order.deleteTitle', { number: o.number }), body: t('order.deleteBody'), danger: true, confirm: t('common.delete') })) {
                await run(() => deleteOrder(o.id), t('common.deleted'));
                navigate('/orders');
              }
            }}
          >
            <Trash2 /> {t('common.delete')}
          </button>
        </div>
      )}
      {edit && <OrderForm order={o} onClose={() => setEdit(false)} />}
    </div>
  );
}
