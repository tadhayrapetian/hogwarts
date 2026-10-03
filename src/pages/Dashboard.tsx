import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, Cake, CheckSquare, Coins, DatabaseBackup, Factory, FileText, History, LayoutTemplate, PackageX, Plus, ShoppingBag, Truck, Upload, UserPlus, Users, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, type ReactNode } from 'react';
import { countryName } from '../core/countries';
import { PROJECT_STAGES, type OrderStatus, type ProjectStage, type Recipient, type Shipment, type ShipmentStatus } from '../core/types';
import { addDays, ageFromDob, countBy, daysUntilBirthday, diffDays, monthShort, parseISODate, startOfDay, sum, toISODate } from '../core/util';
import { db } from '../db/db';
import { dismissNotification } from '../db/services';
import { useFmt, useSettings } from '../app/data';
import { useNotifications } from '../app/notifications';
import { navigate, setQuery, useRoute } from '../app/router';
import { useSession } from '../app/session';
import { useUI } from '../app/ui';
import { useI18n } from '../i18n';
import { BarList, ChartCard, ColumnChart, LineChart } from '../ui/charts';
import { Avatar, Badge, Card, PageHeader, Stat } from '../ui/kit';
import { TasksList } from './recipients/RecipientProfile';

const MOVING: ShipmentStatus[] = ['shipped', 'in_transit', 'out_for_delivery'];
const CLOSED_ORDERS: OrderStatus[] = ['delivered', 'cancelled', 'archived', 'shipped'];
const IN_PRODUCTION: ProjectStage[] = ['approved', 'generated', 'printed', 'cut', 'folded'];

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthOf = (s: string | undefined) => {
  const d = parseISODate(s);
  return d ? monthKey(d) : undefined;
};
const isShipped = (s: Shipment) => !!s.shippingDate && s.status !== 'preparing' && s.status !== 'label_created';

interface Kpi {
  key: string;
  label: string;
  value: ReactNode;
  icon: ReactNode;
  href: string;
  delta?: ReactNode;
  tone?: 'up' | 'down';
}

function EmptyChart() {
  const { t } = useI18n();
  return <div className="muted small" style={{ padding: '24px 0', textAlign: 'center' }}>{t('chart.noData')}</div>;
}

export function Dashboard() {
  const { t, tEnum, lang, locale } = useI18n();
  const fmt = useFmt();
  const settings = useSettings();
  const { user, can } = useSession();
  const ui = useUI();
  const route = useRoute();
  const { items: notifications } = useNotifications();

  const data = useLiveQuery(async () => {
    const [recipients, orders, letters, projects, shipments, inventory, tasks, templates, houses, activity] = await Promise.all([
      db.recipients.toArray(),
      db.orders.toArray(),
      db.documents.where('kind').equals('letter').toArray(),
      db.projects.toArray(),
      db.shipments.toArray(),
      db.inventory.toArray(),
      db.tasks.filter((x) => !x.done).toArray(),
      db.templates.toArray(),
      db.houses.toArray(),
      db.activity.orderBy('ts').reverse().limit(8).toArray(),
    ]);
    return { recipients, orders, letters, projects, shipments, inventory, tasks, templates, houses, activity };
  }, []);

  const stats = useMemo(() => {
    if (!data) return null;
    const now = new Date();
    const today = toISODate(now);
    const thisMonth = monthKey(now);
    const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
    const keys = months.map(monthKey);
    const perMonth = (dates: (string | undefined)[]) => {
      const out = keys.map(() => 0);
      for (const d of dates) {
        const i = keys.indexOf(monthOf(d) ?? '');
        if (i >= 0) out[i]++;
      }
      return out;
    };
    const live = data.recipients.filter((r) => r.status !== 'anonymized');
    const active = data.recipients.filter((r) => r.status === 'active');
    const letters = data.letters.filter((d) => d.status !== 'void');
    const activeProjects = data.projects.filter((p) => p.status === 'active');
    const openOrders = data.orders.filter((o) => !CLOSED_ORDERS.includes(o.status));
    const revenueIn = (key: string) => sum(data.orders.filter((o) => o.status !== 'cancelled' && monthOf(o.createdAt) === key).map((o) => o.total));
    const in7 = toISODate(addDays(now, 7));
    const tasks = [...data.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const birthdays = active
      .map((r) => ({ r, days: daysUntilBirthday(r.birthday, now) }))
      .filter((x): x is { r: Recipient; days: number } => x.days !== undefined && x.days <= 30)
      .sort((a, b) => a.days - b.days);
    return {
      months,
      activeRecipients: active.length,
      newRecipientsMonth: data.recipients.filter((r) => monthOf(r.createdAt) === thisMonth).length,
      openOrders: openOrders.length,
      overdueOrders: openOrders.filter((o) => o.dueDate && o.dueDate < today).length,
      lettersYear: letters.filter((d) => parseISODate(d.createdAt)?.getFullYear() === now.getFullYear()).length,
      lettersMonth: letters.filter((d) => monthOf(d.createdAt) === thisMonth).length,
      inProduction: activeProjects.filter((p) => IN_PRODUCTION.includes(p.stage)).length,
      readyToShip: activeProjects.filter((p) => (p.stage === 'packed' || p.stage === 'ready') && !data.shipments.some((s) => s.projectId === p.id && isShipped(s))).length,
      inTransit: data.shipments.filter((s) => MOVING.includes(s.status)).length,
      deliveredMonth: data.shipments.filter((s) => s.status === 'delivered' && monthOf(s.deliveredAt ?? s.updatedAt) === thisMonth).length,
      lowStock: data.inventory.filter((i) => i.quantity <= i.minQuantity).length,
      outOfStock: data.inventory.filter((i) => i.quantity <= 0).length,
      revenueMonth: revenueIn(thisMonth),
      revenueLastMonth: revenueIn(lastMonth),
      tasksDue: tasks.filter((x) => x.dueDate <= in7),
      tasksOverdue: tasks.filter((x) => x.dueDate < today).length,
      tasks: tasks.slice(0, 8),
      birthdays,
      ordersPerMonth: perMonth(data.orders.map((o) => o.createdAt)),
      lettersPerMonth: perMonth(letters.map((d) => d.createdAt)),
      shippedPerMonth: perMonth(data.shipments.filter(isShipped).map((s) => s.shippingDate)),
      byCountry: countBy(live, (r) => r.country || undefined),
      byHouse: countBy(live, (r) => r.houseId ?? ''),
      byTemplate: countBy(data.projects, (p) => p.templateId),
      byStage: PROJECT_STAGES.map((s) => activeProjects.filter((p) => p.stage === s).length),
      birthdayTemplateId: data.templates.find((x) => x.category === 'birthday' && x.kind === 'letter' && !x.archived)?.id,
    };
  }, [data]);

  useEffect(() => {
    const focus = route.query.get('focus');
    if (!focus || !stats) return;
    document.getElementById(`dash-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setQuery('focus', null);
  }, [route, stats]);

  if (!data || !stats) return null;

  const canR = can('recipients.view');
  const canO = can('orders.view');
  const now = new Date();
  const hour = now.getHours();
  const greetKey = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const todayLong = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const monthLabels = stats.months.map((d) => monthShort(d.getMonth(), locale));
  const monthFull = stats.months.map((d) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d));
  const houseName = (id: string) => data.houses.find((h) => h.id === id)?.name ?? t('common.none');
  const templateName = (id: string) => data.templates.find((x) => x.id === id)?.name ?? '—';
  const recipientName = (id?: string) => {
    const r = data.recipients.find((x) => x.id === id);
    return r ? `${r.firstName} ${r.lastName}` : '';
  };

  const lastBackup = parseISODate(settings.backup.lastBackupAt);
  const backupAge = lastBackup ? diffDays(now, lastBackup) : undefined;
  const backupDue = settings.backup.remindDays > 0 && (backupAge === undefined || backupAge >= settings.backup.remindDays) && (can('data.export') || can('settings.edit'));
  const emptyWorkspace = data.recipients.length === 0;

  const revenueDelta = (() => {
    const cur = stats.revenueMonth;
    const prev = stats.revenueLastMonth;
    if (!prev) return cur ? { text: t('dash.kpi.vsLastMonth', { value: `+${fmt.money(cur)}` }), tone: 'up' as const } : undefined;
    const pct = ((cur - prev) / prev) * 100;
    return { text: t('dash.kpi.vsLastMonth', { value: `${pct >= 0 ? '+' : '−'}${fmt.num(Math.abs(pct))}%` }), tone: pct >= 0 ? ('up' as const) : ('down' as const) };
  })();

  const kpis: Kpi[] = [];
  if (canR)
    kpis.push({
      key: 'recipients',
      label: t('dash.kpi.recipients'),
      value: fmt.num(stats.activeRecipients),
      icon: <Users />,
      href: '#/recipients?status=active',
      delta: stats.newRecipientsMonth ? t('dash.kpi.newThisMonth', { count: stats.newRecipientsMonth }) : undefined,
      tone: stats.newRecipientsMonth ? 'up' : undefined,
    });
  if (canO) {
    kpis.push(
      {
        key: 'orders',
        label: t('dash.kpi.openOrders'),
        value: fmt.num(stats.openOrders),
        icon: <ShoppingBag />,
        href: '#/orders',
        delta: stats.overdueOrders ? t('dash.kpi.overdue', { count: stats.overdueOrders }) : undefined,
        tone: stats.overdueOrders ? 'down' : undefined,
      },
      {
        key: 'letters',
        label: t('dash.kpi.lettersYear'),
        value: fmt.num(stats.lettersYear),
        icon: <FileText />,
        href: '#/projects',
        delta: t('dash.kpi.lettersMonth', { count: stats.lettersMonth }),
      },
      {
        key: 'production',
        label: t('dash.kpi.inProduction'),
        value: fmt.num(stats.inProduction),
        icon: <Factory />,
        href: '#/production',
        delta: stats.readyToShip ? t('dash.kpi.readyToShip', { count: stats.readyToShip }) : undefined,
      },
      {
        key: 'transit',
        label: t('dash.kpi.inTransit'),
        value: fmt.num(stats.inTransit),
        icon: <Truck />,
        href: '#/shipments',
        delta: t('dash.kpi.deliveredMonth', { count: stats.deliveredMonth }),
      },
      {
        key: 'stock',
        label: t('dash.kpi.lowStock'),
        value: fmt.num(stats.lowStock),
        icon: <PackageX />,
        href: '#/inventory',
        delta: stats.outOfStock ? t('dash.kpi.outOfStock', { count: stats.outOfStock }) : stats.lowStock ? undefined : t('dash.kpi.allStocked'),
        tone: stats.outOfStock ? 'down' : undefined,
      },
    );
  }
  if (canO && can('analytics.view'))
    kpis.push({ key: 'revenue', label: t('dash.kpi.revenueMonth'), value: fmt.money(stats.revenueMonth), icon: <Coins />, href: '#/analytics', delta: revenueDelta?.text, tone: revenueDelta?.tone });
  else if (canR) kpis.push({ key: 'birthdays', label: t('dash.kpi.birthdays'), value: fmt.num(stats.birthdays.length), icon: <Cake />, href: '#/dashboard?focus=birthdays' });
  if (canR)
    kpis.push({
      key: 'tasks',
      label: t('dash.kpi.pendingTasks'),
      value: fmt.num(stats.tasksDue.length),
      icon: <CheckSquare />,
      href: '#/dashboard?focus=tasks',
      delta: stats.tasksOverdue ? t('dash.kpi.overdue', { count: stats.tasksOverdue }) : t('dash.kpi.tasksHint'),
      tone: stats.tasksOverdue ? 'down' : undefined,
    });

  const countryItems = Object.entries(stats.byCountry).map(([code, value]) => ({ key: code, label: countryName(code, lang), value }));
  const houseItems = Object.entries(stats.byHouse).map(([id, value]) => ({ key: id || 'none', label: id ? houseName(id) : t('common.none'), value }));
  const templateItems = Object.entries(stats.byTemplate).map(([id, value]) => ({ key: id, label: templateName(id), value }));
  const sortDesc = <T extends { value: number }>(items: T[]) => [...items].sort((a, b) => b.value - a.value);
  const countFmt = (v: number) => fmt.num(v, 1);

  const actions = (
    <>
      {can('projects.edit') && (
        <button className="btn accent" onClick={() => ui.openPackageWizard()}>
          <Wand2 /> {t('package.create')}
        </button>
      )}
      {can('recipients.edit') && (
        <a className="btn" href="#/recipients?new=1">
          <UserPlus /> {t('recipient.new')}
        </a>
      )}
      {can('data.import') && (
        <a className="btn" href="#/recipients/import">
          <Upload /> {t('dash.importRecipients')}
        </a>
      )}
      {can('orders.edit') && (
        <a className="btn" href="#/orders?new=1">
          <Plus /> {t('order.new')}
        </a>
      )}
    </>
  );

  return (
    <div>
      <PageHeader
        eyebrow={settings.company.systemName || t('nav.dashboard')}
        title={t(`dash.greeting.${greetKey}`, { name: user?.displayName || user?.username || '' })}
        sub={t('dash.sub', { date: todayLong })}
        actions={actions}
      />

      {backupDue && (
        <div className="issue warning mb-16" role="status" style={{ alignItems: 'center' }}>
          <DatabaseBackup />
          <div className="grow">{backupAge === undefined ? t('dash.backupNever') : t('dash.backupOld', { count: backupAge, days: backupAge })}</div>
          <a className="btn sm" href="#/settings?tab=data">
            {t('dash.backupNow')}
          </a>
        </div>
      )}

      {emptyWorkspace && (
        <Card className="paper mb-16" title={t('dash.welcomeTitle', { name: settings.company.systemName })} sub={t('dash.welcomeSub')}>
          <div className="grid grid-3">
            {can('recipients.edit') && (
              <a className="card pad col" href="#/recipients?new=1" style={{ textDecoration: 'none', color: 'inherit' }}>
                <UserPlus size={22} color="var(--accent)" />
                <b>{t('dash.start.recipient')}</b>
                <span className="muted small">{t('dash.start.recipientHint')}</span>
              </a>
            )}
            {can('data.import') && (
              <a className="card pad col" href="#/recipients/import" style={{ textDecoration: 'none', color: 'inherit' }}>
                <Upload size={22} color="var(--accent)" />
                <b>{t('dash.start.import')}</b>
                <span className="muted small">{t('dash.start.importHint')}</span>
              </a>
            )}
            <a className="card pad col" href="#/templates" style={{ textDecoration: 'none', color: 'inherit' }}>
              <LayoutTemplate size={22} color="var(--accent)" />
              <b>{t('dash.start.templates')}</b>
              <span className="muted small">{t('dash.start.templatesHint')}</span>
            </a>
          </div>
        </Card>
      )}

      {kpis.length > 0 && (
        <div className="grid grid-4 mb-16">
          {kpis.map((k) => (
            <Stat key={k.key} label={k.label} value={k.value} icon={k.icon} href={k.href} delta={k.delta} tone={k.tone} />
          ))}
        </div>
      )}

      {!emptyWorkspace && (canO || canR) && (
        <div className="grid grid-2 mb-16">
          {canO && (
            <ChartCard
              title={t('dash.chart.ordersPerMonth')}
              sub={t('dash.chart.last12')}
              table={{ head: [t('chart.month'), t('nav.orders')], rows: monthFull.map((m, i) => [m, stats.ordersPerMonth[i]]) }}
            >
              <ColumnChart labels={monthLabels} series={[{ key: 'orders', label: t('nav.orders'), values: stats.ordersPerMonth }]} format={countFmt} />
            </ChartCard>
          )}
          {canO && (
            <ChartCard
              title={t('dash.chart.lettersFlow')}
              sub={t('dash.chart.last12')}
              table={{
                head: [t('chart.month'), t('dash.chart.lettersCreated'), t('dash.chart.lettersShipped')],
                rows: monthFull.map((m, i) => [m, stats.lettersPerMonth[i], stats.shippedPerMonth[i]]),
              }}
            >
              <LineChart
                labels={monthLabels}
                series={[
                  { key: 'created', label: t('dash.chart.lettersCreated'), values: stats.lettersPerMonth },
                  { key: 'shipped', label: t('dash.chart.lettersShipped'), values: stats.shippedPerMonth },
                ]}
                format={countFmt}
              />
            </ChartCard>
          )}
          {canR && (
            <ChartCard title={t('dash.chart.byCountry')} table={{ head: [t('field.country'), t('nav.recipients')], rows: sortDesc(countryItems).map((x) => [x.label, x.value]) }}>
              {countryItems.length ? <BarList items={countryItems} format={(v) => fmt.num(v)} /> : <EmptyChart />}
            </ChartCard>
          )}
          {canR && (
            <ChartCard title={t('dash.chart.houses')} table={{ head: [t('field.house'), t('nav.recipients')], rows: sortDesc(houseItems).map((x) => [x.label, x.value]) }}>
              {houseItems.length ? <BarList items={houseItems} format={(v) => fmt.num(v)} colorIndex={1} /> : <EmptyChart />}
            </ChartCard>
          )}
          {canO && (
            <ChartCard
              title={t('dash.chart.popularTemplates')}
              sub={t('dash.chart.popularTemplatesSub')}
              table={{ head: [t('project.template'), t('nav.projects')], rows: sortDesc(templateItems).map((x) => [x.label, x.value]) }}
            >
              {templateItems.length ? (
                <BarList items={templateItems} format={(v) => fmt.num(v)} colorIndex={2} onClick={(id) => navigate(`/templates/${id}`)} />
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
          )}
          {canO && (
            <ChartCard
              title={t('dash.chart.production')}
              sub={t('dash.chart.productionSub')}
              table={{ head: [t('project.stage'), t('nav.projects')], rows: PROJECT_STAGES.map((s, i) => [tEnum('stage', s), stats.byStage[i]]) }}
            >
              <ColumnChart labels={PROJECT_STAGES.map((s) => tEnum('stage', s))} series={[{ key: 'projects', label: t('nav.projects'), values: stats.byStage }]} format={countFmt} />
            </ChartCard>
          )}
        </div>
      )}

      <div className="grid grid-2">
        {canR && (
          <div id="dash-tasks">
            <Card title={t('dash.kpi.pendingTasks')} sub={t('dash.tasksSub')} actions={stats.tasks.length ? <Badge tone={stats.tasksOverdue ? 'danger' : 'neutral'}>{fmt.num(data.tasks.length)}</Badge> : undefined}>
              <TasksList tasks={stats.tasks} showRecipient />
            </Card>
          </div>
        )}

        {canR && (
          <div id="dash-birthdays">
            <Card title={t('dash.birthdays')} sub={t('dash.birthdaysSub')}>
              {!stats.birthdays.length && <div className="muted small">{t('dash.noBirthdays')}</div>}
              <div className="list">
                {stats.birthdays.slice(0, 8).map(({ r, days }) => {
                  const date = addDays(startOfDay(now), days);
                  const age = r.dob ? ageFromDob(r.dob, date) : undefined;
                  return (
                    <div key={r.id} className="list-item">
                      <Avatar name={`${r.firstName} ${r.lastName}`} color={data.houses.find((h) => h.id === r.houseId)?.primaryColor} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <a href={`#/recipients/${r.id}`}>
                          <b>
                            {r.firstName} {r.lastName}
                          </b>
                        </a>
                        <div className="muted tiny">
                          {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date)}
                          {age !== undefined && ` · ${t('dash.turns', { age })}`}
                        </div>
                      </div>
                      <Badge tone={days === 0 ? 'accent' : days <= 3 ? 'warning' : 'neutral'}>
                        {days === 0 ? t('recipient.birthdayToday') : t('recipient.birthdayIn', { days })}
                      </Badge>
                      {can('projects.edit') && (
                        <button
                          className="btn sm"
                          onClick={() => ui.openPackageWizard({ recipientId: r.id, templateId: stats.birthdayTemplateId })}
                          title={t('dash.birthdayPackage')}
                        >
                          <Cake /> <span className="hide-mobile">{t('dash.birthdayPackage')}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}

        <Card title={t('notif.title')} actions={notifications.length ? <Badge tone="danger">{fmt.num(notifications.length)}</Badge> : <Bell size={16} color="var(--muted)" />}>
          {!notifications.length && <div className="muted small">{t('notif.empty')}</div>}
          <div className="list">
            {notifications.slice(0, 6).map((n) => (
              <div key={n.key} className="list-item" style={{ alignItems: 'flex-start' }}>
                <Badge tone={n.level === 'danger' ? 'danger' : n.level === 'warning' ? 'warning' : 'info'}>{t(`notif.type.${n.type}`)}</Badge>
                <a className="grow small" href={n.href} style={{ color: 'var(--ink)' }}>
                  {t(`notif.msg.${n.type}`, n.params)}
                  {n.at && <div className="muted tiny">{fmt.date(n.at)}</div>}
                </a>
                <button className="btn ghost icon xs" title={t('notif.dismiss')} aria-label={t('notif.dismiss')} onClick={() => dismissNotification(n.key)}>
                  <X />
                </button>
              </div>
            ))}
          </div>
          {notifications.length > 6 && <div className="muted small mt-8">+{fmt.num(notifications.length - 6)}</div>}
        </Card>

        {can('audit.view') && (
          <Card
            title={t('dash.activity')}
            actions={
              <a className="btn ghost sm" href="#/activity">
                <History /> {t('common.viewAll')}
              </a>
            }
          >
            <div className="timeline">
              {data.activity.map((a) => (
                <div key={a.id} className="tl-item done">
                  <div className="small">
                    <b>{a.userName}</b> · {a.summary}
                  </div>
                  <div className="when">
                    {fmt.dateTime(a.ts)} · {tEnum('action', a.action)}
                    {a.recipientId && recipientName(a.recipientId) && (
                      <>
                        {' · '}
                        <a href={`#/recipients/${a.recipientId}`}>{recipientName(a.recipientId)}</a>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {!data.activity.length && <div className="muted small">{t('activity.none')}</div>}
            </div>
          </Card>
        )}
      </div>

    </div>
  );
}
