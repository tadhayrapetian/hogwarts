import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { isValidPostalCode } from '../core/countries';
import { OPEN_ORDER_STATUSES } from '../core/orders';
import { PROJECT_STAGES } from '../core/types';
import { diffDays, daysUntilBirthday, parseISODate, todayISO } from '../core/util';
import { isAddressEmpty, validateAddress } from '../core/validation';
import { db } from '../db/db';
import { useSettings } from './data';

export type NotificationType =
  | 'newOrder'
  | 'lowStock'
  | 'birthday'
  | 'unprinted'
  | 'unshipped'
  | 'returned'
  | 'missingAddress'
  | 'invalidPostal'
  | 'overdue';

export interface AppNotification {
  key: string;
  type: NotificationType;
  level: 'info' | 'warning' | 'danger';
  params: Record<string, string | number>;
  href: string;
  at?: string;
}

/** Notifications are computed live from the data, so they are always accurate; dismissals are stored. */
export function useNotifications(): { items: AppNotification[]; all: AppNotification[] } {
  const settings = useSettings();
  const n = settings.notifications;
  const data = useLiveQuery(async () => {
    const [orders, inventory, recipients, projects, shipments, dismissals] = await Promise.all([
      db.orders.toArray(),
      db.inventory.toArray(),
      db.recipients.toArray(),
      db.projects.where('status').equals('active').toArray(),
      db.shipments.toArray(),
      db.dismissals.toArray(),
    ]);
    return { orders, inventory, recipients, projects, shipments, dismissals };
  }, []);
  return useMemo(() => {
    const all: AppNotification[] = [];
    if (!data) return { items: [], all };
    const today = new Date();
    const todayStr = todayISO();
    const name = (id?: string) => {
      const r = data.recipients.find((x) => x.id === id);
      return r ? `${r.firstName} ${r.lastName}` : '—';
    };
    if (n.newOrder)
      for (const o of data.orders.filter((o) => o.status === 'new'))
        all.push({ key: `new-${o.id}`, type: 'newOrder', level: 'info', params: { number: o.number, name: name(o.recipientId) }, href: `#/orders/${o.id}`, at: o.createdAt });
    if (n.overdue)
      for (const o of data.orders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status) && o.dueDate && o.dueDate < todayStr))
        all.push({ key: `due-${o.id}-${o.dueDate}`, type: 'overdue', level: 'danger', params: { number: o.number, date: o.dueDate! }, href: `#/orders/${o.id}`, at: o.dueDate });
    if (n.lowStock)
      for (const it of data.inventory.filter((i) => i.quantity <= i.minQuantity))
        all.push({ key: `stock-${it.id}-${it.quantity}`, type: 'lowStock', level: it.quantity === 0 ? 'danger' : 'warning', params: { item: it.name, qty: it.quantity, unit: it.unit }, href: `#/inventory?item=${it.id}` });
    const active = data.recipients.filter((r) => r.status === 'active');
    if (n.birthdays)
      for (const r of active) {
        const d = daysUntilBirthday(r.birthday, today);
        if (d !== undefined && d <= n.birthdayDays)
          all.push({ key: `bday-${r.id}-${today.getFullYear()}-${r.birthday}`, type: 'birthday', level: d <= 3 ? 'warning' : 'info', params: { name: `${r.firstName} ${r.lastName}`, days: d }, href: `#/recipients/${r.id}` });
      }
    const rank = (s: string) => PROJECT_STAGES.indexOf(s as (typeof PROJECT_STAGES)[number]);
    if (n.unprinted)
      for (const p of data.projects.filter((p) => p.stage === 'generated' || p.stage === 'approved')) {
        const at = p.stageHistory[p.stageHistory.length - 1]?.at ?? p.updatedAt;
        const age = diffDays(today, parseISODate(at) ?? today);
        if (age >= n.unprintedDays) all.push({ key: `unprinted-${p.id}`, type: 'unprinted', level: 'warning', params: { code: p.code, name: name(p.recipientId), days: age }, href: `#/projects/${p.id}`, at });
      }
    if (n.unshipped)
      for (const p of data.projects.filter((p) => rank(p.stage) >= rank('packed'))) {
        const sh = data.shipments.filter((s) => s.projectId === p.id);
        if (sh.some((s) => !['preparing', 'label_created'].includes(s.status))) continue;
        const at = p.stageHistory[p.stageHistory.length - 1]?.at ?? p.updatedAt;
        const age = diffDays(today, parseISODate(at) ?? today);
        if (age >= n.unshippedDays) all.push({ key: `unshipped-${p.id}`, type: 'unshipped', level: 'warning', params: { code: p.code, name: name(p.recipientId), days: age }, href: `#/projects/${p.id}?tab=shipping`, at });
      }
    if (n.returned)
      for (const s of data.shipments.filter((s) => s.status === 'returned'))
        all.push({ key: `ret-${s.id}`, type: 'returned', level: 'danger', params: { code: s.code, name: s.recipientName }, href: `#/shipments?id=${s.id}`, at: s.updatedAt });
    for (const r of active) {
      const a = r.addresses.find((x) => x.id === r.defaultAddressId) ?? r.addresses[0];
      if (n.missingAddress && (!a || isAddressEmpty(a) || validateAddress(a).some((i) => i.code === 'required' || i.code === 'postal_missing')))
        all.push({ key: `addr-${r.id}-${r.updatedAt}`, type: 'missingAddress', level: 'warning', params: { name: `${r.firstName} ${r.lastName}` }, href: `#/recipients/${r.id}?edit=1` });
      else if (n.invalidPostal && a && a.postalCode && isValidPostalCode(a.country, a.postalCode) === false)
        all.push({ key: `postal-${r.id}-${a.postalCode}`, type: 'invalidPostal', level: 'warning', params: { name: `${r.firstName} ${r.lastName}`, code: a.postalCode }, href: `#/recipients/${r.id}?edit=1` });
    }
    const dismissed = new Set(data.dismissals.map((d) => d.key));
    const order = { danger: 0, warning: 1, info: 2 };
    const items = all.filter((x) => !dismissed.has(x.key)).sort((a, b) => order[a.level] - order[b.level]);
    return { items, all };
  }, [data, n]);
}
