import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, Coins, Eye, History, PackageCheck, PackageMinus, PackagePlus, PackageX, Plus, Scale, ShoppingCart, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { INVENTORY_CATEGORIES, type InventoryCategory, type InventoryItem, type StockMovement, type Supplier } from '../core/types';
import { normalizeText, nowISO, uid } from '../core/util';
import { db } from '../db/db';
import { adjustStock, deleteRecord, saveRecord } from '../db/services';
import { useFmt, useSettings } from '../app/data';
import { useAction, useFeedback } from '../app/feedback';
import { setQuery, useRoute } from '../app/router';
import { useSession } from '../app/session';
import { useI18n, type TFn } from '../i18n';
import { Badge, DataTable, Drawer, EmptyState, Field, NumberInput, PageHeader, Progress, SearchInput, Section, Stat, Toggle, type Tone } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';

type Mode = 'receive' | 'consume' | 'correct';
const MODES: Mode[] = ['receive', 'consume', 'correct'];
const MODE_REASON: Record<Mode, StockMovement['reason']> = { receive: 'purchase', consume: 'consumption', correct: 'adjustment' };

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const stockState = (it: InventoryItem): 'out' | 'low' | 'ok' => (it.quantity <= 0 ? 'out' : it.quantity <= it.minQuantity ? 'low' : 'ok');
const STOCK_TONE: Record<'out' | 'low' | 'ok', Tone> = { out: 'danger', low: 'warning', ok: 'success' };
const stockPct = (it: InventoryItem) => (it.minQuantity > 0 ? (it.quantity / (it.minQuantity * 2)) * 100 : it.quantity > 0 ? 100 : 0);
const suggestedReorder = (it: InventoryItem) => Math.max(1, Math.ceil(Math.max(it.minQuantity * 2 - it.quantity, it.minQuantity)));

function reorderHref(it: InventoryItem, s: Supplier | undefined, t: TFn, num: (n: number, d?: number) => string, sender: string) {
  const subject = t('inventory.reorderSubject', { item: it.name, sku: it.sku });
  const body = t('inventory.reorderBody', {
    contact: s?.contact || s?.name || '',
    qty: num(suggestedReorder(it), 2),
    unit: it.unit,
    item: it.name,
    sku: it.sku || '—',
    current: num(it.quantity, 2),
    min: num(it.minQuantity, 2),
    sender,
  });
  return `mailto:${s?.email?.trim() ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function StockBadge({ item }: { item: InventoryItem }) {
  const { t } = useI18n();
  const s = stockState(item);
  return (
    <Badge tone={STOCK_TONE[s]} dot>
      {t(`inventory.status.${s}`)}
    </Badge>
  );
}

// ───────────── Stock movements ─────────────

function StockAdjust({ item }: { item: InventoryItem }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const [mode, setMode] = useState<Mode>('receive');
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const raw = amount === undefined || !Number.isFinite(amount) ? 0 : mode === 'receive' ? amount : mode === 'consume' ? -Math.min(amount, item.quantity) : amount - item.quantity;
  const delta = round3(raw);
  const next = round3(Math.max(0, item.quantity + delta));
  const amountErr = amount !== undefined && (!Number.isFinite(amount) || amount < 0 || (mode !== 'correct' && amount === 0)) ? t('inventory.positive') : undefined;
  const exceeds = mode === 'consume' && amount !== undefined && amount > item.quantity ? t('inventory.exceedsStock', { qty: fmt.num(item.quantity, 2), unit: item.unit }) : undefined;
  const invalid = amount === undefined || !!amountErr || delta === 0;
  const icons: Record<Mode, JSX.Element> = { receive: <PackagePlus />, consume: <PackageMinus />, correct: <Scale /> };
  const apply = async () => {
    const ok = await run(async () => {
      await adjustStock(item.id, delta, MODE_REASON[mode], note.trim());
      return true;
    }, t('inventory.stockUpdated'));
    if (ok) {
      setAmount(undefined);
      setNote('');
    }
  };
  return (
    <div className="col gap-12">
      <div className="btn-group" role="radiogroup" aria-label={t('inventory.adjust')}>
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={`btn sm ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
            {icons[m]} {t(`inventory.mode.${m}`)}
          </button>
        ))}
      </div>
      <div className="muted small">{t(`inventory.modeHint.${mode}`)}</div>
      <div className="form-grid">
        <Field label={mode === 'correct' ? t('inventory.countedQty') : t('inventory.amount')} error={amountErr} warning={exceeds}>
          <div className="row">
            <NumberInput value={amount} onChange={setAmount} min={0} placeholder={mode === 'correct' ? String(item.quantity) : '0'} />
            <span className="muted small">{item.unit}</span>
          </div>
        </Field>
        <Field label={t('field.notes')}>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('inventory.notePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && !invalid && apply()} />
        </Field>
      </div>
      <div className="row">
        <span className="small grow">
          {amount !== undefined && !amountErr && (
            <>
              <b className="num" style={{ color: delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : undefined }}>
                {delta > 0 ? '+' : ''}
                {fmt.num(delta, 3)} {item.unit}
              </b>
              {' → '}
              {t('inventory.newQuantity', { qty: fmt.num(next, 3), unit: item.unit })}
            </>
          )}
        </span>
        <button className="btn primary sm" disabled={invalid} onClick={apply}>
          {icons[mode]} {t('inventory.apply')}
        </button>
      </div>
    </div>
  );
}

function MovementHistory({ item }: { item: InventoryItem }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const rows = useMemo(() => [...(item.movements ?? [])].reverse(), [item.movements]);
  return (
    <DataTable
      compact
      rows={rows}
      rowKey={(m) => m.id}
      pageSize={10}
      initialSort={{ key: 'at', dir: 'desc' }}
      columns={[
        { key: 'at', header: t('common.date'), render: (m) => <span className="small">{fmt.dateTime(m.at)}</span>, sort: (m) => m.at },
        {
          key: 'delta',
          header: t('inventory.delta'),
          render: (m) => (
            <b style={{ color: m.delta > 0 ? 'var(--success)' : m.delta < 0 ? 'var(--danger)' : undefined }}>
              {m.delta > 0 ? '+' : m.delta < 0 ? '−' : ''}
              {fmt.num(Math.abs(m.delta), 3)}
            </b>
          ),
          sort: (m) => m.delta,
          className: 'num right',
        },
        { key: 'reason', header: t('inventory.reason'), render: (m) => <Badge tone={m.delta >= 0 ? 'info' : 'neutral'}>{t(`movement.${m.reason}`)}</Badge>, sort: (m) => m.reason },
        { key: 'note', header: t('field.notes'), render: (m) => <span className="small">{m.note || '—'}</span> },
        { key: 'by', header: t('inventory.by'), render: (m) => <span className="small">{m.by}</span>, sort: (m) => m.by },
      ]}
      empty={<div className="muted small" style={{ padding: 12 }}>{t('inventory.noMovements')}</div>}
    />
  );
}

// ───────────── Item drawer ─────────────

interface Draft {
  name: string;
  category: InventoryCategory;
  sku: string;
  quantity: number | undefined;
  minQuantity: number | undefined;
  unit: string;
  location: string;
  supplierId: string;
  cost: number | undefined;
  usagePerPackage: number | undefined;
  notes: string;
}

function ItemDrawer({ item, items, suppliers, prefillSupplier, onClose }: { item?: InventoryItem; items: InventoryItem[]; suppliers: Supplier[]; prefillSupplier?: string; onClose: () => void }) {
  const { t } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const { can, user } = useSession();
  const run = useAction();
  const { confirm } = useFeedback();
  const editable = can('inventory.edit');
  const [initial] = useState<Draft>(() => ({
    name: item?.name ?? '',
    category: item?.category ?? 'envelopes',
    sku: item?.sku ?? '',
    quantity: item?.quantity ?? 0,
    minQuantity: item?.minQuantity ?? 0,
    unit: item?.unit ?? t('inventory.defaultUnit'),
    location: item?.location ?? '',
    supplierId: item?.supplierId ?? (prefillSupplier && suppliers.some((s) => s.id === prefillSupplier) ? prefillSupplier : ''),
    cost: item?.cost ?? 0,
    usagePerPackage: item?.usagePerPackage ?? 0,
    notes: item?.notes ?? '',
  }));
  const [d, setD] = useState<Draft>(initial);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const sortedSuppliers = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const supplier = suppliers.find((s) => s.id === (item ? item.supplierId : d.supplierId));
  const selectedSupplier = suppliers.find((s) => s.id === d.supplierId);

  const numErr = (v: number | undefined) => (v === undefined || !Number.isFinite(v) || v < 0 ? t('inventory.nonNegative') : undefined);
  const nameErr = !d.name.trim() ? t('library.nameRequired') : undefined;
  const skuWarn = d.sku.trim() && items.some((o) => o.id !== item?.id && normalizeText(o.sku) === normalizeText(d.sku)) ? t('inventory.skuTaken') : undefined;
  const errors = [nameErr, numErr(d.minQuantity), numErr(d.cost), numErr(d.usagePerPackage), item ? undefined : numErr(d.quantity)];
  const valid = errors.every((e) => !e);

  const close = async () => {
    if (dirty && editable && !(await confirm({ title: t('library.discardTitle'), body: t('library.discardBody'), confirm: t('library.discard'), danger: true }))) return;
    onClose();
  };

  const save = async () => {
    const base = {
      name: d.name.trim(),
      category: d.category,
      sku: d.sku.trim(),
      minQuantity: d.minQuantity ?? 0,
      unit: d.unit.trim(),
      location: d.location.trim(),
      supplierId: d.supplierId || undefined,
      cost: d.cost ?? 0,
      usagePerPackage: d.usagePerPackage ?? 0,
      notes: d.notes.trim(),
    };
    let rec: InventoryItem;
    if (item) rec = { ...item, ...base, movements: item.movements ?? [] };
    else {
      const now = nowISO();
      const qty = d.quantity ?? 0;
      rec = {
        id: uid(),
        ...base,
        quantity: qty,
        movements: qty > 0 ? [{ id: uid(), at: now, delta: qty, reason: 'adjustment', note: t('inventory.initialStock'), by: user?.displayName || user?.username || '' }] : [],
        createdAt: now,
        updatedAt: now,
      };
    }
    const saved = await run(() => saveRecord('inventory', rec), t('common.saved'));
    if (saved) onClose();
  };

  const remove = async () => {
    if (!item) return;
    if (!(await confirm({ title: t('inventory.deleteTitle', { name: item.name }), body: t('inventory.deleteBody'), danger: true, confirm: t('common.delete') }))) return;
    const ok = await run(async () => {
      await deleteRecord('inventory', item.id);
      return true;
    }, t('common.deleted'));
    if (ok) onClose();
  };

  const sender = settings.company.name || user?.displayName || '';

  return (
    <Drawer
      wide
      title={item ? item.name : t('inventory.new')}
      sub={item ? [item.sku, t(`invcat.${item.category}`), item.location].filter(Boolean).join(' · ') : undefined}
      onClose={close}
      footer={
        <>
          {item && editable && (
            <button className="btn danger" onClick={remove}>
              <Trash2 /> {t('common.delete')}
            </button>
          )}
          {item && editable && (
            <a className="btn" href={reorderHref(item, supplier, t, fmt.num, sender)} title={supplier?.email ? supplier.email : t('inventory.noSupplierEmail')}>
              <ShoppingCart /> {t('inventory.reorder')}
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
      {item && (
        <div className="grid grid-3 mb-16">
          <Stat
            icon={<Boxes />}
            label={t('inventory.quantity')}
            value={
              <span>
                {fmt.num(item.quantity, 2)} <span className="small muted">{item.unit}</span>
              </span>
            }
            delta={<StockBadge item={item} />}
          />
          <Stat icon={<Coins />} label={t('inventory.stockValue')} value={fmt.money(item.quantity * item.cost)} delta={`${fmt.money(item.cost)} / ${item.unit}`} />
          <Stat
            icon={<ShoppingCart />}
            label={t('inventory.reorder')}
            value={
              <span>
                {fmt.num(suggestedReorder(item), 2)} <span className="small muted">{item.unit}</span>
              </span>
            }
            delta={t('inventory.reorderHint', { min: fmt.num(item.minQuantity, 2), unit: item.unit })}
          />
        </div>
      )}

      <Section icon={<Boxes />} title={t('inventory.details')}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-grid">
            <Field label={t('field.name')} required error={nameErr} className="full">
              <input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus={!item} />
            </Field>
            <Field label={t('inventory.category')}>
              <select className="select" value={d.category} onChange={(e) => set({ category: e.target.value as InventoryCategory })}>
                {INVENTORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`invcat.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('inventory.sku')} warning={skuWarn}>
              <input className="input mono" value={d.sku} onChange={(e) => set({ sku: e.target.value })} />
            </Field>
            {item ? (
              <Field label={t('inventory.quantity')} hint={t('inventory.quantityLocked')}>
                <input className="input" value={`${fmt.num(item.quantity, 3)} ${item.unit}`} readOnly disabled />
              </Field>
            ) : (
              <Field label={t('inventory.quantity')} hint={t('inventory.quantityHint')} error={numErr(d.quantity)}>
                <NumberInput value={d.quantity} onChange={(v) => set({ quantity: v })} min={0} />
              </Field>
            )}
            <Field label={t('inventory.unit')}>
              <input className="input" value={d.unit} onChange={(e) => set({ unit: e.target.value })} placeholder={t('inventory.unitPlaceholder')} />
            </Field>
            <Field label={t('inventory.minQuantity')} hint={t('inventory.minHint')} error={numErr(d.minQuantity)}>
              <NumberInput value={d.minQuantity} onChange={(v) => set({ minQuantity: v })} min={0} />
            </Field>
            <Field label={t('field.location')}>
              <input className="input" value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder={t('inventory.locationPlaceholder')} />
            </Field>
            <Field
              label={t('inventory.supplier')}
              hint={
                selectedSupplier ? (
                  <a href={`#/suppliers?supplier=${selectedSupplier.id}`}>{t('inventory.openSupplier')}</a>
                ) : undefined
              }
            >
              <select className="select" value={d.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
                <option value="">— {t('common.none')}</option>
                {sortedSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`${t('inventory.unitCost')} (${fmt.currency})`} error={numErr(d.cost)}>
              <NumberInput value={d.cost} onChange={(v) => set({ cost: v })} min={0} step={0.01} />
            </Field>
            <Field label={t('inventory.usage')} hint={t('inventory.usageHint')} error={numErr(d.usagePerPackage)} className="full">
              <NumberInput value={d.usagePerPackage} onChange={(v) => set({ usagePerPackage: v })} min={0} step={0.01} />
            </Field>
            <Field label={t('field.notes')} className="full">
              <textarea className="textarea" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>
        </fieldset>
      </Section>

      {item && editable && (
        <Section icon={<Scale />} title={t('inventory.adjust')}>
          <StockAdjust item={item} />
        </Section>
      )}

      {item && (
        <Section
          icon={<History />}
          title={t('inventory.history')}
          actions={
            can('audit.view') ? (
              <a className="btn ghost xs" href={`#/activity?entityId=${item.id}`}>
                {t('inventory.auditTrail')}
              </a>
            ) : undefined
          }
        >
          <MovementHistory item={item} />
        </Section>
      )}
    </Drawer>
  );
}

// ───────────── Page ─────────────

export function Inventory() {
  const { t } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const route = useRoute();
  const { can, user } = useSession();
  const run = useAction();
  const { confirm, contextMenu } = useFeedback();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const lowOnly = route.query.get('low') === '1';
  const itemId = route.query.get('item');
  const creating = route.query.get('new') === '1';
  const data = useLiveQuery(async () => ({ items: await db.inventory.toArray(), suppliers: await db.suppliers.toArray() }), []);
  const supplierMap = useMemo(() => new Map((data?.suppliers ?? []).map((s) => [s.id, s])), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    return data.items.filter((i) => {
      if (cat && i.category !== cat) return false;
      if (lowOnly && i.quantity > i.minQuantity) return false;
      if (n && !normalizeText(`${i.name} ${i.sku} ${i.location}`).includes(n)) return false;
      return true;
    });
  }, [data, q, cat, lowOnly]);
  if (!data) return null;

  const supplierOf = (i: InventoryItem) => (i.supplierId ? supplierMap.get(i.supplierId) : undefined);
  const low = data.items.filter((i) => i.quantity <= i.minQuantity);
  const out = data.items.filter((i) => i.quantity <= 0);
  const value = data.items.reduce((s, i) => s + i.quantity * i.cost, 0);
  let packages: number | undefined;
  let limiting: InventoryItem | undefined;
  for (const i of data.items) {
    if (!(i.usagePerPackage > 0)) continue;
    const n = Math.max(0, Math.floor(i.quantity / i.usagePerPackage + 1e-9));
    if (packages === undefined || n < packages) {
      packages = n;
      limiting = i;
    }
  }
  const current = itemId ? data.items.find((i) => i.id === itemId) : undefined;
  const sender = settings.company.name || user?.displayName || '';
  const catCount = (c: string) => data.items.filter((i) => i.category === c).length;

  const remove = async (i: InventoryItem) => {
    if (await confirm({ title: t('inventory.deleteTitle', { name: i.name }), body: t('inventory.deleteBody'), danger: true, confirm: t('common.delete') })) run(() => deleteRecord('inventory', i.id), t('common.deleted'));
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.warehouse')}
        title={t('nav.inventory')}
        sub={t('inventory.sub')}
        actions={
          <>
            <ExportMenu
              name={t('nav.inventory')}
              build={() => ({
                head: [t('inventory.item'), t('inventory.sku'), t('inventory.category'), t('inventory.quantity'), t('inventory.unit'), t('inventory.minQuantity'), t('inventory.stock'), t('field.location'), t('inventory.supplier'), t('inventory.unitCost'), t('inventory.stockValue'), t('inventory.usage'), t('field.notes')],
                rows: rows.map((i) => [
                  i.name,
                  i.sku,
                  t(`invcat.${i.category}`),
                  i.quantity,
                  i.unit,
                  i.minQuantity,
                  t(`inventory.status.${stockState(i)}`),
                  i.location,
                  supplierOf(i)?.name ?? '',
                  i.cost,
                  round3(i.quantity * i.cost),
                  i.usagePerPackage,
                  i.notes,
                ]),
              })}
            />
            {can('inventory.edit') && (
              <button className="btn primary" onClick={() => setQuery('new', '1')}>
                <Plus /> {t('inventory.new')}
              </button>
            )}
          </>
        }
      />

      <div className="grid mb-16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Stat icon={<Boxes />} label={t('inventory.kpi.items')} value={fmt.num(data.items.length)} delta={t('inventory.kpi.categories', { count: new Set(data.items.map((i) => i.category)).size })} />
        <Stat
          icon={<TriangleAlert />}
          label={t('inventory.kpi.lowStock')}
          value={fmt.num(low.length)}
          delta={low.length ? t('inventory.kpi.lowDelta') : t('inventory.kpi.allStocked')}
          tone={low.length ? 'down' : 'up'}
          href="#/inventory?low=1"
        />
        <Stat icon={<PackageX />} label={t('inventory.kpi.outOfStock')} value={fmt.num(out.length)} delta={out.length ? out.map((i) => i.name).slice(0, 2).join(', ') + (out.length > 2 ? '…' : '') : undefined} tone={out.length ? 'down' : undefined} />
        <Stat icon={<Coins />} label={t('inventory.kpi.value')} value={fmt.money(value)} delta={t('inventory.kpi.valueDelta')} />
        <Stat
          icon={<PackageCheck />}
          label={t('inventory.kpi.packages')}
          value={packages === undefined ? '—' : fmt.num(packages)}
          delta={limiting ? t('inventory.kpi.limitedBy', { item: limiting.name }) : t('inventory.kpi.noUsage')}
          tone={packages === 0 ? 'down' : undefined}
          href={limiting ? `#/inventory?item=${limiting.id}` : undefined}
        />
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('inventory.search')} />
        <select className="select" style={{ width: 220 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('inventory.category')}>
          <option value="">
            {t('inventory.category')}: {t('common.all')}
          </option>
          {INVENTORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`invcat.${c}`)} ({catCount(c)})
            </option>
          ))}
        </select>
        <Toggle checked={lowOnly} onChange={(v) => setQuery('low', v ? '1' : null)} label={t('inventory.lowOnly')} />
        {(q || cat || lowOnly) && (
          <button
            className="btn ghost sm"
            onClick={() => {
              setQ('');
              setCat('');
              setQuery('low', null);
            }}
          >
            {t('common.clearFilters')}
          </button>
        )}
      </div>

      <DataTable
        rows={rows}
        rowKey={(i) => i.id}
        onRowClick={(i) => setQuery('item', i.id)}
        initialSort={{ key: 'name', dir: 'asc' }}
        onContextMenu={(i, e) =>
          contextMenu(e, [
            { label: t('common.open'), icon: <Eye />, onClick: () => setQuery('item', i.id) },
            ...(can('inventory.edit')
              ? [
                  {
                    label: t('inventory.reorder'),
                    icon: <ShoppingCart />,
                    onClick: () => {
                      window.location.href = reorderHref(i, supplierOf(i), t, fmt.num, sender);
                    },
                  },
                  { divider: true, label: '' },
                  { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => remove(i) },
                ]
              : []),
          ])
        }
        columns={[
          {
            key: 'name',
            header: t('inventory.item'),
            render: (i) => (
              <div style={{ minWidth: 160 }}>
                <b>{i.name}</b>
                {i.notes && <div className="tiny muted truncate" style={{ maxWidth: 260 }}>{i.notes}</div>}
              </div>
            ),
            sort: (i) => i.name.toLowerCase(),
          },
          { key: 'sku', header: t('inventory.sku'), render: (i) => <span className="mono">{i.sku || '—'}</span>, sort: (i) => i.sku },
          { key: 'cat', header: t('inventory.category'), render: (i) => <span className="small">{t(`invcat.${i.category}`)}</span>, sort: (i) => INVENTORY_CATEGORIES.indexOf(i.category) },
          {
            key: 'qty',
            header: t('inventory.quantity'),
            render: (i) => (
              <div style={{ minWidth: 110 }}>
                <div className="num">
                  <b>{fmt.num(i.quantity, 2)}</b> <span className="muted small">{i.unit}</span>
                </div>
                <Progress value={stockPct(i)} />
              </div>
            ),
            sort: (i) => i.quantity,
          },
          { key: 'min', header: t('inventory.minQuantity'), render: (i) => fmt.num(i.minQuantity, 2), sort: (i) => i.minQuantity, className: 'num right' },
          { key: 'stock', header: t('inventory.stock'), render: (i) => <StockBadge item={i} />, sort: (i) => (i.minQuantity > 0 ? i.quantity / i.minQuantity : i.quantity > 0 ? 1e9 : 0) },
          { key: 'loc', header: t('field.location'), render: (i) => <span className="small">{i.location || '—'}</span>, sort: (i) => i.location },
          {
            key: 'sup',
            header: t('inventory.supplier'),
            render: (i) => {
              const s = supplierOf(i);
              return s ? (
                <a href={`#/suppliers?supplier=${s.id}`} onClick={(e) => e.stopPropagation()} className="small">
                  {s.name}
                </a>
              ) : (
                <span className="muted">—</span>
              );
            },
            sort: (i) => supplierOf(i)?.name ?? '',
          },
          { key: 'cost', header: t('inventory.unitCost'), render: (i) => fmt.money(i.cost), sort: (i) => i.cost, className: 'num right' },
          { key: 'value', header: t('inventory.stockValue'), render: (i) => fmt.money(i.quantity * i.cost), sort: (i) => i.quantity * i.cost, className: 'num right' },
          { key: 'usage', header: t('inventory.usage'), render: (i) => (i.usagePerPackage > 0 ? `${fmt.num(i.usagePerPackage, 3)} ${i.unit}` : '—'), sort: (i) => i.usagePerPackage, className: 'num right' },
        ]}
        empty={
          data.items.length ? undefined : (
            <EmptyState
              icon={<Boxes />}
              title={t('inventory.empty')}
              text={t('inventory.emptyText')}
              action={
                can('inventory.edit') ? (
                  <button className="btn primary" onClick={() => setQuery('new', '1')}>
                    <Plus /> {t('inventory.new')}
                  </button>
                ) : undefined
              }
            />
          )
        }
      />

      {creating && can('inventory.edit') && (
        <ItemDrawer
          items={data.items}
          suppliers={data.suppliers}
          prefillSupplier={route.query.get('supplier') ?? undefined}
          onClose={() => {
            setQuery('new', null);
            setQuery('supplier', null);
          }}
        />
      )}
      {!creating && current && <ItemDrawer key={current.id} item={current} items={data.items} suppliers={data.suppliers} onClose={() => setQuery('item', null)} />}
    </div>
  );
}
