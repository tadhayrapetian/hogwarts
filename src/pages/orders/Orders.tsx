import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, Plus, ShoppingBag, Trash2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ORDER_SHIPPING_STATUSES, ORDER_STATUSES, PAYMENT_STATUSES, PRODUCTION_STATUSES, type Order } from '../../core/types';
import { normalizeText, todayISO } from '../../core/util';
import { db } from '../../db/db';
import { deleteOrder, setOrderStatus } from '../../db/services';
import { useFmt } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate, setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { useUI } from '../../app/ui';
import { useI18n } from '../../i18n';
import { Badge, DataTable, EmptyState, Field, PageHeader, SearchInput, StatusBadge } from '../../ui/kit';
import { ExportMenu } from '../shared/ExportMenu';
import { OrderForm } from './OrderForm';

export function Orders() {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const route = useRoute();
  const { can } = useSession();
  const ui = useUI();
  const run = useAction();
  const { confirm, contextMenu } = useFeedback();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(route.query.get('status') ?? '');
  const [payment, setPayment] = useState('');
  const [production, setProduction] = useState('');
  const [shipping, setShipping] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const creating = route.query.get('new') === '1';
  const data = useLiveQuery(async () => ({ orders: await db.orders.toArray(), recipients: await db.recipients.toArray(), customers: await db.customers.toArray() }), []);
  const rows = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    return data.orders.filter((o) => {
      if (status === 'open' ? ['delivered', 'cancelled', 'archived', 'shipped'].includes(o.status) : status ? o.status !== status : o.status === 'archived') return false;
      if (payment && o.paymentStatus !== payment) return false;
      if (production && o.productionStatus !== production) return false;
      if (shipping && o.shippingStatus !== shipping) return false;
      if (n) {
        const r = data.recipients.find((x) => x.id === o.recipientId);
        const c = data.customers.find((x) => x.id === o.customerId);
        if (!normalizeText(`${o.number} ${o.trackingNumber} ${r?.firstName} ${r?.lastName} ${r?.code} ${c?.name} ${o.items.map((i) => i.name).join(' ')}`).includes(n)) return false;
      }
      return true;
    });
  }, [data, q, status, payment, production, shipping]);
  if (!data) return null;
  const rName = (id?: string) => {
    const r = data.recipients.find((x) => x.id === id);
    return r ? `${r.firstName} ${r.lastName}` : '—';
  };
  const today = todayISO();
  const totals = rows.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.operations')}
        title={t('nav.orders')}
        sub={t('order.sub', { count: rows.length, total: fmt.money(totals) })}
        actions={
          <>
            <ExportMenu
              name={t('nav.orders')}
              build={() => ({
                head: [t('order.number'), t('common.date'), t('nav.recipients'), t('field.customer'), t('order.items'), t('order.total'), t('field.status'), t('order.payment'), t('order.production'), t('order.shipping'), t('order.tracking'), t('order.dueDate')],
                rows: rows.map((o) => [
                  o.number,
                  o.createdAt.slice(0, 10),
                  rName(o.recipientId),
                  data.customers.find((c) => c.id === o.customerId)?.name ?? '',
                  o.items.map((i) => `${i.qty}× ${i.name}`).join('; '),
                  o.total,
                  tEnum('order', o.status),
                  tEnum('payment', o.paymentStatus),
                  tEnum('production', o.productionStatus),
                  tEnum('orderShipping', o.shippingStatus),
                  o.trackingNumber,
                  o.dueDate ?? '',
                ]),
              })}
            />
            {can('orders.edit') && (
              <button className="btn primary" onClick={() => setQuery('new', '1')}>
                <Plus /> {t('order.new')}
              </button>
            )}
          </>
        }
      />
      <div className="tabs pill mb-16" style={{ flexWrap: 'wrap' }}>
        {['', 'open', ...ORDER_STATUSES].map((s) => (
          <button key={s || 'all'} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
            {s === '' ? t('common.all') : s === 'open' ? t('order.open') : tEnum('order', s)}
            <span className="muted"> {s === '' ? data.orders.filter((o) => o.status !== 'archived').length : s === 'open' ? data.orders.filter((o) => !['delivered', 'cancelled', 'archived', 'shipped'].includes(o.status)).length : data.orders.filter((o) => o.status === s).length}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('order.search')} />
        <Field>
          <select className="select" value={payment} onChange={(e) => setPayment(e.target.value)} aria-label={t('order.payment')}>
            <option value="">{t('order.payment')}: {t('common.all')}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tEnum('payment', s)}
              </option>
            ))}
          </select>
        </Field>
        <select className="select" style={{ width: 200 }} value={production} onChange={(e) => setProduction(e.target.value)} aria-label={t('order.production')}>
          <option value="">{t('order.production')}: {t('common.all')}</option>
          {PRODUCTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tEnum('production', s)}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 200 }} value={shipping} onChange={(e) => setShipping(e.target.value)} aria-label={t('order.shipping')}>
          <option value="">{t('order.shipping')}: {t('common.all')}</option>
          {ORDER_SHIPPING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tEnum('orderShipping', s)}
            </option>
          ))}
        </select>
      </div>
      {selected.size > 0 && can('orders.edit') && (
        <div className="bulkbar">
          <b>{t('common.selected', { count: selected.size })}</b>
          <select className="select sm" style={{ width: 200 }} value="" onChange={(e) => e.target.value && run(() => setOrderStatus(Array.from(selected), e.target.value as Order['status']), t('common.saved'))}>
            <option value="">{t('order.setStatus')}…</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tEnum('order', s)}
              </option>
            ))}
          </select>
          <span className="grow" />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      )}
      <DataTable
        rows={rows}
        rowKey={(o) => o.id}
        selected={can('orders.edit') ? selected : undefined}
        onSelect={setSelected}
        onRowClick={(o) => navigate(`/orders/${o.id}`)}
        initialSort={{ key: 'date', dir: 'desc' }}
        onContextMenu={(o, e) =>
          contextMenu(e, [
            { label: t('common.open'), icon: <Eye />, onClick: () => navigate(`/orders/${o.id}`) },
            ...(can('projects.edit') ? [{ label: t('package.create'), icon: <Wand2 />, onClick: () => ui.openPackageWizard({ orderId: o.id, recipientId: o.recipientId }) }] : []),
            ...(can('orders.edit')
              ? [
                  { divider: true, label: '' },
                  {
                    label: t('common.delete'),
                    icon: <Trash2 />,
                    danger: true,
                    onClick: async () => {
                      if (await confirm({ title: t('order.deleteTitle', { number: o.number }), body: t('order.deleteBody'), danger: true, confirm: t('common.delete') })) run(() => deleteOrder(o.id), t('common.deleted'));
                    },
                  },
                ]
              : []),
          ])
        }
        columns={[
          { key: 'num', header: t('order.number'), render: (o) => <span className="mono">{o.number}</span>, sort: (o) => o.number },
          { key: 'date', header: t('common.date'), render: (o) => fmt.date(o.createdAt), sort: (o) => o.createdAt },
          { key: 'rec', header: t('nav.recipients'), render: (o) => rName(o.recipientId), sort: (o) => rName(o.recipientId) },
          { key: 'items', header: t('order.items'), render: (o) => <span className="small">{o.items.map((i) => i.name).join(', ')}</span> },
          { key: 'total', header: t('order.total'), render: (o) => fmt.money(o.total, o.currency), sort: (o) => o.total, className: 'num right' },
          { key: 'status', header: t('field.status'), render: (o) => <StatusBadge group="order" value={o.status} />, sort: (o) => ORDER_STATUSES.indexOf(o.status) },
          { key: 'pay', header: t('order.payment'), render: (o) => <StatusBadge group="payment" value={o.paymentStatus} />, sort: (o) => o.paymentStatus },
          { key: 'ship', header: t('order.shipping'), render: (o) => <StatusBadge group="orderShipping" value={o.shippingStatus} /> },
          {
            key: 'due',
            header: t('order.dueDate'),
            render: (o) =>
              o.dueDate ? (
                <Badge tone={o.dueDate < today && !['shipped', 'delivered', 'cancelled', 'archived'].includes(o.status) ? 'danger' : 'neutral'}>{fmt.date(o.dueDate)}</Badge>
              ) : (
                '—'
              ),
            sort: (o) => o.dueDate ?? '',
          },
        ]}
        empty={<EmptyState icon={<ShoppingBag />} title={t('order.empty')} />}
      />
      {creating && <OrderForm prefillRecipient={route.query.get('recipient') ?? undefined} onClose={() => (setQuery('new', null), setQuery('recipient', null))} />}
    </div>
  );
}
