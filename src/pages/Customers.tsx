import { useLiveQuery } from 'dexie-react-hooks';
import { Contact, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Customer } from '../core/types';
import { normalizeText } from '../core/util';
import { isValidEmail, isValidPhone } from '../core/validation';
import { db } from '../db/db';
import { deleteCustomer, saveCustomer } from '../db/services';
import { useFmt } from '../app/data';
import { useAction, useFeedback } from '../app/feedback';
import { navigate } from '../app/router';
import { useSession } from '../app/session';
import { useI18n } from '../i18n';
import { DataTable, Drawer, EmptyState, Field, PageHeader, SearchInput, StatusBadge } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';
import { FilesPanel } from './shared/FilesPanel';

function CustomerForm({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const { t } = useI18n();
  const run = useAction();
  const [c, setC] = useState<Partial<Customer>>(customer ?? { name: '', email: '', phone: '', notes: '' });
  const emailErr = c.email && !isValidEmail(c.email) ? t('val.email_invalid') : undefined;
  const phoneErr = c.phone && !isValidPhone(c.phone) ? t('val.phone_invalid') : undefined;
  return (
    <Drawer
      title={customer ? customer.name : t('customer.new')}
      sub={customer?.code}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!c.name?.trim() || !!emailErr || !!phoneErr}
            onClick={async () => {
              const saved = await run(() => saveCustomer(c as Customer), t('common.saved'));
              if (saved) onClose();
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('field.name')} required className="full">
          <input className="input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('field.email')} error={emailErr}>
          <input className="input" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
        </Field>
        <Field label={t('field.phone')} error={phoneErr}>
          <input className="input" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
        </Field>
        <Field label={t('customer.billingAddress')} className="full">
          <textarea
            className="textarea"
            rows={3}
            value={[c.billingAddress?.line1, c.billingAddress?.city, c.billingAddress?.postalCode].filter(Boolean).join('\n')}
            onChange={(e) => {
              const [line1 = '', city = '', postalCode = ''] = e.target.value.split('\n');
              setC({ ...c, billingAddress: { id: c.billingAddress?.id ?? 'billing', label: 'billing', name: '', line1, line2: '', extra: '', city, region: '', postalCode, country: c.billingAddress?.country ?? '', notes: '' } });
            }}
            placeholder={t('customer.billingPlaceholder')}
          />
        </Field>
        <Field label={t('field.notes')} className="full">
          <textarea className="textarea" rows={3} value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

function CustomerDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (c: Customer) => void }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const data = useLiveQuery(async () => {
    const c = await db.customers.get(id);
    return { c, recipients: await db.recipients.where('customerId').equals(id).toArray(), orders: await db.orders.where('customerId').equals(id).reverse().sortBy('createdAt') };
  }, [id]);
  if (!data?.c) return null;
  const { c, recipients, orders } = data;
  const revenue = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
  return (
    <Drawer
      title={c.name}
      sub={`${c.code} · ${fmt.money(revenue)}`}
      onClose={onClose}
      wide
      footer={
        can('recipients.edit') ? (
          <>
            <button
              className="btn danger"
              onClick={async () => {
                if (await confirm({ title: t('customer.deleteTitle', { name: c.name }), body: t('customer.deleteBody'), danger: true, confirm: t('common.delete') })) {
                  await run(() => deleteCustomer(c.id), t('common.deleted'));
                  onClose();
                }
              }}
            >
              <Trash2 /> {t('common.delete')}
            </button>
            <span className="grow" />
            <button className="btn primary" onClick={() => onEdit(c)}>
              <Pencil /> {t('common.edit')}
            </button>
          </>
        ) : undefined
      }
    >
      <dl className="kv mb-16">
        <dt>{t('field.email')}</dt>
        <dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</dd>
        <dt>{t('field.phone')}</dt>
        <dd>{c.phone || '—'}</dd>
        <dt>{t('field.notes')}</dt>
        <dd>{c.notes || '—'}</dd>
      </dl>
      <h4 className="mb-8">{t('nav.recipients')}</h4>
      <div className="list mb-16">
        {recipients.map((r) => (
          <a key={r.id} className="list-item" href={`#/recipients/${r.id}`}>
            <b className="grow">
              {r.firstName} {r.lastName}
            </b>
            <span className="muted small">#{r.code}</span>
          </a>
        ))}
        {!recipients.length && <div className="muted small">—</div>}
      </div>
      <h4 className="mb-8">{t('nav.orders')}</h4>
      <DataTable
        compact
        rows={orders}
        rowKey={(o) => o.id}
        onRowClick={(o) => navigate(`/orders/${o.id}`)}
        columns={[
          { key: 'n', header: t('order.number'), render: (o) => <span className="mono">{o.number}</span> },
          { key: 'd', header: t('common.date'), render: (o) => fmt.date(o.createdAt) },
          { key: 's', header: t('field.status'), render: (o) => <StatusBadge group="order" value={o.status} /> },
          { key: 't', header: t('order.total'), render: (o) => fmt.money(o.total, o.currency), className: 'num right' },
        ]}
      />
      <h4 className="mb-8 mt-16">{t('profile.tab.files')}</h4>
      <FilesPanel ownerType="customer" ownerId={c.id} />
    </Drawer>
  );
}

export function Customers({ selectedId }: { selectedId?: string }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined);
  const data = useLiveQuery(async () => ({ customers: await db.customers.toArray(), recipients: await db.recipients.toArray(), orders: await db.orders.toArray() }), []);
  const rows = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    return data.customers.filter((c) => !n || normalizeText(`${c.name} ${c.email} ${c.phone} ${c.code}`).includes(n));
  }, [data, q]);
  if (!data) return null;
  const stats = (id: string) => {
    const os = data.orders.filter((o) => o.customerId === id && o.status !== 'cancelled');
    return { kids: data.recipients.filter((r) => r.customerId === id).length, orders: os.length, revenue: os.reduce((s, o) => s + o.total, 0), last: os.map((o) => o.createdAt).sort().pop() };
  };
  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.crm')}
        title={t('nav.customers')}
        sub={t('customer.sub')}
        actions={
          <>
            <ExportMenu
              name={t('nav.customers')}
              build={() => ({
                head: [t('field.id'), t('field.name'), t('field.email'), t('field.phone'), t('nav.recipients'), t('nav.orders'), t('analytics.revenue')],
                rows: rows.map((c) => {
                  const s = stats(c.id);
                  return [c.code, c.name, c.email, c.phone, s.kids, s.orders, s.revenue];
                }),
              })}
            />
            {can('recipients.edit') && (
              <button className="btn primary" onClick={() => setEditing(null)}>
                <Plus /> {t('customer.new')}
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('common.search')} />
      </div>
      <DataTable
        rows={rows}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        initialSort={{ key: 'name', dir: 'asc' }}
        columns={[
          { key: 'code', header: t('field.id'), render: (c) => <span className="mono">{c.code}</span>, sort: (c) => c.code },
          { key: 'name', header: t('field.name'), render: (c) => <b>{c.name}</b>, sort: (c) => c.name },
          { key: 'email', header: t('field.email'), render: (c) => c.email },
          { key: 'phone', header: t('field.phone'), render: (c) => c.phone },
          { key: 'kids', header: t('nav.recipients'), render: (c) => stats(c.id).kids, sort: (c) => stats(c.id).kids, className: 'num right' },
          { key: 'orders', header: t('nav.orders'), render: (c) => stats(c.id).orders, sort: (c) => stats(c.id).orders, className: 'num right' },
          { key: 'rev', header: t('analytics.revenue'), render: (c) => fmt.money(stats(c.id).revenue), sort: (c) => stats(c.id).revenue, className: 'num right' },
          { key: 'last', header: t('customer.lastOrder'), render: (c) => fmt.date(stats(c.id).last) || '—', sort: (c) => stats(c.id).last ?? '' },
        ]}
        empty={<EmptyState icon={<Contact />} title={t('customer.empty')} />}
      />
      {selectedId && <CustomerDetail id={selectedId} onClose={() => navigate('/customers')} onEdit={(c) => setEditing(c)} />}
      {editing !== undefined && <CustomerForm customer={editing ?? undefined} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
