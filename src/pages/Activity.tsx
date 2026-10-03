import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarDays, CalendarRange, ExternalLink, History, ShieldCheck, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ACTIVITY_ACTIONS, type Activity as ActivityEntry, type ActivityAction } from '../core/types';
import { addDays, normalizeText, toISODate, todayISO } from '../core/util';
import { db } from '../db/db';
import { recipientDisplayName, useFmt } from '../app/data';
import { navigate, setQuery, useRoute } from '../app/router';
import { useI18n } from '../i18n';
import { Avatar, Badge, DataTable, EmptyState, Field, PageHeader, SearchInput, Stat, type Tone } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';

const ACTION_TONE: Record<ActivityAction, Tone> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  anonymize: 'danger',
  merge: 'accent',
  generate: 'accent',
  print: 'primary',
  ship: 'primary',
  status: 'warning',
  import: 'neutral',
  export: 'neutral',
  login: 'neutral',
  logout: 'neutral',
  backup: 'neutral',
  restore: 'warning',
};

const LINKS: Record<string, (id: string) => string> = {
  recipient: (id) => `#/recipients/${id}`,
  order: (id) => `#/orders/${id}`,
  project: (id) => `#/projects/${id}`,
  batch: (id) => `#/print/${id}`,
  customer: (id) => `#/customers/${id}`,
  inventory: (id) => `#/inventory?item=${id}`,
  supplier: (id) => `#/suppliers?supplier=${id}`,
  template: (id) => `#/templates/${id}`,
  shipment: (id) => `#/shipments?id=${id}`,
};

const keysOf = async (tb: { toCollection(): { primaryKeys(): PromiseLike<unknown[]> } }) => new Set((await tb.toCollection().primaryKeys()) as string[]);

const QUERY_KEYS = ['user', 'action', 'entity', 'from', 'to', 'entityId'] as const;

export function Activity() {
  const { t, tEnum } = useI18n();
  const fmt = useFmt();
  const route = useRoute();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const f = {
    user: route.query.get('user') ?? '',
    action: route.query.get('action') ?? '',
    entity: route.query.get('entity') ?? '',
    from: route.query.get('from') ?? '',
    to: route.query.get('to') ?? '',
    entityId: route.query.get('entityId') ?? '',
  };
  const data = useLiveQuery(async () => {
    const [activity, recipients, order, project, batch, customer, inventory, supplier, template, shipment] = await Promise.all([
      db.activity.orderBy('ts').reverse().toArray(),
      db.recipients.toArray(),
      keysOf(db.orders),
      keysOf(db.projects),
      keysOf(db.batches),
      keysOf(db.customers),
      keysOf(db.inventory),
      keysOf(db.suppliers),
      keysOf(db.templates),
      keysOf(db.shipments),
    ]);
    const names = new Map(recipients.map((r) => [r.id, recipientDisplayName(r)]));
    const exists: Record<string, Set<string>> = { recipient: new Set(names.keys()), order, project, batch, customer, inventory, supplier, template, shipment };
    return { activity: activity.map((a) => ({ ...a, day: toISODate(new Date(a.ts)) })), names, exists };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const n = normalizeText(q);
    return data.activity.filter((a) => {
      if (f.entityId && a.entityId !== f.entityId) return false;
      if (f.user && a.userName !== f.user) return false;
      if (f.action && a.action !== f.action) return false;
      if (f.entity && a.entityType !== f.entity) return false;
      if (f.from && a.day < f.from) return false;
      if (f.to && a.day > f.to) return false;
      if (n && !normalizeText(`${a.summary} ${a.userName} ${a.entityLabel ?? ''} ${a.recipientId ? data.names.get(a.recipientId) ?? '' : ''}`).includes(n)) return false;
      return true;
    });
  }, [data, q, f.entityId, f.user, f.action, f.entity, f.from, f.to]);

  if (!data) return null;

  const today = todayISO();
  const weekStart = toISODate(addDays(new Date(), -6));
  const todayCount = data.activity.filter((a) => a.day === today).length;
  const weekCount = data.activity.filter((a) => a.day >= weekStart).length;
  const users = Array.from(new Set(data.activity.map((a) => a.userName))).sort((a, b) => a.localeCompare(b));
  const entityLabel = (type: string) => t(`entity.${type}`);
  const entities = Array.from(new Set(data.activity.map((a) => a.entityType))).sort((a, b) => entityLabel(a).localeCompare(entityLabel(b)));
  const roleLabel = (role: string) => (role ? t(`role.${role}`) : '');
  const anyFilter = !!q || QUERY_KEYS.some((k) => !!f[k]);
  const setF = (key: (typeof QUERY_KEYS)[number], value: string) => setQuery(key, value || null);

  const recordOf = (a: ActivityEntry) => {
    if (a.recipientId && data.exists.recipient.has(a.recipientId)) return { href: LINKS.recipient(a.recipientId), label: a.entityLabel || data.names.get(a.recipientId) || entityLabel('recipient') };
    if (a.entityId && LINKS[a.entityType] && data.exists[a.entityType]?.has(a.entityId)) return { href: LINKS[a.entityType](a.entityId), label: a.entityLabel || t('activity.openRecord') };
    return { href: undefined, label: a.entityLabel || '' };
  };

  return (
    <div>
      <PageHeader
        eyebrow={t('navgroup.system')}
        title={t('nav.activity')}
        sub={t('activity.sub')}
        actions={
          <ExportMenu
            name={t('nav.activity')}
            formats={['csv', 'xlsx', 'pdf']}
            build={() => ({
              head: [t('activity.time'), t('activity.user'), t('activity.role'), t('activity.action'), t('activity.entity'), t('activity.record'), t('activity.summary'), t('activity.fields')],
              rows: [...rows]
                .sort((a, b) => b.ts.localeCompare(a.ts))
                .map((a) => [fmt.dateTime(a.ts), a.userName, roleLabel(a.role), tEnum('action', a.action), entityLabel(a.entityType), a.entityLabel || (a.recipientId ? data.names.get(a.recipientId) ?? '' : ''), a.summary, (a.fields ?? []).join(', ')]),
            })}
          />
        }
      />

      <div className="grid grid-3 mb-16">
        <Stat icon={<CalendarDays />} label={t('activity.today')} value={fmt.num(todayCount)} href={`#/activity?from=${today}&to=${today}`} />
        <Stat icon={<CalendarRange />} label={t('activity.week')} value={fmt.num(weekCount)} href={`#/activity?from=${weekStart}`} />
        <Stat icon={<Users />} label={t('activity.users')} value={fmt.num(users.length)} delta={t('activity.total', { count: data.activity.length })} />
      </div>

      <div className="issue mb-16" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
        <ShieldCheck />
        <div>{t('activity.privacy')}</div>
      </div>

      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder={t('activity.search')} />
        {f.entityId && (
          <Badge tone="accent">
            {t('activity.oneRecord')}
            <button type="button" className="btn ghost icon xs" style={{ height: 18, width: 18 }} onClick={() => setQuery('entityId', null)} aria-label={t('common.clear')}>
              <X />
            </button>
          </Badge>
        )}
        <span className="grow" />
        <span className="muted small">{t('activity.shown', { count: rows.length })}</span>
      </div>

      <div className="filters">
        <Field label={t('activity.user')}>
          <select className="select sm" value={f.user} onChange={(e) => setF('user', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('activity.action')}>
          <select className="select sm" value={f.action} onChange={(e) => setF('action', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {ACTIVITY_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {tEnum('action', a)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('activity.entity')}>
          <select className="select sm" value={f.entity} onChange={(e) => setF('entity', e.target.value)}>
            <option value="">{t('common.all')}</option>
            {entities.map((x) => (
              <option key={x} value={x}>
                {entityLabel(x)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('activity.from')}>
          <input className="input sm" type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF('from', e.target.value)} />
        </Field>
        <Field label={t('activity.to')}>
          <input className="input sm" type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF('to', e.target.value)} />
        </Field>
        {anyFilter && (
          <button
            className="btn ghost sm"
            onClick={() => {
              setQ('');
              navigate('/activity', true);
            }}
          >
            {t('common.clearFilters')}
          </button>
        )}
      </div>

      <DataTable
        rows={rows}
        rowKey={(a) => a.id}
        pageSize={50}
        initialSort={{ key: 'ts', dir: 'desc' }}
        columns={[
          { key: 'ts', header: t('activity.time'), render: (a) => <span className="small num" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(a.ts)}</span>, sort: (a) => a.ts },
          {
            key: 'user',
            header: t('activity.user'),
            render: (a) => (
              <div className="row" style={{ minWidth: 140 }}>
                <Avatar name={a.userName} />
                <div>
                  <b className="small">{a.userName}</b>
                  {a.role && <div className="tiny muted">{roleLabel(a.role)}</div>}
                </div>
              </div>
            ),
            sort: (a) => a.userName.toLowerCase(),
          },
          { key: 'action', header: t('activity.action'), render: (a) => <Badge tone={ACTION_TONE[a.action] ?? 'neutral'}>{tEnum('action', a.action)}</Badge>, sort: (a) => a.action },
          { key: 'summary', header: t('activity.summary'), render: (a) => <span className="small">{a.summary}</span>, sort: (a) => a.summary },
          {
            key: 'entity',
            header: t('activity.record'),
            render: (a) => {
              const r = recordOf(a);
              return (
                <div style={{ minWidth: 110 }}>
                  <div className="tiny muted">{entityLabel(a.entityType)}</div>
                  {r.href ? (
                    <a className="small" href={r.href}>
                      {r.label} <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="small">{r.label || '—'}</span>
                  )}
                </div>
              );
            },
            sort: (a) => `${entityLabel(a.entityType)} ${a.entityLabel ?? ''}`,
          },
          {
            key: 'fields',
            header: t('activity.fields'),
            render: (a) => (a.fields?.length ? <span className="tiny mono">{a.fields.join(', ')}</span> : <span className="muted">—</span>),
          },
        ]}
        empty={<EmptyState icon={<History />} title={t('activity.none')} text={anyFilter ? t('activity.noneFiltered') : undefined} />}
      />
    </div>
  );
}
