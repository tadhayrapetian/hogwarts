import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarRange, CheckCircle2, Coins, FileText, Gauge, Hourglass, PackageCheck, Receipt, Send, ShoppingBag, Timer, TrendingUp, Undo2, UserPlus, Users, BarChart3, Percent } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { countryName } from '../core/countries';
import type { Order, Shipment } from '../core/types';
import { addDays, addMonths, diffDays, parseISODate, round, startOfDay, sum, toISODate } from '../core/util';
import { db } from '../db/db';
import { useFmt, useSettings } from '../app/data';
import { navigate, setQuery, useRoute } from '../app/router';
import { useI18n } from '../i18n';
import { BarList, ChartCard, ColumnChart, LineChart } from '../ui/charts';
import { PageHeader, Section, Stat, Tabs } from '../ui/kit';
import { ExportMenu } from './shared/ExportMenu';

const PERIODS = ['today', '7d', '30d', '3m', '6m', 'year', 'custom'] as const;
type PeriodKey = (typeof PERIODS)[number];

type MetricKey = 'totalRecipients' | 'newRecipients' | 'orders' | 'completedOrders' | 'lettersProduced' | 'lettersShipped' | 'delivered' | 'returned' | 'revenue' | 'aov';
type PerfKey = 'avgDelivery' | 'onTime' | 'avgProduction' | 'returnRate';
type Kind = 'count' | 'money' | 'days' | 'pct';

const METRICS: { key: MetricKey; label: string; kind: Kind; icon: ReactNode; href?: string; invert?: boolean }[] = [
  { key: 'totalRecipients', label: 'analytics.metric.totalRecipients', kind: 'count', icon: <Users />, href: '#/recipients' },
  { key: 'newRecipients', label: 'analytics.metric.newRecipients', kind: 'count', icon: <UserPlus />, href: '#/recipients' },
  { key: 'orders', label: 'analytics.metric.orders', kind: 'count', icon: <ShoppingBag />, href: '#/orders' },
  { key: 'completedOrders', label: 'analytics.metric.completedOrders', kind: 'count', icon: <CheckCircle2 />, href: '#/orders?status=delivered' },
  { key: 'lettersProduced', label: 'analytics.metric.lettersProduced', kind: 'count', icon: <FileText />, href: '#/projects' },
  { key: 'lettersShipped', label: 'analytics.metric.lettersShipped', kind: 'count', icon: <Send />, href: '#/shipments' },
  { key: 'delivered', label: 'analytics.metric.delivered', kind: 'count', icon: <PackageCheck />, href: '#/shipments' },
  { key: 'returned', label: 'analytics.metric.returned', kind: 'count', icon: <Undo2 />, href: '#/shipments', invert: true },
  { key: 'revenue', label: 'analytics.revenue', kind: 'money', icon: <Coins /> },
  { key: 'aov', label: 'analytics.metric.aov', kind: 'money', icon: <Receipt /> },
];

const PERF: { key: PerfKey; label: string; kind: Kind; icon: ReactNode; invert?: boolean }[] = [
  { key: 'avgDelivery', label: 'analytics.perf.avgDelivery', kind: 'days', icon: <Timer />, invert: true },
  { key: 'onTime', label: 'analytics.perf.onTime', kind: 'pct', icon: <Gauge /> },
  { key: 'avgProduction', label: 'analytics.perf.avgProduction', kind: 'days', icon: <Hourglass />, invert: true },
  { key: 'returnRate', label: 'analytics.perf.returnRate', kind: 'pct', icon: <Percent />, invert: true },
];

interface Range {
  from: string;
  to: string;
  fromD: Date;
  toD: Date;
  days: number;
}

function makeRange(fromD: Date, toD: Date): Range {
  return { from: toISODate(fromD), to: toISODate(toD), fromD, toD, days: diffDays(toD, fromD) + 1 };
}

function resolveRange(period: PeriodKey, customFrom: string | null, customTo: string | null): Range {
  const today = startOfDay(new Date());
  switch (period) {
    case 'today':
      return makeRange(today, today);
    case '7d':
      return makeRange(addDays(today, -6), today);
    case '30d':
      return makeRange(addDays(today, -29), today);
    case '3m':
      return makeRange(addDays(addMonths(today, -3), 1), today);
    case '6m':
      return makeRange(addDays(addMonths(today, -6), 1), today);
    case 'year':
      return makeRange(new Date(today.getFullYear(), today.getMonth() - 11, 1), today);
    default: {
      const a = parseISODate(customFrom) ?? addDays(today, -29);
      const b = parseISODate(customTo) ?? today;
      return a <= b ? makeRange(a, b) : makeRange(b, a);
    }
  }
}

function previousRange(r: Range): Range {
  const toD = addDays(r.fromD, -1);
  return makeRange(addDays(toD, -(r.days - 1)), toD);
}

/** Local calendar day (YYYY-MM-DD) of a date or timestamp. */
function dayOf(s: string | undefined): string | undefined {
  if (!s) return undefined;
  if (s.length <= 10) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : toISODate(d);
}

const within = (d: string | undefined, r: Range): d is string => !!d && d >= r.from && d <= r.to;

function mondayOf(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() + 6) % 7));
}

type BucketKind = 'day' | 'week' | 'month';

interface Buckets {
  kind: BucketKind;
  keys: string[];
  labels: string[];
  full: string[];
  keyOf: (day: string) => string;
}

function makeBuckets(r: Range, locale: string, fmtDate: (d: Date) => string): Buckets {
  const kind: BucketKind = r.days <= 31 ? 'day' : r.days <= 186 ? 'week' : 'month';
  const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const keys: string[] = [];
  const labels: string[] = [];
  const full: string[] = [];
  if (kind === 'day') {
    for (let d = r.fromD; d <= r.toD; d = addDays(d, 1)) {
      keys.push(toISODate(d));
      labels.push(short.format(d));
      full.push(fmtDate(d));
    }
    return { kind, keys, labels, full, keyOf: (day) => day };
  }
  if (kind === 'week') {
    for (let m = mondayOf(r.fromD); m <= r.toD; m = addDays(m, 7)) {
      const start = m < r.fromD ? r.fromD : m;
      const weekEnd = addDays(m, 6);
      const end = weekEnd > r.toD ? r.toD : weekEnd;
      keys.push(toISODate(m));
      labels.push(short.format(start));
      full.push(`${fmtDate(start)} – ${fmtDate(end)}`);
    }
    return { kind, keys, labels, full, keyOf: (day) => toISODate(mondayOf(parseISODate(day) ?? new Date())) };
  }
  const multiYear = r.fromD.getFullYear() !== r.toD.getFullYear();
  const monthFmt = new Intl.DateTimeFormat(locale, multiYear ? { month: 'short', year: '2-digit' } : { month: 'short' });
  const fullFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  for (let m = new Date(r.fromD.getFullYear(), r.fromD.getMonth(), 1); m <= r.toD; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    keys.push(toISODate(m).slice(0, 7));
    labels.push(monthFmt.format(m));
    full.push(fullFmt.format(m));
  }
  return { kind, keys, labels, full, keyOf: (day) => day.slice(0, 7) };
}

function lastEventAt<S extends string>(events: { status: S; at: string }[], status: S): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].status === status) return events[i].at;
  return undefined;
}

function EmptyChart() {
  const { t } = useI18n();
  return <div className="muted small" style={{ padding: '24px 0', textAlign: 'center' }}>{t('chart.noData')}</div>;
}

export function Analytics() {
  const { t, lang, locale } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const route = useRoute();

  const qPeriod = route.query.get('period');
  const period: PeriodKey = (PERIODS as readonly string[]).includes(qPeriod ?? '') ? (qPeriod as PeriodKey) : '30d';
  const qFrom = route.query.get('from');
  const qTo = route.query.get('to');
  const range = useMemo(() => resolveRange(period, qFrom, qTo), [period, qFrom, qTo]);
  const prev = useMemo(() => previousRange(range), [range]);

  const data = useLiveQuery(async () => {
    const [recipients, orders, letters, shipments, projects, templates, houses, products] = await Promise.all([
      db.recipients.toArray(),
      db.orders.toArray(),
      db.documents.where('kind').equals('letter').toArray(),
      db.shipments.toArray(),
      db.projects.toArray(),
      db.templates.toArray(),
      db.houses.toArray(),
      db.products.toArray(),
    ]);
    return { recipients, orders, letters, shipments, projects, templates, houses, products };
  }, []);

  /** Period-independent facts: the calendar day each event happened on. */
  const facts = useMemo(() => {
    if (!data) return null;
    const byOrder = new Map<string, Shipment[]>();
    for (const s of data.shipments) if (s.orderId) byOrder.set(s.orderId, [...(byOrder.get(s.orderId) ?? []), s]);
    const completedAt = (o: Order): string | undefined => {
      const ev = lastEventAt(o.statusHistory, 'delivered');
      if (ev) return ev;
      const delivered = (byOrder.get(o.id) ?? [])
        .map((s) => s.deliveredAt)
        .filter((x): x is string => !!x)
        .sort();
      if (delivered.length && (o.status === 'delivered' || o.shippingStatus === 'delivered')) return delivered[delivered.length - 1];
      return o.status === 'delivered' ? o.updatedAt : undefined;
    };
    const houseOf = new Map(data.recipients.map((r) => [r.id, r.houseId]));
    return {
      recipients: data.recipients.map((r) => ({ created: dayOf(r.createdAt), anonymized: r.status === 'anonymized' })),
      orders: data.orders.map((o) => ({ o, created: dayOf(o.createdAt), completed: dayOf(completedAt(o)), cancelled: o.status === 'cancelled' })),
      letters: data.letters.filter((d) => d.status !== 'void').map((d) => ({ created: dayOf(d.createdAt), houseId: d.recipientId ? houseOf.get(d.recipientId) : undefined })),
      shipments: data.shipments.map((s) => ({
        s,
        shipped: s.shippingDate && s.status !== 'preparing' && s.status !== 'label_created' ? dayOf(s.shippingDate) : undefined,
        delivered: dayOf(s.deliveredAt ?? (s.status === 'delivered' ? lastEventAt(s.events, 'delivered') ?? s.updatedAt : undefined)),
        returned: s.status === 'returned' ? dayOf(lastEventAt(s.events, 'returned') ?? s.updatedAt) : undefined,
      })),
      projects: data.projects.map((p) => {
        const ready = p.stageHistory.find((e) => e.status === 'ready')?.at;
        const ms = ready ? Date.parse(ready) - Date.parse(p.createdAt) : NaN;
        return { created: dayOf(p.createdAt), ready: dayOf(ready), productionDays: isNaN(ms) ? undefined : Math.max(0, ms / 86400000), templateId: p.templateId };
      }),
    };
  }, [data]);

  const compute = useMemo(() => {
    if (!facts) return null;
    const metrics = (r: Range): Record<MetricKey, number> => {
      const orders = facts.orders.filter((x) => within(x.created, r));
      const paid = orders.filter((x) => !x.cancelled);
      const revenue = sum(paid.map((x) => x.o.total));
      return {
        totalRecipients: facts.recipients.filter((x) => !x.anonymized && !!x.created && x.created <= r.to).length,
        newRecipients: facts.recipients.filter((x) => within(x.created, r)).length,
        orders: orders.length,
        completedOrders: facts.orders.filter((x) => within(x.completed, r)).length,
        lettersProduced: facts.letters.filter((x) => within(x.created, r)).length,
        lettersShipped: facts.shipments.filter((x) => within(x.shipped, r)).length,
        delivered: facts.shipments.filter((x) => within(x.delivered, r)).length,
        returned: facts.shipments.filter((x) => within(x.returned, r)).length,
        revenue,
        aov: paid.length ? revenue / paid.length : 0,
      };
    };
    const perf = (r: Range): Record<PerfKey, { value?: number; n: number }> => {
      const delivered = facts.shipments.filter((x) => within(x.delivered, r));
      const transit = delivered
        .map((x) => {
          const a = parseISODate(x.s.shippingDate);
          const b = parseISODate(x.delivered);
          return a && b ? diffDays(b, a) : undefined;
        })
        .filter((n): n is number => n !== undefined && n >= 0);
      const withEta = delivered.filter((x) => !!x.s.estimatedDelivery);
      const onTime = withEta.filter((x) => x.delivered! <= x.s.estimatedDelivery!.slice(0, 10)).length;
      const production = facts.projects.filter((x) => within(x.ready, r) && x.productionDays !== undefined).map((x) => x.productionDays!);
      const shipped = facts.shipments.filter((x) => within(x.shipped, r)).length;
      const returned = facts.shipments.filter((x) => within(x.returned, r)).length;
      const avg = (a: number[]) => (a.length ? sum(a) / a.length : undefined);
      return {
        avgDelivery: { value: avg(transit), n: transit.length },
        onTime: { value: withEta.length ? (onTime / withEta.length) * 100 : undefined, n: withEta.length },
        avgProduction: { value: avg(production), n: production.length },
        returnRate: { value: shipped ? (returned / shipped) * 100 : undefined, n: shipped },
      };
    };
    return { cur: metrics(range), prev: metrics(prev), perfCur: perf(range), perfPrev: perf(prev) };
  }, [facts, range, prev]);

  const buckets = useMemo(() => makeBuckets(range, locale, fmt.date), [range, locale, fmt]);

  const trends = useMemo(() => {
    if (!facts) return null;
    const index = new Map(buckets.keys.map((k, i) => [k, i]));
    const series = (items: { day?: string; w?: number }[]) => {
      const out = buckets.keys.map(() => 0);
      for (const it of items) {
        if (!within(it.day, range)) continue;
        const i = index.get(buckets.keyOf(it.day));
        if (i !== undefined) out[i] += it.w ?? 1;
      }
      return out;
    };
    return {
      orders: series(facts.orders.map((x) => ({ day: x.created }))),
      revenue: series(facts.orders.filter((x) => !x.cancelled).map((x) => ({ day: x.created, w: x.o.total }))).map((v) => round(v, 2)),
      produced: series(facts.letters.map((x) => ({ day: x.created }))),
      shipped: series(facts.shipments.map((x) => ({ day: x.shipped }))),
    };
  }, [facts, buckets, range]);

  const breakdowns = useMemo(() => {
    if (!data || !facts) return null;
    const add = (m: Map<string, { label: string; value: number }>, key: string, label: string, v = 1) => {
      const cur = m.get(key);
      if (cur) cur.value += v;
      else m.set(key, { label, value: v });
    };
    const list = (m: Map<string, { label: string; value: number }>) =>
      Array.from(m, ([key, x]) => ({ key, label: x.label, value: round(x.value, 2) })).sort((a, b) => b.value - a.value);
    const templates = new Map<string, { label: string; value: number }>();
    for (const p of facts.projects.filter((x) => within(x.created, range)))
      add(templates, p.templateId ?? '', p.templateId ? data.templates.find((x) => x.id === p.templateId)?.name ?? '—' : t('common.custom'));
    const countries = new Map<string, { label: string; value: number }>();
    const carriers = new Map<string, { label: string; value: number }>();
    for (const x of facts.shipments.filter((x) => within(x.shipped, range))) {
      const c = x.s.address.country;
      add(countries, c || '', c ? countryName(c, lang) : '—');
      add(carriers, x.s.carrierId || '', settings.carriers.find((k) => k.id === x.s.carrierId)?.name ?? (x.s.carrierId || '—'));
    }
    const houses = new Map<string, { label: string; value: number }>();
    for (const l of facts.letters.filter((x) => within(x.created, range)))
      add(houses, l.houseId ?? '', l.houseId ? data.houses.find((h) => h.id === l.houseId)?.name ?? '—' : t('common.none'));
    const products = new Map<string, { label: string; value: number }>();
    for (const x of facts.orders.filter((x) => within(x.created, range) && !x.cancelled))
      for (const it of x.o.items) {
        const key = it.productId ?? `item:${it.name}`;
        add(products, key, (it.productId && data.products.find((p) => p.id === it.productId)?.name) || it.name || '—', (Number(it.qty) || 0) * (Number(it.unitPrice) || 0));
      }
    return { templates: list(templates), countries: list(countries), carriers: list(carriers), houses: list(houses), products: list(products) };
  }, [data, facts, range, lang, t, settings.carriers]);

  if (!data || !compute || !trends || !breakdowns) return null;

  const rangeText = range.days === 1 ? fmt.date(range.fromD) : `${fmt.date(range.fromD)} – ${fmt.date(range.toD)}`;
  const prevText = prev.days === 1 ? fmt.date(prev.fromD) : `${fmt.date(prev.fromD)} – ${fmt.date(prev.toD)}`;

  const moneyShort = (v: number) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: fmt.currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
    } catch {
      return fmt.money(v);
    }
  };
  const countFmt = (v: number) => fmt.num(v, 1);

  const fmtValue = (kind: Kind, v: number | undefined) => {
    if (v === undefined) return '—';
    if (kind === 'money') return fmt.money(v);
    if (kind === 'days') return t('analytics.days', { value: fmt.num(v, 1) });
    if (kind === 'pct') return `${fmt.num(v, 1)}%`;
    return fmt.num(v);
  };

  const changeOf = (kind: Kind, cur: number | undefined, before: number | undefined, invert = false): { text: string; raw: string; tone?: 'up' | 'down' } => {
    if (cur === undefined || before === undefined) return { text: t('analytics.noComparison'), raw: '' };
    const diff = cur - before;
    if (Math.abs(diff) < 1e-9) return { text: t('analytics.noChange'), raw: '0' };
    const sign = diff > 0 ? '+' : '−';
    const abs = Math.abs(diff);
    let value: string;
    if (kind === 'pct') value = t('analytics.points', { value: `${sign}${fmt.num(abs, 1)}` });
    else if (kind === 'days') value = t('analytics.days', { value: `${sign}${fmt.num(abs, 1)}` });
    else if (before === 0) value = `${sign}${kind === 'money' ? fmt.money(abs) : fmt.num(abs)}`;
    else {
      const pct = Math.abs(diff / before) * 100;
      value = `${sign}${fmt.num(pct, pct < 10 ? 1 : 0)}%`;
    }
    const better = invert ? diff < 0 : diff > 0;
    return { text: t('analytics.vsPrev', { value }), raw: value, tone: better ? 'up' : 'down' };
  };

  const selectPeriod = (k: string) => {
    if (k === 'custom' && !qFrom && !qTo) {
      setQuery('from', range.from);
      setQuery('to', range.to);
    }
    setQuery('period', k === '30d' ? null : k);
  };

  const buildExport = () => ({
    head: [t('analytics.metric'), `${t('analytics.current')} (${rangeText})`, `${t('analytics.previous')} (${prevText})`, t('analytics.change')],
    rows: [
      ...METRICS.map((m) => [t(m.label), round(compute.cur[m.key], 2), round(compute.prev[m.key], 2), changeOf(m.kind, compute.cur[m.key], compute.prev[m.key], m.invert).raw]),
      ...PERF.map((p) => {
        const c = compute.perfCur[p.key].value;
        const b = compute.perfPrev[p.key].value;
        return [t(p.label), fmtValue(p.kind, c), fmtValue(p.kind, b), changeOf(p.kind, c, b, p.invert).raw];
      }),
    ],
  });

  const bucketSub = t(`analytics.bucket.${buckets.kind}`);
  const breakdownCard = (title: string, head: string, items: { key: string; label: string; value: number }[], opts: { money?: boolean; colorIndex?: number; onClick?: (key: string) => void } = {}) => (
    <ChartCard title={title} sub={rangeText} table={{ head: [head, opts.money ? t('analytics.revenue') : t('chart.count')], rows: items.map((x) => [x.label, opts.money ? fmt.money(x.value) : x.value]) }}>
      {items.length ? (
        <BarList items={items} format={(v) => (opts.money ? fmt.money(v) : fmt.num(v))} colorIndex={opts.colorIndex} onClick={opts.onClick} />
      ) : (
        <EmptyChart />
      )}
    </ChartCard>
  );

  return (
    <div>
      <PageHeader
        title={t('nav.analytics')}
        sub={t('analytics.sub', { range: rangeText, prev: prevText })}
        actions={<ExportMenu name={`analytics_${range.from}_${range.to}`} build={buildExport} />}
      />

      <div className="toolbar">
        <Tabs pill tabs={PERIODS.map((k) => ({ key: k, label: k === 'custom' ? t('common.custom') : t(`analytics.period.${k}`) }))} value={period} onChange={selectPeriod} />
        {period === 'custom' && (
          <>
            <label className="row small muted">
              {t('analytics.from')}
              <input className="input sm" type="date" value={range.from} max={range.to} onChange={(e) => setQuery('from', e.target.value || null)} aria-label={t('analytics.from')} />
            </label>
            <label className="row small muted">
              {t('analytics.to')}
              <input className="input sm" type="date" value={range.to} min={range.from} onChange={(e) => setQuery('to', e.target.value || null)} aria-label={t('analytics.to')} />
            </label>
          </>
        )}
        <span className="grow" />
        <span className="row small muted">
          <CalendarRange size={15} /> {t('analytics.daysCount', { count: range.days })} · {bucketSub}
        </span>
      </div>

      <Section icon={<TrendingUp />} title={t('analytics.keyMetrics')}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {METRICS.map((m) => {
            const c = changeOf(m.kind, compute.cur[m.key], compute.prev[m.key], m.invert);
            return <Stat key={m.key} label={t(m.label)} value={fmtValue(m.kind, compute.cur[m.key])} icon={m.icon} delta={c.text} tone={c.tone} href={m.href} />;
          })}
        </div>
      </Section>

      <Section icon={<BarChart3 />} title={t('analytics.trends')}>
        <div className="grid grid-2">
          <ChartCard title={t('analytics.chart.orders')} sub={bucketSub} table={{ head: [t('chart.period'), t('analytics.metric.orders')], rows: buckets.full.map((l, i) => [l, trends.orders[i]]) }}>
            <ColumnChart labels={buckets.labels} series={[{ key: 'orders', label: t('analytics.metric.orders'), values: trends.orders }]} format={countFmt} />
          </ChartCard>
          <ChartCard title={t('analytics.chart.revenue')} sub={bucketSub} table={{ head: [t('chart.period'), t('analytics.revenue')], rows: buckets.full.map((l, i) => [l, fmt.money(trends.revenue[i])]) }}>
            <ColumnChart labels={buckets.labels} series={[{ key: 'revenue', label: t('analytics.revenue'), values: trends.revenue }]} format={moneyShort} />
          </ChartCard>
          <div className="span-all">
            <ChartCard
              title={t('analytics.chart.letters')}
              sub={bucketSub}
              table={{
                head: [t('chart.period'), t('analytics.metric.lettersProduced'), t('analytics.metric.lettersShipped')],
                rows: buckets.full.map((l, i) => [l, trends.produced[i], trends.shipped[i]]),
              }}
            >
              <LineChart
                labels={buckets.labels}
                series={[
                  { key: 'produced', label: t('analytics.metric.lettersProduced'), values: trends.produced },
                  { key: 'shipped', label: t('analytics.metric.lettersShipped'), values: trends.shipped },
                ]}
                format={countFmt}
              />
            </ChartCard>
          </div>
        </div>
      </Section>

      <Section icon={<Gauge />} title={t('analytics.performance')}>
        <div className="grid grid-4">
          {PERF.map((p) => {
            const cur = compute.perfCur[p.key];
            const before = compute.perfPrev[p.key];
            const c = changeOf(p.kind, cur.value, before.value, p.invert);
            const delta = cur.n ? `${t('analytics.sample', { count: cur.n })} · ${c.text}` : t('analytics.noSample');
            return <Stat key={p.key} label={t(p.label)} value={fmtValue(p.kind, cur.value)} icon={p.icon} delta={delta} tone={cur.n ? c.tone : undefined} />;
          })}
        </div>
      </Section>

      <Section icon={<BarChart3 />} title={t('analytics.breakdowns')}>
        <div className="grid grid-2">
          {breakdownCard(t('analytics.by.template'), t('project.template'), breakdowns.templates, {
            colorIndex: 0,
            onClick: (key) => key && navigate(`/templates/${key}`),
          })}
          {breakdownCard(t('analytics.by.country'), t('field.country'), breakdowns.countries, { colorIndex: 1 })}
          {breakdownCard(t('analytics.by.house'), t('field.house'), breakdowns.houses, { colorIndex: 2 })}
          {breakdownCard(t('analytics.by.carrier'), t('shipment.carrier'), breakdowns.carriers, { colorIndex: 3 })}
          <div className="span-all">{breakdownCard(t('analytics.by.product'), t('order.product'), breakdowns.products, { money: true, colorIndex: 4 })}</div>
        </div>
      </Section>
    </div>
  );
}
