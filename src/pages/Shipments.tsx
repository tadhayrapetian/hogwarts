import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Download, ExternalLink, Eye, MessageSquarePlus, Package, Plus, Printer, Trash2, Truck, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { countryName, formatAddressLines, isAddressComplete } from '../core/countries';
import { nextShipmentStatus } from '../core/orders';
import { buildContext } from '../core/template';
import { SHIPMENT_STATUSES, type Carrier, type Lang, type Layout, type Order, type Project, type Recipient, type Shipment, type ShipmentStatus } from '../core/types';
import { addDays, normalizeText, nowISO, todayISO, toISODate } from '../core/util';
import { db } from '../db/db';
import { createShipment, deleteShipment, setShipmentStatus, updateShipment } from '../db/services';
import { useFmt, useLib, useSettings } from '../app/data';
import { useAction, useFeedback } from '../app/feedback';
import { setQuery, useRoute } from '../app/router';
import { useSession } from '../app/session';
import { useI18n } from '../i18n';
import type { RenderCtx, RenderLib } from '../render/context';
import { addressLabelLayout } from '../render/elements';
import { exportSingle, printPages } from '../render/export';
import type { PrintPage } from '../render/imposition';
import { LayoutContent, LayoutSVG } from '../render/LayoutSVG';
import { LayoutView } from '../ui/art';
import { Badge, DataTable, Drawer, EmptyState, Field, Modal, NumberInput, PageHeader, SearchInput, Stat, StatusBadge, Tabs } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';

const LABEL_W = 100;
const LABEL_H = 62;
const MOVING: ShipmentStatus[] = ['shipped', 'in_transit', 'out_for_delivery'];
const AWAITING: ShipmentStatus[] = ['preparing', 'label_created'];

function trackingHref(carrier: Carrier | undefined, tracking: string): string | undefined {
  const code = tracking.trim();
  if (!carrier?.trackingUrl || !code) return undefined;
  const url = carrier.trackingUrl.split('{tracking}').join(encodeURIComponent(code));
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function isOverdue(s: Shipment, today: string): boolean {
  return !!s.estimatedDelivery && s.estimatedDelivery < today && s.status !== 'delivered' && s.status !== 'returned';
}

/** Render context for an address label: variables from the recipient, address from the shipment snapshot. */
function labelCtx(s: Shipment, recipient: Recipient | undefined, order: Order | undefined, lib: RenderLib, lang: Lang, locale: string): RenderCtx {
  const house = recipient?.houseId ? lib.houses.get(recipient.houseId) : undefined;
  const vars = buildContext({ recipient, house, settings: lib.settings, shipment: s, order, lang });
  const a = s.address;
  if (a && (a.line1 || a.city)) {
    Object.assign(vars, {
      address_block: formatAddressLines(a, s.recipientName || vars.full_name, lang).join('\n'),
      address_line: [a.line1, a.line2].filter(Boolean).join(', '),
      city: a.city,
      region: a.region,
      postal_code: a.postalCode,
      country: countryName(a.country, lang),
    });
  }
  if (!vars.full_name) vars.full_name = s.recipientName;
  if (!vars.tracking_number) vars.tracking_number = s.code;
  return { vars, lib, refs: { houseId: recipient?.houseId }, idPrefix: `lbl${s.id.slice(0, 8)}`, locale };
}

function labelPages(items: { s: Shipment; ctx: RenderCtx }[], layout: Layout): PrintPage[] {
  return items.map(({ s, ctx }) => ({
    section: 'label',
    title: 'label',
    w: LABEL_W,
    h: LABEL_H,
    placements: [
      {
        item: { id: s.id, label: s.code, w: LABEL_W, h: LABEL_H, render: (uid: string) => <LayoutContent layout={layout} ctx={{ ...ctx, idPrefix: uid }} /> },
        x: 0,
        y: 0,
        w: LABEL_W,
        h: LABEL_H,
        rotated: false,
      },
    ],
    marks: { crop: false, cut: false, fold: false, safe: false, bleed: 0 },
  }));
}

function useLabelLayout(): Layout {
  const settings = useSettings();
  return useMemo(() => addressLabelLayout(LABEL_W, LABEL_H, { returnLine: settings.mail.returnAddress, barcode: true }), [settings.mail.returnAddress]);
}

// ───────────── New shipment ─────────────

function NewShipmentModal({ onClose }: { onClose: () => void }) {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const run = useAction();
  const [tab, setTab] = useState<'projects' | 'orders'>('projects');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ kind: 'project' | 'order'; id: string } | null>(null);
  const data = useLiveQuery(
    async () => ({
      projects: await db.projects.where('status').equals('active').toArray(),
      orders: await db.orders.toArray(),
      shipments: await db.shipments.toArray(),
      recipients: await db.recipients.toArray(),
    }),
    [],
  );
  const lists = useMemo(() => {
    if (!data) return undefined;
    const shippedProjects = new Set(data.shipments.map((s) => s.projectId).filter(Boolean));
    const shippedOrders = new Set(data.shipments.map((s) => s.orderId).filter(Boolean));
    const rmap = new Map(data.recipients.map((r) => [r.id, r]));
    const rName = (id?: string) => {
      const r = id ? rmap.get(id) : undefined;
      return r ? `${r.firstName} ${r.lastName}` : '';
    };
    const n = normalizeText(q);
    const projects = data.projects
      .filter((p) => (p.stage === 'packed' || p.stage === 'ready') && !shippedProjects.has(p.id))
      .filter((p) => !n || normalizeText(`${p.code} ${p.name} ${rName(p.recipientId)}`).includes(n));
    const orders = data.orders
      .filter((o) => !['cancelled', 'archived', 'delivered', 'shipped'].includes(o.status) && !shippedOrders.has(o.id))
      .filter((o) => !n || normalizeText(`${o.number} ${rName(o.recipientId)}`).includes(n))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const orderProject = (orderId: string): Project | undefined => data.projects.find((p) => p.orderId === orderId && !shippedProjects.has(p.id));
    return { projects, orders, rName, orderProject };
  }, [data, q]);
  if (!lists) return null;
  const create = async () => {
    if (!pick) return;
    const s = await run(
      () => (pick.kind === 'project' ? createShipment({ projectId: pick.id }) : createShipment({ orderId: pick.id, projectId: lists.orderProject(pick.id)?.id })),
      t('shipment.created'),
    );
    if (s) {
      onClose();
      setQuery('id', s.id);
    }
  };
  const radio = (kind: 'project' | 'order', id: string) => (
    <input type="radio" name="new-shipment" checked={pick?.kind === kind && pick.id === id} onChange={() => setPick({ kind, id })} />
  );
  return (
    <Modal
      title={t('shipment.new')}
      sub={t('shipment.newSub')}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!pick} onClick={create}>
            <Truck /> {t('shipment.create')}
          </button>
        </>
      }
    >
      <Tabs
        tabs={[
          { key: 'projects', label: t('shipment.readyProjects'), count: lists.projects.length },
          { key: 'orders', label: t('shipment.openOrders'), count: lists.orders.length },
        ]}
        value={tab}
        onChange={(k) => setTab(k as 'projects' | 'orders')}
      />
      <div className="mb-16">
        <SearchInput value={q} onChange={setQ} placeholder={t('common.search')} />
      </div>
      <div className="list" style={{ maxHeight: 380, overflowY: 'auto' }}>
        {tab === 'projects' &&
          lists.projects.map((p) => (
            <label key={p.id} className="list-item" style={{ cursor: 'pointer' }}>
              {radio('project', p.id)}
              <div className="grow">
                <b>{lists.rName(p.recipientId) || p.name}</b>
                <div className="muted small truncate">
                  <span className="mono">{p.code}</span> · {p.name.split(' — ')[0]}
                </div>
              </div>
              <StatusBadge group="stage" value={p.stage} />
            </label>
          ))}
        {tab === 'orders' &&
          lists.orders.map((o) => (
            <label key={o.id} className="list-item" style={{ cursor: 'pointer' }}>
              {radio('order', o.id)}
              <div className="grow">
                <b>{lists.rName(o.recipientId) || '—'}</b>
                <div className="muted small truncate">
                  <span className="mono">{o.number}</span> · {fmt.date(o.createdAt)} · {o.items.map((i) => i.name).join(', ')}
                </div>
              </div>
              <Badge tone="neutral">{tEnum('order', o.status)}</Badge>
            </label>
          ))}
        {(tab === 'projects' ? lists.projects : lists.orders).length === 0 && <EmptyState icon={<Package />} title={t('shipment.noCandidates')} />}
      </div>
    </Modal>
  );
}

// ───────────── Detail drawer ─────────────

interface Draft {
  carrierId: string;
  service: string;
  trackingNumber: string;
  shippingDate: string;
  estimatedDelivery: string;
  cost: number;
  weight: number;
  notes: string;
}

const toDraft = (s: Shipment): Draft => ({
  carrierId: s.carrierId ?? '',
  service: s.service ?? '',
  trackingNumber: s.trackingNumber ?? '',
  shippingDate: s.shippingDate ?? '',
  estimatedDelivery: s.estimatedDelivery ?? '',
  cost: s.cost ?? 0,
  weight: s.weight ?? 0,
  notes: s.notes ?? '',
});

type DrawerData = { s: null } | { s: Shipment; order?: Order; recipient?: Recipient; project?: Project };

function ShipmentDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, tEnum, lang, locale } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const lib = useLib();
  const { can, user } = useSession();
  const run = useAction();
  const { confirm, prompt } = useFeedback();
  const layout = useLabelLayout();
  const [changes, setChanges] = useState<Partial<Draft>>({});
  const data = useLiveQuery(async (): Promise<DrawerData> => {
    const s = await db.shipments.get(id);
    if (!s) return { s: null };
    const [order, recipient, project] = await Promise.all([
      s.orderId ? db.orders.get(s.orderId) : undefined,
      s.recipientId ? db.recipients.get(s.recipientId) : undefined,
      s.projectId ? db.projects.get(s.projectId) : undefined,
    ]);
    return { s, order, recipient, project };
  }, [id]);
  const ctx = useMemo(() => (data?.s ? labelCtx(data.s, data.recipient, data.order, lib, lang, locale) : undefined), [data, lib, lang, locale]);
  if (!data) return null;
  if (!data.s)
    return (
      <Drawer title={t('shipment.notFound')} onClose={onClose}>
        <EmptyState icon={<Truck />} title={t('shipment.notFound')} />
      </Drawer>
    );
  const { s, order, recipient, project } = data;
  const editable = can('shipping.edit');
  const canPrint = can('print') || editable;
  const base = toDraft(s);
  const d: Draft = { ...base, ...changes };
  const dirty = (Object.keys(changes) as (keyof Draft)[]).some((k) => changes[k] !== base[k]);
  const set = (p: Partial<Draft>) => setChanges((c) => ({ ...c, ...p }));
  const carrier = settings.carriers.find((c) => c.id === d.carrierId);
  const carrierOptions = settings.carriers.filter((c) => c.active || c.id === d.carrierId);
  const services = carrier?.services ?? [];
  const next = nextShipmentStatus(s.status);
  const today = todayISO();
  const overdue = isOverdue(s, today);
  const trackUrl = trackingHref(settings.carriers.find((c) => c.id === s.carrierId), s.trackingNumber);
  const addressLines = formatAddressLines(s.address, s.recipientName, lang);

  const save = async () => {
    const patch: Partial<Shipment> = {};
    if ('carrierId' in changes) patch.carrierId = d.carrierId;
    if ('service' in changes) patch.service = d.service;
    if ('trackingNumber' in changes) patch.trackingNumber = d.trackingNumber.trim();
    if ('shippingDate' in changes) patch.shippingDate = d.shippingDate || undefined;
    if ('estimatedDelivery' in changes) patch.estimatedDelivery = d.estimatedDelivery || undefined;
    if ('cost' in changes) patch.cost = d.cost;
    if ('weight' in changes) patch.weight = d.weight;
    if ('notes' in changes) patch.notes = d.notes;
    const ok = await run(async () => {
      await updateShipment(s.id, patch);
      if (s.status === 'preparing' && !s.trackingNumber && patch.trackingNumber) await setShipmentStatus([s.id], 'label_created');
      return true;
    }, t('common.saved'));
    if (ok) setChanges({});
  };
  const addNote = async () => {
    const note = await prompt({ title: t('shipment.addNote'), label: t('shipment.note') });
    if (!note?.trim()) return;
    await run(async () => {
      const cur = await db.shipments.get(s.id);
      if (!cur) return;
      await updateShipment(s.id, { events: [...cur.events, { status: cur.status, at: nowISO(), by: user?.displayName ?? '', note: note.trim() }] });
    }, t('shipment.noteAdded'));
  };
  const markReturned = async () => {
    const note = await prompt({ title: t('shipment.markReturned'), label: t('shipment.returnReason') });
    if (note === null) return;
    await run(() => setShipmentStatus([s.id], 'returned', note.trim()), t('common.saved'));
  };
  const printLabel = () => ctx && run(() => printPages(labelPages([{ s, ctx }], layout)));
  const downloadLabel = () =>
    ctx &&
    run(
      () => exportSingle(<LayoutSVG layout={layout} ctx={{ ...ctx, idPrefix: 'lblpdf' }} width={`${LABEL_W}mm`} height={`${LABEL_H}mm`} />, LABEL_W, LABEL_H, 'pdf', 300, `label-${s.code}`),
      t('common.exported'),
    );
  const remove = async () => {
    if (!(await confirm({ title: t('shipment.deleteTitle', { code: s.code }), body: t('shipment.deleteBody'), danger: true, confirm: t('common.delete') }))) return;
    const ok = await run(() => deleteShipment(s.id).then(() => true), t('common.deleted'));
    if (ok) onClose();
  };

  return (
    <Drawer
      wide
      title={
        <span className="row wrap">
          <span className="mono" style={{ fontSize: 20 }}>{s.code}</span>
          <StatusBadge group="shipment" value={s.status} />
        </span>
      }
      sub={[s.recipientName, carrier?.name ?? s.carrierId, s.service].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <>
          {editable && (
            <button className="btn danger" onClick={remove}>
              <Trash2 /> {t('common.delete')}
            </button>
          )}
          <span className="grow" />
          {dirty && (
            <button className="btn" onClick={() => setChanges({})}>
              {t('common.cancel')}
            </button>
          )}
          {editable && (
            <button className="btn primary" disabled={!dirty} onClick={save}>
              {t('common.save')}
            </button>
          )}
        </>
      }
    >
      {overdue && (
        <div className="issue error mb-16">
          <AlertTriangle /> {t('shipment.overdueSince', { date: fmt.date(s.estimatedDelivery) })}
        </div>
      )}
      {editable && (
        <div className="row wrap mb-16">
          {next && (
            <button className="btn primary" onClick={() => run(() => setShipmentStatus([s.id], next), t('common.saved'))}>
              <ArrowRight /> {t('shipment.advance', { status: tEnum('shipment', next) })}
            </button>
          )}
          {s.status !== 'returned' && (
            <button className="btn danger" onClick={markReturned}>
              <Undo2 /> {t('shipment.markReturned')}
            </button>
          )}
          <button className="btn" onClick={addNote}>
            <MessageSquarePlus /> {t('shipment.addNote')}
          </button>
          <select
            className="select sm"
            style={{ width: 190 }}
            value=""
            aria-label={t('shipment.setStatus')}
            onChange={(e) => e.target.value && run(() => setShipmentStatus([s.id], e.target.value as ShipmentStatus), t('common.saved'))}
          >
            <option value="">{t('shipment.setStatus')}…</option>
            {SHIPMENT_STATUSES.filter((x) => x !== s.status).map((x) => (
              <option key={x} value={x}>
                {tEnum('shipment', x)}
              </option>
            ))}
          </select>
        </div>
      )}

      <h4 className="mb-8">{t('shipment.details')}</h4>
      <div className="form-grid mb-16">
        <Field label={t('shipment.carrier')}>
          <select
            className="select"
            disabled={!editable}
            value={d.carrierId}
            onChange={(e) => {
              const c = settings.carriers.find((x) => x.id === e.target.value);
              set({ carrierId: e.target.value, service: c?.services.includes(d.service) ? d.service : '' });
            }}
          >
            <option value="">—</option>
            {carrierOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {d.carrierId && !settings.carriers.some((c) => c.id === d.carrierId) && <option value={d.carrierId}>{d.carrierId}</option>}
          </select>
        </Field>
        <Field label={t('shipment.service')}>
          {services.length ? (
            <select className="select" disabled={!editable} value={d.service} onChange={(e) => set({ service: e.target.value })}>
              <option value="">—</option>
              {services.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
              {d.service && !services.includes(d.service) && <option value={d.service}>{d.service}</option>}
            </select>
          ) : (
            <input className="input" disabled={!editable} value={d.service} onChange={(e) => set({ service: e.target.value })} />
          )}
        </Field>
        <Field
          label={t('order.tracking')}
          className="full"
          hint={
            trackUrl ? (
              <a href={trackUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> {t('shipment.trackOn', { carrier: carrier?.name ?? '' })}
              </a>
            ) : undefined
          }
        >
          <input className="input mono" disabled={!editable} value={d.trackingNumber} onChange={(e) => set({ trackingNumber: e.target.value })} />
        </Field>
        <Field label={t('shipment.shippingDate')}>
          <input className="input" type="date" disabled={!editable} value={d.shippingDate} onChange={(e) => set({ shippingDate: e.target.value })} />
        </Field>
        <Field label={t('shipment.estimatedDelivery')}>
          <input className="input" type="date" disabled={!editable} value={d.estimatedDelivery} onChange={(e) => set({ estimatedDelivery: e.target.value })} />
        </Field>
        <Field label={`${t('shipment.cost')} (${fmt.currency})`} hint={d.cost ? fmt.money(d.cost) : undefined}>
          {editable ? <NumberInput value={d.cost} min={0} step={0.01} onChange={(v) => set({ cost: v ?? 0 })} /> : <input className="input" disabled value={fmt.money(d.cost)} />}
        </Field>
        <Field label={t('shipment.weight')}>
          {editable ? <NumberInput value={d.weight} min={0} step={1} onChange={(v) => set({ weight: v ?? 0 })} /> : <input className="input" disabled value={fmt.num(d.weight)} />}
        </Field>
        <Field label={t('field.notes')} className="full">
          <textarea className="textarea" rows={2} disabled={!editable} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </div>

      <div className="grid grid-2 mb-16">
        <div>
          <h4 className="mb-8">{t('project.shipTo')}</h4>
          <div className="card card-body" style={{ whiteSpace: 'pre-line', lineHeight: 1.45 }}>
            {addressLines.join('\n') || '—'}
          </div>
          {!isAddressComplete(s.address) && (
            <div className="issue warning mt-8">
              <AlertTriangle /> {t('shipment.addressIncomplete')}
            </div>
          )}
          {recipient?.deliveryInstructions && (
            <div className="small mt-8">
              <b>{t('field.deliveryInstructions')}:</b> {recipient.deliveryInstructions}
            </div>
          )}
          <div className="muted tiny mt-8">{t('shipment.addressSnapshot')}</div>
        </div>
        <div>
          <h4 className="mb-8">{t('shipment.label')}</h4>
          {ctx && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: '#fff', maxWidth: 360 }}>
              <LayoutView layout={layout} ctx={ctx} width="100%" />
            </div>
          )}
          {canPrint && (
            <div className="row wrap mt-8">
              <button className="btn sm primary" onClick={printLabel}>
                <Printer /> {t('shipment.printLabel')}
              </button>
              <button className="btn sm" onClick={downloadLabel}>
                <Download /> PDF
              </button>
            </div>
          )}
        </div>
      </div>

      <h4 className="mb-8">{t('shipment.links')}</h4>
      <div className="list mb-16">
        {project ? (
          <a className="list-item" href={`#/projects/${project.id}`}>
            <span className="muted small" style={{ width: 90 }}>{t('shipment.project')}</span>
            <span className="mono">{project.code}</span>
            <span className="grow truncate">{project.name}</span>
            <StatusBadge group="stage" value={project.stage} />
          </a>
        ) : null}
        {order ? (
          <a className="list-item" href={`#/orders/${order.id}`}>
            <span className="muted small" style={{ width: 90 }}>{t('shipment.order')}</span>
            <span className="mono">{order.number}</span>
            <span className="grow" />
            <StatusBadge group="order" value={order.status} />
          </a>
        ) : null}
        {s.recipientId ? (
          <a className="list-item" href={`#/recipients/${s.recipientId}`}>
            <span className="muted small" style={{ width: 90 }}>{t('shipment.recipient')}</span>
            <b className="grow">{recipient ? `${recipient.firstName} ${recipient.lastName}` : s.recipientName}</b>
            {recipient && <span className="muted small">#{recipient.code}</span>}
          </a>
        ) : null}
        {!project && !order && !s.recipientId && <div className="muted small">—</div>}
      </div>

      <h4 className="mb-8">{t('shipment.events')}</h4>
      <div className="timeline">
        {[...s.events].reverse().map((e, i) => (
          <div key={i} className={`tl-item ${e.status === 'returned' ? 'danger' : i === 0 ? '' : 'done'}`}>
            <div className="row wrap">
              <StatusBadge group="shipment" value={e.status} />
              <span className="when">
                {fmt.dateTime(e.at)}
                {e.by ? ` · ${e.by}` : ''}
              </span>
            </div>
            {e.note && <div className="small mt-8">{e.note}</div>}
          </div>
        ))}
      </div>
      <div className="muted tiny mt-8">
        {t('common.created')}: {fmt.dateTime(s.createdAt)}
        {s.deliveredAt ? ` · ${tEnum('shipment', 'delivered')}: ${fmt.dateTime(s.deliveredAt)}` : ''}
      </div>
    </Drawer>
  );
}

// ───────────── Register ─────────────

export function Shipments() {
  const { t, tEnum, lang, locale } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const lib = useLib();
  const route = useRoute();
  const { can } = useSession();
  const run = useAction();
  const { confirm, contextMenu } = useFeedback();
  const layout = useLabelLayout();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(route.query.get('status') ?? '');
  const [carrier, setCarrier] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const openId = route.query.get('id');
  const data = useLiveQuery(
    async () => ({
      shipments: await db.shipments.toArray(),
      orders: await db.orders.toArray(),
      recipients: await db.recipients.toArray(),
    }),
    [],
  );
  const maps = useMemo(
    () => (data ? { orders: new Map(data.orders.map((o) => [o.id, o])), recipients: new Map(data.recipients.map((r) => [r.id, r])) } : undefined),
    [data],
  );
  const today = todayISO();
  const rows = useMemo(() => {
    if (!data || !maps) return [];
    const n = normalizeText(q);
    return data.shipments.filter((s) => {
      if (status === 'overdue' ? !isOverdue(s, today) : status && s.status !== status) return false;
      if (carrier && s.carrierId !== carrier) return false;
      if (from && (!s.shippingDate || s.shippingDate < from)) return false;
      if (to && (!s.shippingDate || s.shippingDate > to)) return false;
      if (n) {
        const o = s.orderId ? maps.orders.get(s.orderId) : undefined;
        const r = s.recipientId ? maps.recipients.get(s.recipientId) : undefined;
        if (!normalizeText(`${s.code} ${s.trackingNumber} ${s.recipientName} ${r?.firstName ?? ''} ${r?.lastName ?? ''} ${o?.number ?? ''}`).includes(n)) return false;
      }
      return true;
    });
  }, [data, maps, q, status, carrier, from, to, today]);
  if (!data || !maps) return null;

  const carrierOf = (id: string) => settings.carriers.find((c) => c.id === id);
  const editable = can('shipping.edit');
  const canPrint = can('print') || editable;
  const orderNo = (s: Shipment) => (s.orderId ? maps.orders.get(s.orderId)?.number ?? '' : '');
  const destination = (s: Shipment) => [s.address.city, s.address.country ? countryName(s.address.country, lang) : ''].filter(Boolean).join(', ');
  const visibleIds = new Set(rows.map((r) => r.id));
  const sel = data.shipments.filter((s) => selected.has(s.id) && visibleIds.has(s.id));
  const monthAgo = toISODate(addDays(new Date(), -30));
  const kpi = {
    awaiting: data.shipments.filter((s) => AWAITING.includes(s.status)).length,
    moving: data.shipments.filter((s) => MOVING.includes(s.status)).length,
    overdue: data.shipments.filter((s) => isOverdue(s, today)).length,
    delivered: data.shipments.filter((s) => s.status === 'delivered' && (s.deliveredAt ?? s.updatedAt).slice(0, 10) >= monthAgo).length,
  };
  const countFor = (k: string) => (k === '' ? data.shipments.length : k === 'overdue' ? kpi.overdue : data.shipments.filter((s) => s.status === k).length);
  const filtered = !!(q || status || carrier || from || to);
  const clearFilters = () => {
    setQ('');
    setStatus('');
    setCarrier('');
    setFrom('');
    setTo('');
  };
  const printLabels = (list: Shipment[]) =>
    run(() =>
      printPages(
        labelPages(
          list.map((s) => ({ s, ctx: labelCtx(s, s.recipientId ? maps.recipients.get(s.recipientId) : undefined, s.orderId ? maps.orders.get(s.orderId) : undefined, lib, lang, locale) })),
          layout,
        ),
      ),
    );
  const removeMany = async (list: Shipment[]) => {
    if (!list.length) return;
    const ok = await confirm(
      list.length === 1
        ? { title: t('shipment.deleteTitle', { code: list[0].code }), body: t('shipment.deleteBody'), danger: true, confirm: t('common.delete') }
        : { title: t('shipment.bulkDeleteTitle', { count: list.length }), body: t('shipment.deleteBody'), danger: true, confirm: t('common.delete') },
    );
    if (!ok) return;
    await run(async () => {
      for (const s of list) await deleteShipment(s.id);
    }, t('common.deleted'));
    setSelected(new Set());
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.operations')}
        title={t('nav.shipments')}
        sub={t('shipment.sub', { count: rows.length })}
        actions={
          <>
            <ExportMenu
              name={t('nav.shipments')}
              build={() => ({
                head: [
                  t('shipment.id'),
                  t('shipment.order'),
                  t('shipment.recipient'),
                  t('field.address'),
                  t('field.city'),
                  t('field.country'),
                  t('shipment.carrier'),
                  t('shipment.service'),
                  t('order.tracking'),
                  t('shipment.shippingDate'),
                  t('shipment.estimatedDelivery'),
                  t('shipment.deliveredAt'),
                  t('field.status'),
                  t('shipment.cost'),
                  t('shipment.weight'),
                  t('field.notes'),
                ],
                rows: rows.map((s) => [
                  s.code,
                  orderNo(s),
                  s.recipientName,
                  formatAddressLines(s.address, s.recipientName, lang).slice(1).join(', '),
                  s.address.city,
                  s.address.country ? countryName(s.address.country, lang) : '',
                  carrierOf(s.carrierId)?.name ?? s.carrierId,
                  s.service,
                  s.trackingNumber,
                  s.shippingDate ?? '',
                  s.estimatedDelivery ?? '',
                  s.deliveredAt?.slice(0, 10) ?? '',
                  tEnum('shipment', s.status),
                  s.cost,
                  s.weight,
                  s.notes,
                ]),
              })}
            />
            {editable && (
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Plus /> {t('shipment.new')}
              </button>
            )}
          </>
        }
      />
      <div className="grid grid-4 mb-16">
        <Stat label={t('shipment.kpi.awaiting')} value={fmt.num(kpi.awaiting)} icon={<Package />} />
        <Stat label={t('shipment.kpi.moving')} value={fmt.num(kpi.moving)} icon={<Truck />} />
        <Stat label={t('shipment.overdue')} value={fmt.num(kpi.overdue)} icon={<Clock />} tone={kpi.overdue ? 'down' : undefined} delta={kpi.overdue ? t('shipment.kpi.overdueHint') : undefined} />
        <Stat label={t('shipment.kpi.delivered30')} value={fmt.num(kpi.delivered)} icon={<CheckCircle2 />} />
      </div>
      <div className="tabs pill mb-16" style={{ flexWrap: 'wrap' }}>
        {['', 'overdue', ...SHIPMENT_STATUSES].map((k) => (
          <button key={k || 'all'} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>
            {k === '' ? t('common.all') : k === 'overdue' ? t('shipment.overdue') : tEnum('shipment', k)}
            <span className="muted"> {countFor(k)}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('shipment.search')} />
        <select className="select" style={{ width: 200 }} value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label={t('shipment.carrier')}>
          <option value="">
            {t('shipment.carrier')}: {t('common.all')}
          </option>
          {settings.carriers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="row gap-4 small muted">
          {t('shipment.shippedFrom')}
          <input className="input" type="date" style={{ width: 150 }} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="row gap-4 small muted">
          {t('shipment.shippedTo')}
          <input className="input" type="date" style={{ width: 150 }} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filtered && (
          <button className="btn ghost sm" onClick={clearFilters}>
            {t('common.clearFilters')}
          </button>
        )}
      </div>
      {sel.length > 0 && (editable || canPrint) && (
        <div className="bulkbar">
          <b>{t('common.selected', { count: sel.length })}</b>
          {editable && (
            <select
              className="select sm"
              style={{ width: 200 }}
              value=""
              aria-label={t('shipment.setStatus')}
              onChange={async (e) => {
                const v = e.target.value as ShipmentStatus;
                if (!v) return;
                await run(() => setShipmentStatus(sel.map((s) => s.id), v), t('common.saved'));
                setSelected(new Set());
              }}
            >
              <option value="">{t('shipment.setStatus')}…</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tEnum('shipment', s)}
                </option>
              ))}
            </select>
          )}
          {canPrint && (
            <button className="btn sm" onClick={() => printLabels(sel)}>
              <Printer /> {t('shipment.printLabels', { count: sel.length })}
            </button>
          )}
          {editable && (
            <button className="btn sm danger" onClick={() => removeMany(sel)}>
              <Trash2 /> {t('common.delete')}
            </button>
          )}
          <span className="grow" />
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      )}
      <DataTable
        rows={rows}
        rowKey={(s) => s.id}
        selected={editable || canPrint ? selected : undefined}
        onSelect={setSelected}
        onRowClick={(s) => setQuery('id', s.id)}
        initialSort={{ key: 'created', dir: 'desc' }}
        onContextMenu={(s, e) => {
          const url = trackingHref(carrierOf(s.carrierId), s.trackingNumber);
          const next = nextShipmentStatus(s.status);
          contextMenu(e, [
            { label: t('common.open'), icon: <Eye />, onClick: () => setQuery('id', s.id) },
            ...(url ? [{ label: t('shipment.track'), icon: <ExternalLink />, onClick: () => window.open(url, '_blank', 'noopener,noreferrer') }] : []),
            ...(canPrint ? [{ label: t('shipment.printLabel'), icon: <Printer />, onClick: () => printLabels([s]) }] : []),
            ...(editable && next ? [{ label: t('shipment.advance', { status: tEnum('shipment', next) }), icon: <ArrowRight />, onClick: () => run(() => setShipmentStatus([s.id], next), t('common.saved')) }] : []),
            ...(editable ? [{ divider: true, label: '' }, { label: t('common.delete'), icon: <Trash2 />, danger: true, onClick: () => removeMany([s]) }] : []),
          ]);
        }}
        columns={[
          { key: 'code', header: t('shipment.id'), render: (s) => <span className="mono">{s.code}</span>, sort: (s) => s.code },
          {
            key: 'order',
            header: t('shipment.order'),
            render: (s) =>
              s.orderId && maps.orders.get(s.orderId) ? (
                <a className="mono" href={`#/orders/${s.orderId}`} onClick={(e) => e.stopPropagation()}>
                  {orderNo(s)}
                </a>
              ) : (
                '—'
              ),
            sort: (s) => orderNo(s),
          },
          {
            key: 'rec',
            header: t('shipment.recipient'),
            render: (s) =>
              s.recipientId && maps.recipients.has(s.recipientId) ? (
                <a href={`#/recipients/${s.recipientId}`} onClick={(e) => e.stopPropagation()}>
                  {s.recipientName || '—'}
                </a>
              ) : (
                s.recipientName || '—'
              ),
            sort: (s) => s.recipientName,
          },
          { key: 'dest', header: t('shipment.destination'), render: (s) => <span className="small">{destination(s) || '—'}</span>, sort: (s) => destination(s) },
          {
            key: 'carrier',
            header: t('shipment.carrier'),
            render: (s) => (
              <span>
                {carrierOf(s.carrierId)?.name ?? (s.carrierId || '—')}
                {s.service && <div className="muted tiny">{s.service}</div>}
              </span>
            ),
            sort: (s) => carrierOf(s.carrierId)?.name ?? s.carrierId,
          },
          {
            key: 'track',
            header: t('order.tracking'),
            render: (s) => {
              const url = trackingHref(carrierOf(s.carrierId), s.trackingNumber);
              return s.trackingNumber ? (
                <span className="row gap-4">
                  <span className="mono">{s.trackingNumber}</span>
                  {url && (
                    <a className="btn xs ghost" href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={t('shipment.track')}>
                      <ExternalLink /> {t('shipment.track')}
                    </a>
                  )}
                </span>
              ) : (
                <span className="muted">—</span>
              );
            },
            sort: (s) => s.trackingNumber,
          },
          { key: 'ship', header: t('shipment.shippingDate'), render: (s) => fmt.date(s.shippingDate) || '—', sort: (s) => s.shippingDate ?? '' },
          {
            key: 'eta',
            header: t('shipment.estimatedDelivery'),
            render: (s) =>
              s.estimatedDelivery ? (
                isOverdue(s, today) ? (
                  <Badge tone="danger" title={t('shipment.overdue')}>
                    <AlertTriangle /> {fmt.date(s.estimatedDelivery)}
                  </Badge>
                ) : (
                  fmt.date(s.estimatedDelivery)
                )
              ) : (
                '—'
              ),
            sort: (s) => s.estimatedDelivery ?? '',
          },
          { key: 'status', header: t('field.status'), render: (s) => <StatusBadge group="shipment" value={s.status} />, sort: (s) => SHIPMENT_STATUSES.indexOf(s.status) },
          { key: 'created', header: t('common.created'), render: (s) => <span className="small muted">{fmt.date(s.createdAt)}</span>, sort: (s) => s.createdAt },
        ]}
        empty={
          filtered ? (
            <EmptyState icon={<Truck />} title={t('common.noResults')} action={<button className="btn sm" onClick={clearFilters}>{t('common.clearFilters')}</button>} />
          ) : (
            <EmptyState
              icon={<Truck />}
              title={t('shipment.empty')}
              text={t('shipment.emptyHint')}
              action={
                editable && (
                  <button className="btn primary" onClick={() => setCreating(true)}>
                    <Plus /> {t('shipment.new')}
                  </button>
                )
              }
            />
          )
        }
      />
      {creating && <NewShipmentModal onClose={() => setCreating(false)} />}
      {openId && <ShipmentDrawer key={openId} id={openId} onClose={() => setQuery('id', null)} />}
    </div>
  );
}
