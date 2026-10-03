import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, Building2, ExternalLink, Eye, Mail, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InventoryItem, Supplier } from '../core/types';
import { normalizeText, nowISO, uid } from '../core/util';
import { isValidEmail, isValidPhone } from '../core/validation';
import { db } from '../db/db';
import { deleteRecord, saveRecord } from '../db/services';
import { useFmt, useSettings } from '../app/data';
import { useAction, useFeedback } from '../app/feedback';
import { setQuery, useRoute } from '../app/router';
import { useSession } from '../app/session';
import { useI18n } from '../i18n';
import { Badge, DataTable, Drawer, EmptyState, Field, PageHeader, SearchInput, Section, type Tone } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';

const isLow = (i: InventoryItem) => i.quantity <= i.minQuantity;
const stockState = (i: InventoryItem): 'out' | 'low' | 'ok' => (i.quantity <= 0 ? 'out' : i.quantity <= i.minQuantity ? 'low' : 'ok');
const STOCK_TONE: Record<'out' | 'low' | 'ok', Tone> = { out: 'danger', low: 'warning', ok: 'success' };
const suggestedReorder = (i: InventoryItem) => Math.max(1, Math.ceil(Math.max(i.minQuantity * 2 - i.quantity, i.minQuantity)));
const websiteUrl = (w: string) => {
  const s = w.trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};
const websiteHost = (w: string) => w.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');

interface Draft {
  name: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  products: string;
  prices: string;
  notes: string;
  lastOrder: string;
}

function SupplierDrawer({ supplier, items, onClose }: { supplier?: Supplier; items: InventoryItem[]; onClose: () => void }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const { can, user } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const editable = can('inventory.edit');
  const [initial] = useState<Draft>(() => ({
    name: supplier?.name ?? '',
    contact: supplier?.contact ?? '',
    email: supplier?.email ?? '',
    phone: supplier?.phone ?? '',
    website: supplier?.website ?? '',
    products: supplier?.products ?? '',
    prices: supplier?.prices ?? '',
    notes: supplier?.notes ?? '',
    lastOrder: supplier?.lastOrder ?? '',
  }));
  const [d, setD] = useState<Draft>(initial);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const linked = useMemo(() => (supplier ? items.filter((i) => i.supplierId === supplier.id).sort((a, b) => a.name.localeCompare(b.name)) : []), [items, supplier]);
  const low = linked.filter(isLow);

  const nameErr = !d.name.trim() ? t('library.nameRequired') : undefined;
  const emailErr = d.email.trim() && !isValidEmail(d.email) ? t('val.email_invalid') : undefined;
  const phoneErr = d.phone.trim() && !isValidPhone(d.phone) ? t('val.phone_invalid') : undefined;
  const valid = !nameErr && !emailErr && !phoneErr;

  const close = async () => {
    if (dirty && editable && !(await confirm({ title: t('library.discardTitle'), body: t('library.discardBody'), confirm: t('library.discard'), danger: true }))) return;
    onClose();
  };

  const save = async () => {
    const now = nowISO();
    const rec: Supplier = {
      ...(supplier ?? { id: uid(), createdAt: now, updatedAt: now }),
      name: d.name.trim(),
      contact: d.contact.trim(),
      email: d.email.trim(),
      phone: d.phone.trim(),
      website: d.website.trim(),
      products: d.products.trim(),
      prices: d.prices.trim(),
      notes: d.notes.trim(),
      lastOrder: d.lastOrder || undefined,
    };
    const saved = await run(() => saveRecord('suppliers', rec), t('common.saved'));
    if (saved) onClose();
  };

  const remove = async () => {
    if (!supplier) return;
    if (!(await confirm({ title: t('supplier.deleteTitle', { name: supplier.name }), body: t('supplier.deleteBody', { count: linked.length }), danger: true, confirm: t('common.delete') }))) return;
    const ok = await run(async () => {
      for (const it of linked) await saveRecord('inventory', { ...it, supplierId: undefined });
      await deleteRecord('suppliers', supplier.id);
      return true;
    }, t('common.deleted'));
    if (ok) onClose();
  };

  const sender = settings.company.name || user?.displayName || '';
  const orderHref = () => {
    const lines = low.map((i) => `• ${i.name}${i.sku ? ` (${i.sku})` : ''}: ${fmt.num(suggestedReorder(i), 2)} ${i.unit}`).join('\n');
    const subject = t('supplier.orderSubject', { company: sender, count: low.length });
    const body = t('supplier.orderBody', { contact: supplier?.contact || supplier?.name || '', lines, sender });
    return `mailto:${supplier?.email.trim() ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Drawer
      wide
      title={supplier ? supplier.name : t('supplier.new')}
      sub={supplier ? [supplier.contact, supplier.lastOrder ? `${t('supplier.lastOrder')}: ${fmt.date(supplier.lastOrder)}` : ''].filter(Boolean).join(' · ') : undefined}
      onClose={close}
      footer={
        <>
          {supplier && editable && (
            <button className="btn danger" onClick={remove}>
              <Trash2 /> {t('common.delete')}
            </button>
          )}
          {supplier?.email && isValidEmail(supplier.email) && (
            <a className="btn" href={`mailto:${supplier.email.trim()}`}>
              <Mail /> {t('supplier.sendEmail')}
            </a>
          )}
          <span className="grow" />
          <button className="btn" onClick={close}>
            {editable ? t('common.cancel') : t('common.close')}
          </button>
          {editable && (
            <button className="btn primary" disabled={!valid} onClick={save}>
              {t('common.save')}
            </button>
          )}
        </>
      }
    >
      <Section icon={<Building2 />} title={t('supplier.details')}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-grid">
            <Field label={t('field.name')} required error={nameErr} className="full">
              <input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!supplier} />
            </Field>
            <Field label={t('supplier.contact')}>
              <input className="input" value={d.contact} onChange={(e) => set({ contact: e.target.value })} />
            </Field>
            <Field label={t('field.email')} error={emailErr}>
              <input className="input" type="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label={t('field.phone')} error={phoneErr}>
              <input className="input" type="tel" value={d.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field
              label={t('supplier.website')}
              hint={
                d.website.trim() ? (
                  <a href={websiteUrl(d.website)} target="_blank" rel="noreferrer noopener">
                    <ExternalLink size={11} /> {websiteHost(d.website)}
                  </a>
                ) : undefined
              }
            >
              <input className="input" type="url" value={d.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
            </Field>
            <Field label={t('supplier.products')} className="full">
              <input className="input" value={d.products} onChange={(e) => set({ products: e.target.value })} placeholder={t('supplier.productsPlaceholder')} />
            </Field>
            <Field label={t('supplier.prices')} className="full">
              <textarea className="textarea" rows={3} value={d.prices} onChange={(e) => set({ prices: e.target.value })} placeholder={t('supplier.pricesPlaceholder')} />
            </Field>
            <Field label={t('supplier.lastOrder')} hint={t('supplier.lastOrderHint')}>
              <input className="input" type="date" value={d.lastOrder} onChange={(e) => set({ lastOrder: e.target.value })} />
            </Field>
            <Field label={t('field.notes')} className="full">
              <textarea className="textarea" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </fieldset>
      </Section>

      {supplier && (
        <Section
          icon={<Boxes />}
          title={`${t('supplier.linkedItems')} (${linked.length})`}
          actions={
            <>
              {editable && low.length > 0 && (
                <a className="btn xs" href={orderHref()} title={supplier.email ? supplier.email : t('inventory.noSupplierEmail')}>
                  <ShoppingCart /> {t('supplier.orderLow', { count: low.length })}
                </a>
              )}
              {editable && (
                <a className="btn ghost xs" href={`#/inventory?new=1&supplier=${supplier.id}`}>
                  <Plus /> {t('supplier.addItem')}
                </a>
              )}
            </>
          }
        >
          <div className="list">
            {linked.map((i) => {
              const s = stockState(i);
              return (
                <a key={i.id} className="list-item" href={`#/inventory?item=${i.id}`}>
                  <div className="grow">
                    <b>{i.name}</b>
                    <div className="tiny muted">
                      {i.sku && <span className="mono">{i.sku}</span>}
                      {i.sku && ' · '}
                      {t(`invcat.${i.category}`)}
                      {i.location && ` · ${i.location}`}
                    </div>
                  </div>
                  <span className="num small">
                    {fmt.num(i.quantity, 2)} {i.unit}
                    <span className="muted"> / {fmt.num(i.minQuantity, 2)}</span>
                  </span>
                  <Badge tone={STOCK_TONE[s]} dot>
                    {t(`inventory.status.${s}`)}
                  </Badge>
                </a>
              );
            })}
            {!linked.length && <div className="muted small">{t('supplier.noItems')}</div>}
          </div>
        </Section>
      )}
    </Drawer>
  );
}

export function Suppliers() {
  const { t } = useI18n();
  const fmt = useFmt();
  const route = useRoute();
  const { can } = useSession();
  const run = useAction();
  const { confirm, contextMenu } = useFeedback();
  const [q, setQ] = useState('');
  const openId = route.query.get('supplier');
  const creating = route.query.get('new') === '1';
  const data = useLiveQuery(async () => ({ suppliers: await db.suppliers.toArray(), items: await db.inventory.toArray() }), []);
  const stats = useMemo(() => {
    const m = new Map<string, { items: number; low: number; out: number }>();
    for (const i of data?.items ?? []) {
      if (!i.supplierId) continue;
      const s = m.get(i.supplierId) ?? { items: 0, low: 0, out: 0 };
      s.items++;
      if (isLow(i)) s.low++;
      if (i.quantity <= 0) s.out++;
      m.set(i.supplierId, s);
    }
    return m;
  }, [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    return data.suppliers.filter((s) => !n || normalizeText(`${s.name} ${s.contact} ${s.email} ${s.phone} ${s.products} ${s.website}`).includes(n));
  }, [data, q]);
  if (!data) return null;

  const st = (id: string) => stats.get(id) ?? { items: 0, low: 0, out: 0 };
  const current = openId ? data.suppliers.find((s) => s.id === openId) : undefined;

  const remove = async (s: Supplier) => {
    const linked = data.items.filter((i) => i.supplierId === s.id);
    if (!(await confirm({ title: t('supplier.deleteTitle', { name: s.name }), body: t('supplier.deleteBody', { count: linked.length }), danger: true, confirm: t('common.delete') }))) return;
    await run(async () => {
      for (const it of linked) await saveRecord('inventory', { ...it, supplierId: undefined });
      await deleteRecord('suppliers', s.id);
      return true;
    }, t('common.deleted'));
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.warehouse')}
        title={t('nav.suppliers')}
        sub={t('supplier.sub')}
        actions={
          <>
            <ExportMenu
              name={t('nav.suppliers')}
              build={() => ({
                head: [t('field.name'), t('supplier.contact'), t('field.email'), t('field.phone'), t('supplier.website'), t('supplier.products'), t('supplier.prices'), t('supplier.lastOrder'), t('supplier.items'), t('supplier.lowItems'), t('field.notes')],
                rows: rows.map((s) => [s.name, s.contact, s.email, s.phone, s.website, s.products, s.prices, s.lastOrder ?? '', st(s.id).items, st(s.id).low, s.notes]),
              })}
            />
            {can('inventory.edit') && (
              <button className="btn primary" onClick={() => setQuery('new', '1')}>
                <Plus /> {t('supplier.new')}
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('supplier.search')} />
        <span className="grow" />
        <span className="muted small">{t('supplier.count', { count: rows.length })}</span>
      </div>
      <DataTable
        rows={rows}
        rowKey={(s) => s.id}
        onRowClick={(s) => setQuery('supplier', s.id)}
        initialSort={{ key: 'name', dir: 'asc' }}
        onContextMenu={(s, e) =>
          contextMenu(e, [
            { label: t('common.open'), icon: <Eye />, onClick: () => setQuery('supplier', s.id) },
            ...(s.email ? [{ label: t('supplier.sendEmail'), icon: <Mail />, onClick: () => (window.location.href = `mailto:${s.email.trim()}`) }] : []),
            ...(can('inventory.edit') ? [{ divider: true, label: '' }, { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => remove(s) }] : []),
          ])
        }
        columns={[
          {
            key: 'name',
            header: t('field.name'),
            render: (s) => (
              <div>
                <b>{s.name}</b>
                {s.website && (
                  <div className="tiny">
                    <a href={websiteUrl(s.website)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
                      {websiteHost(s.website)}
                    </a>
                  </div>
                )}
              </div>
            ),
            sort: (s) => s.name.toLowerCase(),
          },
          { key: 'contact', header: t('supplier.contact'), render: (s) => s.contact || '—', sort: (s) => s.contact },
          {
            key: 'email',
            header: t('field.email'),
            render: (s) =>
              s.email ? (
                <a href={`mailto:${s.email.trim()}`} onClick={(e) => e.stopPropagation()} className="small">
                  {s.email}
                </a>
              ) : (
                '—'
              ),
            sort: (s) => s.email,
          },
          {
            key: 'phone',
            header: t('field.phone'),
            render: (s) =>
              s.phone ? (
                <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()} className="small" style={{ whiteSpace: 'nowrap' }}>
                  {s.phone}
                </a>
              ) : (
                '—'
              ),
          },
          {
            key: 'products',
            header: t('supplier.products'),
            render: (s) => (
              <div className="small truncate" style={{ maxWidth: 280 }} title={s.products}>
                {s.products || '—'}
              </div>
            ),
          },
          { key: 'last', header: t('supplier.lastOrder'), render: (s) => (s.lastOrder ? fmt.date(s.lastOrder) : '—'), sort: (s) => s.lastOrder ?? '' },
          { key: 'items', header: t('supplier.items'), render: (s) => fmt.num(st(s.id).items), sort: (s) => st(s.id).items, className: 'num right' },
          {
            key: 'low',
            header: t('supplier.lowItems'),
            render: (s) => {
              const x = st(s.id);
              return x.low ? (
                <Badge tone={x.out ? 'danger' : 'warning'} dot>
                  {fmt.num(x.low)}
                </Badge>
              ) : (
                <span className="muted">—</span>
              );
            },
            sort: (s) => st(s.id).low,
          },
        ]}
        empty={
          data.suppliers.length ? undefined : (
            <EmptyState
              icon={<Building2 />}
              title={t('supplier.empty')}
              text={t('supplier.emptyText')}
              action={
                can('inventory.edit') ? (
                  <button className="btn primary" onClick={() => setQuery('new', '1')}>
                    <Plus /> {t('supplier.new')}
                  </button>
                ) : undefined
              }
            />
          )
        }
      />
      {creating && can('inventory.edit') && <SupplierDrawer items={data.items} onClose={() => setQuery('new', null)} />}
      {!creating && current && <SupplierDrawer key={current.id} supplier={current} items={data.items} onClose={() => setQuery('supplier', null)} />}
    </div>
  );
}
