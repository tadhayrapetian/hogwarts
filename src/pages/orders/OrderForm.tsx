import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { discountAmount, orderTotal, subtotal } from '../../core/orders';
import { ORDER_STATUSES, PAYMENT_STATUSES, type Order, type OrderItem } from '../../core/types';
import { addDays, toISODate, uid } from '../../core/util';
import { db } from '../../db/db';
import { createOrder, updateOrder } from '../../db/services';
import { useFmt } from '../../app/data';
import { useAction } from '../../app/feedback';
import { navigate } from '../../app/router';
import { useI18n } from '../../i18n';
import { Field, Modal, NumberInput } from '../../ui/kit';
import { CustomerSelect, RecipientSelect } from '../shared/pickers';

export function OrderForm({ order, prefillRecipient, onClose }: { order?: Order; prefillRecipient?: string; onClose: () => void }) {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const products = useLiveQuery(() => db.products.filter((p) => p.active).toArray(), []) ?? [];
  const [o, setO] = useState<Partial<Order>>(
    () =>
      order ?? {
        recipientId: prefillRecipient,
        items: [],
        discountType: 'amount',
        discountValue: 0,
        shippingFee: 0,
        status: 'new',
        paymentStatus: 'unpaid',
        amountPaid: 0,
        dueDate: toISODate(addDays(new Date(), 10)),
        notes: '',
      },
  );
  const items = o.items ?? [];
  const setItem = (i: number, p: Partial<OrderItem>) => setO({ ...o, items: items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const calc = { items, discountType: o.discountType ?? 'amount', discountValue: o.discountValue ?? 0, shippingFee: o.shippingFee ?? 0 };

  const onRecipient = async (id?: string) => {
    const r = id ? await db.recipients.get(id) : undefined;
    setO((x) => ({ ...x, recipientId: id, customerId: x.customerId ?? r?.customerId }));
  };

  const save = async () => {
    const saved = await run(() => (order ? updateOrder(order.id, o) : createOrder(o)), order ? t('common.saved') : t('order.created'));
    if (saved) {
      onClose();
      if (!order) navigate(`/orders/${saved.id}`);
    }
  };

  return (
    <Modal
      title={order ? t('order.edit', { number: order.number }) : t('order.new')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <div className="left">
            <b>{t('order.total')}: {fmt.money(orderTotal(calc))}</b>
          </div>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={save} disabled={!items.length}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('nav.recipients')}>
          <RecipientSelect value={o.recipientId} onChange={onRecipient} allowEmpty />
        </Field>
        <Field label={t('field.customer')}>
          <CustomerSelect value={o.customerId} onChange={(id) => setO({ ...o, customerId: id })} />
        </Field>
      </div>
      <h4 className="mt-24 mb-8">{t('order.items')}</h4>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>{t('order.product')}</th>
              <th style={{ width: 80 }}>{t('order.qty')}</th>
              <th style={{ width: 120 }}>{t('order.price')}</th>
              <th style={{ width: 110 }} className="right">
                {t('order.lineTotal')}
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td>
                  <input className="input sm" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} />
                </td>
                <td>
                  <NumberInput className="input sm" min={1} value={it.qty} onChange={(v) => setItem(i, { qty: v ?? 1 })} />
                </td>
                <td>
                  <NumberInput className="input sm" min={0} step={0.5} value={it.unitPrice} onChange={(v) => setItem(i, { unitPrice: v ?? 0 })} />
                </td>
                <td className="num right">{fmt.money(it.qty * it.unitPrice)}</td>
                <td>
                  <button className="btn icon xs ghost danger" onClick={() => setO({ ...o, items: items.filter((_, j) => j !== i) })} aria-label={t('common.delete')}>
                    <Trash2 />
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={5} className="muted small">
                  {t('order.noItems')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row mt-8 wrap">
        <select
          className="select sm"
          style={{ width: 280 }}
          value=""
          onChange={(e) => {
            const p = products.find((x) => x.id === e.target.value);
            if (p) setO({ ...o, items: [...items, { id: uid(), productId: p.id, name: p.name, qty: 1, unitPrice: p.price }] });
          }}
        >
          <option value="">+ {t('order.addProduct')}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {fmt.money(p.price)}
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => setO({ ...o, items: [...items, { id: uid(), name: t('order.customItem'), qty: 1, unitPrice: 0 }] })}>
          <Plus /> {t('order.customItem')}
        </button>
      </div>
      <div className="form-grid cols-4 mt-24">
        <Field label={t('order.discount')}>
          <div className="row gap-4">
            <NumberInput className="input" min={0} value={o.discountValue} onChange={(v) => setO({ ...o, discountValue: v ?? 0 })} />
            <select className="select" style={{ width: 70 }} value={o.discountType} onChange={(e) => setO({ ...o, discountType: e.target.value as Order['discountType'] })}>
              <option value="amount">{fmt.currency}</option>
              <option value="percent">%</option>
            </select>
          </div>
        </Field>
        <Field label={t('order.shippingFee')}>
          <NumberInput className="input" min={0} step={0.5} value={o.shippingFee} onChange={(v) => setO({ ...o, shippingFee: v ?? 0 })} />
        </Field>
        <Field label={t('order.dueDate')}>
          <input className="input" type="date" value={o.dueDate ?? ''} onChange={(e) => setO({ ...o, dueDate: e.target.value || undefined })} />
        </Field>
        <Field label={t('field.status')}>
          <select className="select" value={o.status} onChange={(e) => setO({ ...o, status: e.target.value as Order['status'] })}>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tEnum('order', s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('order.payment')}>
          <select className="select" value={o.paymentStatus} onChange={(e) => setO({ ...o, paymentStatus: e.target.value as Order['paymentStatus'] })}>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {tEnum('payment', s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('order.amountPaid')}>
          <NumberInput className="input" min={0} step={0.5} value={o.amountPaid} onChange={(v) => setO({ ...o, amountPaid: v ?? 0 })} />
        </Field>
        <Field label={t('field.notes')} className="span-2">
          <input className="input" value={o.notes} onChange={(e) => setO({ ...o, notes: e.target.value })} />
        </Field>
      </div>
      <div className="card pad flat mt-16" style={{ background: 'var(--surface-2)' }}>
        <div className="row between small">
          <span>{t('order.subtotal')}</span>
          <span className="num">{fmt.money(subtotal(items))}</span>
        </div>
        <div className="row between small">
          <span>{t('order.discount')}</span>
          <span className="num">− {fmt.money(discountAmount(calc))}</span>
        </div>
        <div className="row between small">
          <span>{t('order.shippingFee')}</span>
          <span className="num">{fmt.money(o.shippingFee ?? 0)}</span>
        </div>
        <div className="row between" style={{ fontWeight: 700, marginTop: 4 }}>
          <span>{t('order.total')}</span>
          <span className="num">{fmt.money(orderTotal(calc))}</span>
        </div>
      </div>
    </Modal>
  );
}
