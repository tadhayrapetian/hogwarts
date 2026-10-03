import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Eye, Filter, GitMerge, Package, Pencil, Plus, ShoppingBag, Tag as TagIcon, Trash2, Upload, UserX, Users, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { countryName } from '../../core/countries';
import { findDuplicates } from '../../core/duplicates';
import { RECIPIENT_STATUSES, type Recipient } from '../../core/types';
import { ageFromDob, diffDays, normalizeText, parseISODate } from '../../core/util';
import { db } from '../../db/db';
import { anonymizeRecipient, bulkUpdateRecipients, deleteRecipient } from '../../db/services';
import { useFmt } from '../../app/data';
import { useAction, useFeedback } from '../../app/feedback';
import { navigate, setQuery, useRoute } from '../../app/router';
import { useSession } from '../../app/session';
import { useUI } from '../../app/ui';
import { useI18n } from '../../i18n';
import { HouseChip } from '../../ui/art';
import { DataTable, EmptyState, Field, PageHeader, SearchInput, StatusBadge, TagPill, type Column } from '../../ui/kit';
import { ExportMenu } from '../shared/ExportMenu';
import { RecipientForm } from './RecipientForm';

interface Filters {
  country: string;
  city: string;
  house: string;
  ageMin?: number;
  ageMax?: number;
  status: string;
  tag: string;
  addedFrom: string;
  addedTo: string;
  lastContact: string;
  orderStatus: string;
  mailStatus: string;
}

const EMPTY: Filters = { country: '', city: '', house: '', status: '', tag: '', addedFrom: '', addedTo: '', lastContact: '', orderStatus: '', mailStatus: '' };

export function Recipients() {
  const { t, tEnum, lang } = useI18n();
  const fmt = useFmt();
  const route = useRoute();
  const { can } = useSession();
  const ui = useUI();
  const run = useAction();
  const { confirm, contextMenu } = useFeedback();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const [f, setF] = useState<Filters>({ ...EMPTY, tag: route.query.get('tag') ?? '', status: route.query.get('status') ?? '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Recipient | null | undefined>(route.query.get('new') ? null : undefined);

  const data = useLiveQuery(async () => {
    const [recipients, houses, tags, orders, shipments, documents, decisions] = await Promise.all([
      db.recipients.toArray(),
      db.houses.toArray(),
      db.tags.toArray(),
      db.orders.toArray(),
      db.shipments.toArray(),
      db.documents.where('kind').equals('letter').toArray(),
      db.duplicateDecisions.toArray(),
    ]);
    return { recipients, houses, tags, orders, shipments, documents, decisions };
  }, []);

  const index = useMemo(() => {
    if (!data) return null;
    const ordersBy = new Map<string, typeof data.orders>();
    for (const o of data.orders) if (o.recipientId) (ordersBy.get(o.recipientId) ?? ordersBy.set(o.recipientId, []).get(o.recipientId)!).push(o);
    const shipBy = new Map<string, typeof data.shipments>();
    for (const s of data.shipments) if (s.recipientId) (shipBy.get(s.recipientId) ?? shipBy.set(s.recipientId, []).get(s.recipientId)!).push(s);
    const lettersBy = new Map<string, number>();
    for (const d of data.documents) if (d.recipientId && d.status !== 'void') lettersBy.set(d.recipientId, (lettersBy.get(d.recipientId) ?? 0) + 1);
    const tagName = new Map(data.tags.map((x) => [x.id, x.name]));
    const hay = new Map<string, string>();
    for (const r of data.recipients) {
      const a = r.addresses.map((x) => `${x.line1} ${x.line2} ${x.city} ${x.postalCode} ${x.region}`).join(' ');
      const os = (ordersBy.get(r.id) ?? []).map((o) => `${o.number} ${o.trackingNumber}`).join(' ');
      const ss = (shipBy.get(r.id) ?? []).map((s) => `${s.code} ${s.trackingNumber}`).join(' ');
      const tg = r.tagIds.map((id) => tagName.get(id)).join(' ');
      hay.set(
        r.id,
        normalizeText(`${r.firstName} ${r.lastName} ${r.preferredName} #${r.code} ${r.code} ${r.city} ${countryName(r.country, lang)} ${r.country} ${r.guardianEmail} ${r.guardianPhone} ${r.guardianName} ${a} ${os} ${ss} ${tg}`),
      );
    }
    const dupCount = findDuplicates(data.recipients.filter((r) => r.status !== 'anonymized'), new Set(data.decisions.map((d) => d.key))).length;
    return { ordersBy, shipBy, lettersBy, hay, dupCount };
  }, [data, lang]);

  const rows = useMemo(() => {
    if (!data || !index) return [];
    const n = normalizeText(q);
    const now = new Date();
    return data.recipients.filter((r) => {
      if (n && !n.split(' ').every((w) => index.hay.get(r.id)!.includes(w))) return false;
      if (f.country && r.country !== f.country) return false;
      if (f.city && normalizeText(r.city) !== normalizeText(f.city)) return false;
      if (f.house && (f.house === 'none' ? r.houseId : r.houseId !== f.house)) return false;
      const age = ageFromDob(r.dob) ?? r.age;
      if (f.ageMin !== undefined && (age === undefined || age < f.ageMin)) return false;
      if (f.ageMax !== undefined && (age === undefined || age > f.ageMax)) return false;
      if (f.status ? r.status !== f.status : r.status === 'anonymized') return false;
      if (f.tag && !r.tagIds.includes(f.tag)) return false;
      if (f.addedFrom && r.createdAt.slice(0, 10) < f.addedFrom) return false;
      if (f.addedTo && r.createdAt.slice(0, 10) > f.addedTo) return false;
      if (f.lastContact) {
        const lc = parseISODate(r.lastContactAt ?? '');
        const days = lc ? diffDays(now, lc) : Infinity;
        if (f.lastContact === 'never' && lc) return false;
        if (f.lastContact === '30' && days > 30) return false;
        if (f.lastContact === '90+' && days <= 90) return false;
      }
      if (f.orderStatus && !(index.ordersBy.get(r.id) ?? []).some((o) => o.status === f.orderStatus)) return false;
      if (f.mailStatus) {
        const ss = (index.shipBy.get(r.id) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (f.mailStatus === 'none' ? ss.length : ss[0]?.status !== f.mailStatus) return false;
      }
      return true;
    });
  }, [data, index, q, f]);

  if (!data || !index) return null;
  const houseOf = (id?: string) => data.houses.find((h) => h.id === id);
  const countries = Array.from(new Set(data.recipients.map((r) => r.country).filter(Boolean))).sort();
  const cities = Array.from(new Set(data.recipients.filter((r) => !f.country || r.country === f.country).map((r) => r.city).filter(Boolean))).sort();
  const activeFilters = Object.entries(f).filter(([, v]) => v !== '' && v !== undefined).length;

  const columns: Column<Recipient>[] = [
    { key: 'code', header: t('field.id'), render: (r) => <span className="mono">#{r.code}</span>, sort: (r) => r.code, width: 90 },
    {
      key: 'name',
      header: t('field.name'),
      render: (r) => (
        <div>
          <b>
            {r.firstName} {r.lastName}
          </b>
          {r.preferredName && <span className="muted small"> “{r.preferredName}”</span>}
          {r.guardianName && can('recipients.contact') && <div className="muted tiny">{r.guardianName}</div>}
        </div>
      ),
      sort: (r) => `${r.lastName} ${r.firstName}`,
    },
    { key: 'age', header: t('field.age'), render: (r) => ageFromDob(r.dob) ?? r.age ?? '—', sort: (r) => ageFromDob(r.dob) ?? r.age ?? -1, className: 'num' },
    {
      key: 'loc',
      header: t('field.location'),
      render: (r) => (
        <span>
          {r.city || '—'}
          <span className="muted small"> · {countryName(r.country, lang)}</span>
        </span>
      ),
      sort: (r) => `${r.country} ${r.city}`,
    },
    { key: 'house', header: t('field.house'), render: (r) => <HouseChip house={houseOf(r.houseId)} />, sort: (r) => houseOf(r.houseId)?.name ?? '' },
    { key: 'status', header: t('field.status'), render: (r) => <StatusBadge group="recipient" value={r.status} />, sort: (r) => r.status },
    {
      key: 'tags',
      header: t('field.tags'),
      render: (r) => (
        <div className="row wrap gap-4">
          {r.tagIds.slice(0, 3).map((id) => {
            const tag = data.tags.find((x) => x.id === id);
            return tag ? <TagPill key={id} name={tag.name} color={tag.color} /> : null;
          })}
          {r.tagIds.length > 3 && <span className="muted tiny">+{r.tagIds.length - 3}</span>}
        </div>
      ),
    },
    { key: 'letters', header: t('field.letters'), render: (r) => index.lettersBy.get(r.id) ?? 0, sort: (r) => index.lettersBy.get(r.id) ?? 0, className: 'num right' },
    { key: 'contact', header: t('field.lastContact'), render: (r) => <span className="small">{fmt.date(r.lastContactAt) || '—'}</span>, sort: (r) => r.lastContactAt ?? '' },
    { key: 'added', header: t('field.dateAdded'), render: (r) => <span className="small muted">{fmt.date(r.createdAt)}</span>, sort: (r) => r.createdAt },
  ];

  const sel = Array.from(selected);
  const bulkTag = async (tagId: string, add: boolean) => {
    await run(() => bulkUpdateRecipients(sel, (r) => ({ tagIds: add ? Array.from(new Set([...r.tagIds, tagId])) : r.tagIds.filter((x) => x !== tagId) }), add ? 'Added tag' : 'Removed tag'), t('common.saved'));
  };
  const bulkDelete = async () => {
    const ok = await confirm({ title: t('recipient.bulkDeleteTitle', { count: sel.length }), body: t('recipient.deleteBody'), danger: true, confirm: t('common.delete'), typeToConfirm: String(sel.length) });
    if (!ok) return;
    await run(async () => {
      for (const id of sel) await deleteRecipient(id, { deleteOrders: false });
    }, t('common.deleted'));
    setSelected(new Set());
  };
  const bulkAnonymize = async () => {
    const ok = await confirm({ title: t('recipient.bulkAnonTitle', { count: sel.length }), body: t('recipient.anonBody'), danger: true, confirm: t('recipient.anonymize') });
    if (!ok) return;
    await run(async () => {
      for (const id of sel) await anonymizeRecipient(id);
    }, t('recipient.anonymized'));
    setSelected(new Set());
  };

  const exportBuild = () => {
    const list = selected.size ? rows.filter((r) => selected.has(r.id)) : rows;
    const showContact = can('recipients.contact');
    const head = [t('field.id'), t('field.firstName'), t('field.lastName'), t('field.preferredName'), t('field.age'), t('field.birthday'), t('field.address'), t('field.apartment'), t('field.city'), t('field.region'), t('field.postalCode'), t('field.country'), t('field.house'), t('field.schoolYear'), t('field.petName'), t('field.owlName'), t('field.status'), t('field.tags'), ...(showContact ? [t('field.guardianName'), t('field.guardianEmail'), t('field.guardianPhone')] : [])];
    const out = list.map((r) => {
      const a = r.addresses.find((x) => x.id === r.defaultAddressId) ?? r.addresses[0];
      return [
        r.code,
        r.firstName,
        r.lastName,
        r.preferredName,
        ageFromDob(r.dob) ?? r.age ?? '',
        r.birthday ?? '',
        a?.line1 ?? '',
        a?.line2 ?? '',
        a?.city ?? '',
        a?.region ?? '',
        a?.postalCode ?? '',
        countryName(a?.country, lang),
        houseOf(r.houseId)?.name ?? '',
        r.schoolYear ?? '',
        r.petName,
        r.owlName,
        tEnum('recipient', r.status),
        r.tagIds.map((id) => data.tags.find((x) => x.id === id)?.name).filter(Boolean).join(', '),
        ...(showContact ? [r.guardianName, r.guardianEmail, r.guardianPhone] : []),
      ];
    });
    return { head, rows: out };
  };

  const onRowMenu = (r: Recipient, e: React.MouseEvent) =>
    contextMenu(e, [
      { label: t('common.open'), icon: <Eye />, onClick: () => navigate(`/recipients/${r.id}`) },
      ...(can('recipients.edit') ? [{ label: t('common.edit'), icon: <Pencil />, onClick: () => setEditing(r) }] : []),
      ...(can('orders.edit') ? [{ label: t('order.new'), icon: <ShoppingBag />, onClick: () => navigate(`/orders?new=1&recipient=${r.id}`) }] : []),
      ...(can('projects.edit') ? [{ label: t('package.create'), icon: <Wand2 />, onClick: () => ui.openPackageWizard({ recipientId: r.id }) }] : []),
      { label: t('common.copyId'), icon: <Copy />, onClick: () => navigator.clipboard?.writeText(`#${r.code}`) },
      ...(can('recipients.delete')
        ? [
            { divider: true, label: '' },
            {
              label: t('recipient.anonymize'),
              icon: <UserX />,
              danger: true,
              onClick: async () => {
                if (await confirm({ title: t('recipient.anonTitle'), body: t('recipient.anonBody'), danger: true, confirm: t('recipient.anonymize') })) run(() => anonymizeRecipient(r.id), t('recipient.anonymized'));
              },
            },
          ]
        : []),
    ]);

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.crm')}
        title={t('nav.recipients')}
        sub={t('recipient.count', { count: rows.length, total: data.recipients.filter((r) => r.status !== 'anonymized').length })}
        actions={
          <>
            {can('recipients.edit') && (
              <a className="btn" href="#/recipients/duplicates">
                <GitMerge /> {t('dup.title')}
                {index.dupCount > 0 && <span className="badge warning">{index.dupCount}</span>}
              </a>
            )}
            {can('data.import') && (
              <a className="btn" href="#/recipients/import">
                <Upload /> {t('common.import')}
              </a>
            )}
            <ExportMenu name={t('nav.recipients')} build={exportBuild} />
            {can('recipients.edit') && (
              <button className="btn primary" onClick={() => setEditing(null)}>
                <Plus /> {t('recipient.new')}
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => (setQ(v), setQuery('q', v))} placeholder={t('recipient.searchPlaceholder')} />
        <button className={`btn ${showFilters || activeFilters ? 'primary' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          <Filter /> {t('common.filters')} {activeFilters > 0 && `(${activeFilters})`}
        </button>
        {activeFilters > 0 && (
          <button className="btn ghost" onClick={() => setF(EMPTY)}>
            {t('common.clearFilters')}
          </button>
        )}
      </div>
      {showFilters && (
        <div className="filters">
          <Field label={t('field.country')}>
            <select className="select sm" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value, city: '' })}>
              <option value="">{t('common.all')}</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {countryName(c, lang)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.city')}>
            <select className="select sm" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
              <option value="">{t('common.all')}</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.house')}>
            <select className="select sm" value={f.house} onChange={(e) => setF({ ...f, house: e.target.value })}>
              <option value="">{t('common.all')}</option>
              {data.houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
              <option value="none">— {t('common.none')}</option>
            </select>
          </Field>
          <Field label={t('field.ageRange')}>
            <div className="row gap-4">
              <input className="input sm" style={{ width: 64 }} type="number" placeholder="min" value={f.ageMin ?? ''} onChange={(e) => setF({ ...f, ageMin: e.target.value === '' ? undefined : Number(e.target.value) })} />
              <input className="input sm" style={{ width: 64 }} type="number" placeholder="max" value={f.ageMax ?? ''} onChange={(e) => setF({ ...f, ageMax: e.target.value === '' ? undefined : Number(e.target.value) })} />
            </div>
          </Field>
          <Field label={t('field.status')}>
            <select className="select sm" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">{t('recipient.allButAnon')}</option>
              {RECIPIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tEnum('recipient', s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.tag')}>
            <select className="select sm" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}>
              <option value="">{t('common.all')}</option>
              {data.tags.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.dateAdded')}>
            <div className="row gap-4">
              <input className="input sm" type="date" value={f.addedFrom} onChange={(e) => setF({ ...f, addedFrom: e.target.value })} />
              <input className="input sm" type="date" value={f.addedTo} onChange={(e) => setF({ ...f, addedTo: e.target.value })} />
            </div>
          </Field>
          <Field label={t('field.lastContact')}>
            <select className="select sm" value={f.lastContact} onChange={(e) => setF({ ...f, lastContact: e.target.value })}>
              <option value="">{t('common.any')}</option>
              <option value="30">{t('filter.contact30')}</option>
              <option value="90+">{t('filter.contact90')}</option>
              <option value="never">{t('filter.never')}</option>
            </select>
          </Field>
          <Field label={t('field.orderStatus')}>
            <select className="select sm" value={f.orderStatus} onChange={(e) => setF({ ...f, orderStatus: e.target.value })}>
              <option value="">{t('common.any')}</option>
              {['new', 'confirmed', 'in_production', 'ready_to_print', 'printed', 'packed', 'shipped', 'delivered', 'cancelled'].map((s) => (
                <option key={s} value={s}>
                  {tEnum('order', s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('field.mailStatus')}>
            <select className="select sm" value={f.mailStatus} onChange={(e) => setF({ ...f, mailStatus: e.target.value })}>
              <option value="">{t('common.any')}</option>
              <option value="none">{t('filter.noShipments')}</option>
              {['preparing', 'label_created', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'returned'].map((s) => (
                <option key={s} value={s}>
                  {tEnum('shipment', s)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{t('common.selected', { count: selected.size })}</b>
          {can('projects.edit') && (
            <button className="btn sm primary" onClick={() => ui.openBulkWizard(sel)}>
              <Package /> {t('bulk.generateFor', { count: selected.size })}
            </button>
          )}
          {can('recipients.edit') && (
            <>
              <select className="select sm" style={{ width: 160 }} value="" onChange={(e) => e.target.value && bulkTag(e.target.value, true)}>
                <option value="">+ {t('tag.add')}</option>
                {data.tags.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <select className="select sm" style={{ width: 160 }} value="" onChange={(e) => e.target.value && bulkTag(e.target.value, false)}>
                <option value="">− {t('tag.remove')}</option>
                {data.tags.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <select
                className="select sm"
                style={{ width: 160 }}
                value=""
                onChange={(e) => e.target.value && run(() => bulkUpdateRecipients(sel, () => ({ status: e.target.value as Recipient['status'] }), `Status → ${e.target.value}`), t('common.saved'))}
              >
                <option value="">{t('field.status')}…</option>
                {RECIPIENT_STATUSES.filter((s) => s !== 'anonymized').map((s) => (
                  <option key={s} value={s}>
                    {tEnum('recipient', s)}
                  </option>
                ))}
              </select>
            </>
          )}
          <span className="grow" />
          {can('recipients.delete') && (
            <>
              <button className="btn sm danger" onClick={bulkAnonymize}>
                <UserX /> {t('recipient.anonymize')}
              </button>
              <button className="btn sm danger" onClick={bulkDelete}>
                <Trash2 /> {t('common.delete')}
              </button>
            </>
          )}
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      )}
      {data.recipients.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t('recipient.emptyTitle')}
          text={t('recipient.emptyText')}
          action={
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setEditing(null)}>
                <Plus /> {t('recipient.new')}
              </button>
              <a className="btn" href="#/recipients/import">
                <Upload /> {t('common.import')}
              </a>
            </div>
          }
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/recipients/${r.id}`)}
          selected={selected}
          onSelect={setSelected}
          onContextMenu={onRowMenu}
          initialSort={{ key: 'name', dir: 'asc' }}
          pageSize={30}
        />
      )}
      <div className="muted tiny mt-8">
        <TagIcon size={12} /> {t('recipient.searchHint')}
      </div>
      {editing !== undefined && <RecipientForm recipient={editing ?? undefined} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
