import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity as ActivityIcon,
  Archive,
  BarChart3,
  Bell,
  BookUser,
  Boxes,
  Building2,
  Contact,
  Factory,
  FileText,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Moon,
  Package,
  Printer,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShoppingBag,
  Sparkles,
  Stamp,
  Sun,
  Truck,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Lang, Permission } from '../core/types';
import { normalizeText } from '../core/util';
import { db } from '../db/db';
import { dismissNotification } from '../db/services';
import { LANGS, useI18n } from '../i18n';
import { ensureFontsLoaded } from '../render/fonts';
import { clearMeasureCache } from '../render/textLayout';
import { BulkWizard } from '../pages/BulkWizard';
import { PackageWizard } from '../pages/PackageWizard';
import { AppRoutes } from './routes';
import { BrandMark, LockScreen, LoginScreen, SetupScreen } from './Auth';
import { useNotifications } from './notifications';
import { navigate, useRoute } from './router';
import { useSession } from './session';
import { useUI } from './ui';

interface NavItem {
  to: string;
  icon: ReactNode;
  label: string;
  perm?: Permission;
  count?: number;
  alert?: boolean;
}

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('hmms.theme') ?? 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('hmms.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return [isDark ? 'dark' : 'light', () => setTheme(isDark ? 'light' : 'dark')];
}

function GlobalSearch() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const data = useLiveQuery(
    async () => (q.trim().length >= 2 ? Promise.all([db.recipients.toArray(), db.orders.toArray(), db.shipments.toArray(), db.projects.toArray()]) : null),
    [q.trim().length >= 2],
  );
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const results = useMemo(() => {
    if (!data) return [];
    const [recipients, orders, shipments, projects] = data;
    const n = normalizeText(q);
    const out: { group: string; label: string; sub: string; href: string }[] = [];
    for (const r of recipients) {
      const hay = normalizeText(`${r.firstName} ${r.lastName} ${r.preferredName} #${r.code} ${r.code} ${r.city} ${r.guardianEmail} ${r.guardianPhone}`);
      if (hay.includes(n)) out.push({ group: 'nav.recipients', label: `${r.firstName} ${r.lastName}`, sub: `#${r.code} · ${r.city}`, href: `/recipients/${r.id}` });
    }
    for (const o of orders) if (normalizeText(`${o.number} ${o.trackingNumber}`).includes(n)) out.push({ group: 'nav.orders', label: o.number, sub: o.trackingNumber, href: `/orders/${o.id}` });
    for (const s of shipments)
      if (normalizeText(`${s.code} ${s.trackingNumber} ${s.recipientName}`).includes(n)) out.push({ group: 'nav.shipments', label: s.code, sub: `${s.trackingNumber} · ${s.recipientName}`, href: `/shipments?id=${s.id}` });
    for (const p of projects) if (normalizeText(`${p.code} ${p.name}`).includes(n)) out.push({ group: 'nav.projects', label: p.code, sub: p.name, href: `/projects/${p.id}` });
    return out.slice(0, 30);
  }, [data, q]);
  const go = (href: string) => {
    navigate(href);
    setOpen(false);
    setQ('');
  };
  let lastGroup = '';
  return (
    <div className="global-search">
      <Search />
      <input
        ref={ref}
        className="input"
        placeholder={`${t('search.placeholder')}  (Ctrl+K)`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
          else if (e.key === 'Enter' && results[active]) go(results[active].href);
          else if (e.key === 'Escape') setOpen(false);
        }}
        aria-label={t('search.placeholder')}
      />
      {open && q.trim().length >= 2 && (
        <div className="search-results">
          {!results.length && <div className="muted small" style={{ padding: 10 }}>{t('common.noResults')}</div>}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? <div className="group">{t(r.group)}</div> : null;
            lastGroup = r.group;
            return (
              <div key={`${r.href}-${i}`}>
                {header}
                <button className={i === active ? 'active' : ''} onMouseDown={() => go(r.href)}>
                  <b>{r.label}</b>
                  <span className="muted small truncate">{r.sub}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const { t } = useI18n();
  const { items } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', on);
    return () => window.removeEventListener('mousedown', on);
  }, [open]);
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn ghost icon" onClick={() => setOpen(!open)} aria-label={t('notif.title')} title={t('notif.title')}>
        <Bell />
        {items.length > 0 && (
          <span className="badge danger" style={{ position: 'absolute', top: 1, right: -2, height: 17, padding: '0 5px', fontSize: 10 }}>
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <div className="popover" style={{ right: 0, top: 44, width: 380, maxHeight: 480, overflowY: 'auto', padding: 8 }}>
          <div className="row between" style={{ padding: '4px 8px 8px' }}>
            <b>{t('notif.title')}</b>
            <a href="#/settings?tab=notifications" className="small" onClick={() => setOpen(false)}>
              {t('nav.settings')}
            </a>
          </div>
          {!items.length && <div className="empty small">{t('notif.empty')}</div>}
          {items.map((n) => (
            <div key={n.key} className="list-item" style={{ padding: '8px', alignItems: 'flex-start' }}>
              <span className={`badge ${n.level === 'danger' ? 'danger' : n.level === 'warning' ? 'warning' : 'info'}`} style={{ marginTop: 2 }}>
                {t(`notif.type.${n.type}`)}
              </span>
              <a
                className="grow small"
                href={n.href}
                style={{ color: 'var(--ink)' }}
                onClick={() => setOpen(false)}
              >
                {t(`notif.msg.${n.type}`, n.params)}
              </a>
              <button className="btn ghost icon xs" title={t('notif.dismiss')} aria-label={t('notif.dismiss')} onClick={() => dismissNotification(n.key)}>
                <X />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { t, lang, setLang } = useI18n();
  const { user, logout, lock } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', on);
    return () => window.removeEventListener('mousedown', on);
  }, [open]);
  if (!user) return null;
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="btn ghost" onClick={() => setOpen(!open)} aria-haspopup="menu">
        <span className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <span className="hide-mobile">{user.displayName}</span>
      </button>
      {open && (
        <div className="popover ctx-menu" style={{ right: 0, top: 44, position: 'absolute', minWidth: 230 }}>
          <div style={{ padding: '6px 10px 8px' }}>
            <div style={{ fontWeight: 600 }}>{user.displayName}</div>
            <div className="muted small">
              @{user.username} · {t(`role.${user.role}`)}
            </div>
          </div>
          <hr />
          <div style={{ padding: '4px 10px' }}>
            <select className="select sm" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label="Language">
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => (setOpen(false), navigate('/settings?tab=account'))}>
            <Shield /> {t('settings.tab.account')}
          </button>
          <button onClick={() => (setOpen(false), lock())}>
            <Lock /> {t('auth.lockNow')}
          </button>
          <button onClick={() => (setOpen(false), logout())}>
            <LogOut /> {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { t } = useI18n();
  const { can, settings } = useSession();
  const route = useRoute();
  const ui = useUI();
  const [theme, toggleTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const counts = useLiveQuery(async () => {
    const [newOrders, readyToPrint, inventory, dupHint] = await Promise.all([
      db.orders.where('status').equals('new').count(),
      db.projects.where('stage').anyOf('generated', 'approved').filter((p) => p.status === 'active').count(),
      db.inventory.toArray(),
      Promise.resolve(0),
    ]);
    return { newOrders, readyToPrint, low: inventory.filter((i) => i.quantity <= i.minQuantity).length, dupHint };
  }, []);
  const section = route.path[0] ?? 'dashboard';
  useEffect(() => setNavOpen(false), [route.raw]);
  const { user } = useSession();
  // Accounts created or reset with a temporary password must set their own before working.
  useEffect(() => {
    if (user?.mustChangePassword && !(route.path[0] === 'settings' && route.query.get('tab') === 'account')) navigate('/settings?tab=account', true);
  }, [user?.mustChangePassword, route.raw, route.path, route.query]);

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: t('navgroup.overview'),
      items: [
        { to: 'dashboard', icon: <LayoutDashboard />, label: t('nav.dashboard') },
        { to: 'mailroom', icon: <Inbox />, label: t('nav.mailroom'), perm: 'orders.view' },
        { to: 'analytics', icon: <BarChart3 />, label: t('nav.analytics'), perm: 'analytics.view' },
      ],
    },
    {
      title: t('navgroup.crm'),
      items: [
        { to: 'recipients', icon: <Users />, label: t('nav.recipients'), perm: 'recipients.view' },
        { to: 'customers', icon: <Contact />, label: t('nav.customers'), perm: 'recipients.view' },
        { to: 'addresses', icon: <MapPin />, label: t('nav.addresses'), perm: 'recipients.view' },
      ],
    },
    {
      title: t('navgroup.operations'),
      items: [
        { to: 'orders', icon: <ShoppingBag />, label: t('nav.orders'), perm: 'orders.view', count: counts?.newOrders, alert: !!counts?.newOrders },
        { to: 'projects', icon: <FolderKanban />, label: t('nav.projects'), perm: 'orders.view' },
        { to: 'production', icon: <Factory />, label: t('nav.production'), perm: 'orders.view', count: counts?.readyToPrint },
        { to: 'print', icon: <Printer />, label: t('nav.print'), perm: 'orders.view' },
        { to: 'shipments', icon: <Truck />, label: t('nav.shipments'), perm: 'orders.view' },
      ],
    },
    {
      title: t('navgroup.studio'),
      items: [
        { to: 'templates', icon: <FileText />, label: t('nav.templates'), perm: 'orders.view' },
        { to: 'studio/envelopes', icon: <Mail />, label: t('nav.envelopes'), perm: 'orders.view' },
        { to: 'studio/stamps', icon: <Stamp />, label: t('nav.stamps'), perm: 'orders.view' },
        { to: 'studio/postmarks', icon: <Archive />, label: t('nav.postmarks'), perm: 'orders.view' },
        { to: 'studio/seals', icon: <Sparkles />, label: t('nav.seals'), perm: 'orders.view' },
        { to: 'houses', icon: <Shield />, label: t('nav.houses'), perm: 'orders.view' },
        { to: 'characters', icon: <BookUser />, label: t('nav.characters'), perm: 'orders.view' },
      ],
    },
    {
      title: t('navgroup.warehouse'),
      items: [
        { to: 'inventory', icon: <Boxes />, label: t('nav.inventory'), perm: 'orders.view', count: counts?.low || undefined, alert: !!counts?.low },
        { to: 'suppliers', icon: <Building2 />, label: t('nav.suppliers'), perm: 'orders.view' },
      ],
    },
    {
      title: t('navgroup.system'),
      items: [
        { to: 'activity', icon: <ActivityIcon />, label: t('nav.activity'), perm: 'audit.view' },
        { to: 'settings', icon: <SettingsIcon />, label: t('nav.settings') },
      ],
    },
  ];

  const isActive = (to: string) => (to.includes('/') ? route.path.slice(0, 2).join('/') === to : section === to);

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="#/dashboard" style={{ textDecoration: 'none' }}>
          <BrandMark />
          <div>
            <div className="brand-name">{(settings?.company.systemName ?? 'Hogwarts Mail Management System').replace(/ Management System$/, '')}</div>
            <div className="brand-sub">{t('app.short')}</div>
          </div>
        </a>
        <nav className="nav" aria-label="Main">
          {groups.map((g) => {
            const items = g.items.filter((i) => !i.perm || can(i.perm));
            if (!items.length) return null;
            return (
              <div key={g.title} className="col" style={{ gap: 1 }}>
                <div className="nav-group">{g.title}</div>
                {items.map((i) => (
                  <a key={i.to} href={`#/${i.to}`} className={isActive(i.to) ? 'active' : ''} aria-current={isActive(i.to) ? 'page' : undefined}>
                    {i.icon}
                    <span>{i.label}</span>
                    {!!i.count && <span className={`count ${i.alert ? 'alert' : ''}`}>{i.count}</span>}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {settings?.company.schoolName}
          <br />
          {t('app.offlineReady')}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-toggle" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">
            <Menu />
          </button>
          <GlobalSearch />
          <span className="grow" />
          {can('projects.edit') && (
            <button className="btn accent hide-mobile" onClick={() => ui.openPackageWizard()}>
              <Wand2 /> {t('package.create')}
            </button>
          )}
          {can('projects.edit') && (
            <button className="btn ghost icon" onClick={() => ui.openBulkWizard()} title={t('bulk.title')} aria-label={t('bulk.title')}>
              <Package />
            </button>
          )}
          <NotificationBell />
          <button className="btn ghost icon" onClick={toggleTheme} title={t('app.toggleTheme')} aria-label={t('app.toggleTheme')}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <UserMenu />
        </header>
        <main className={`content ${route.path[0] === 'projects' && route.path[1] ? '' : ''}`} id="main">
          <AppRoutes route={route} />
        </main>
      </div>
      {navOpen && <div className="drawer-overlay" style={{ zIndex: 55 }} onClick={() => setNavOpen(false)} />}
      {ui.packageWizard && <PackageWizard prefill={ui.packageWizard} onClose={ui.closePackageWizard} />}
      {ui.bulkWizard && <BulkWizard initialIds={ui.bulkWizard.recipientIds} onClose={ui.closeBulkWizard} />}
    </div>
  );
}

export function App() {
  const { status } = useSession();
  const { lang } = useI18n();
  const [, setFontsTick] = useState(0);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    // Re-measure text once web fonts are ready so letter layouts are exact.
    ensureFontsLoaded().then(() => {
      clearMeasureCache();
      setFontsTick((n) => n + 1);
    });
  }, []);
  if (status === 'loading') return <div className="auth" />;
  if (status === 'setup') return <SetupScreen />;
  if (status === 'login') return <LoginScreen />;
  if (status === 'locked') return <LockScreen />;
  return <Shell />;
}
